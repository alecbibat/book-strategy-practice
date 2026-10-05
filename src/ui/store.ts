// App state that outlives a page load, saved to this browser's localStorage.
import { CELL_BY_ID } from "../strategy/cells";
import type { Rank, Rules } from "../strategy/types";
import { DECK_GROUPS, DEFAULT_RULES, DOUBLE_RULES, RANKS } from "../strategy/types";

export type Mode = "all" | "hard" | "soft" | "pair" | "misses";
export const MODES: Mode[] = ["all", "hard", "soft", "pair", "misses"];
export type Tab = "drill" | "advisor";
export type Theme = "system" | "light" | "dark";
export type Target = "dealer" | "player" | "seen";

/** Per chart square: tries, right, misses, Leitner box (0 = missed last time .. 4), last tried (ms). */
export interface CellStats { n: number; c: number; m: number; b: number; t: number }

export interface AdvisorState {
  up: Rank | null;
  player: Rank[];
  seen: Rank[];
  afterSplit: boolean;
  target: Target;
}

export interface Saved {
  rules: Rules;
  auto: boolean;
  mode: Mode;
  tab: Tab;
  theme: Theme;
  cells: Record<string, CellStats>;
  advisor: AdvisorState;
  savedAt: number;
}

const STORE_KEY = "bj-strategy-drill-v2";
const LEGACY_KEY = "bj-strategy-drill-v1";

export const freshAdvisor = (): AdvisorState => ({ up: null, player: [], seen: [], afterSplit: false, target: "dealer" });

export const saved: Saved = {
  rules: { ...DEFAULT_RULES },
  auto: true,
  mode: "all",
  tab: "drill",
  theme: "system",
  cells: {},
  advisor: freshAdvisor(),
  savedAt: 0
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const int = (x: unknown) => Math.max(0, Math.floor(Number(x) || 0));

export function sanitizeRules(raw: unknown): Rules {
  const r = isObj(raw) ? raw : {};
  return {
    decks: DECK_GROUPS.includes(r.decks as never) ? (r.decks as Rules["decks"]) : DEFAULT_RULES.decks,
    h17: typeof r.h17 === "boolean" ? r.h17 : DEFAULT_RULES.h17,
    das: typeof r.das === "boolean" ? r.das : DEFAULT_RULES.das,
    surrender: typeof r.surrender === "boolean" ? r.surrender : DEFAULT_RULES.surrender,
    double: DOUBLE_RULES.includes(r.double as never) ? (r.double as Rules["double"]) : DEFAULT_RULES.double
  };
}

export function sanitizeCells(raw: unknown): Record<string, CellStats> {
  const out: Record<string, CellStats> = {};
  if (!isObj(raw)) return out;
  for (const id of Object.keys(raw)) {
    const s = raw[id];
    if (!CELL_BY_ID[id] || !isObj(s)) continue;
    const n = int(s.n);
    if (!n) continue;
    out[id] = { n, c: Math.min(n, int(s.c)), m: int(s.m), b: Math.min(4, int(s.b)), t: Number(s.t) || 0 };
  }
  return out;
}

const rankList = (x: unknown, max: number): Rank[] =>
  Array.isArray(x) ? (x.filter(r => RANKS.includes(r as Rank)) as Rank[]).slice(0, max) : [];

function sanitizeAdvisor(raw: unknown): AdvisorState {
  const a = isObj(raw) ? raw : {};
  return {
    up: RANKS.includes(a.up as Rank) ? (a.up as Rank) : null,
    player: rankList(a.player, 11),
    seen: rankList(a.seen, 40),
    afterSplit: a.afterSplit === true,
    target: a.target === "player" || a.target === "seen" ? a.target : "dealer"
  };
}

export function adopt(data: unknown): void {
  if (!isObj(data)) return;
  if (data.rules !== undefined) saved.rules = sanitizeRules(data.rules);
  if (typeof data.auto === "boolean") saved.auto = data.auto;
  if (MODES.includes(data.mode as Mode)) saved.mode = data.mode as Mode;
  if (data.tab === "drill" || data.tab === "advisor") saved.tab = data.tab;
  if (data.theme === "light" || data.theme === "dark" || data.theme === "system") saved.theme = data.theme;
  saved.cells = sanitizeCells(data.cells);
  if (data.advisor !== undefined) saved.advisor = sanitizeAdvisor(data.advisor);
  saved.savedAt = Number(data.savedAt) || 0;
}

export const storageOK: boolean = (() => {
  try {
    localStorage.setItem("__bjsd", "1");
    localStorage.removeItem("__bjsd");
    return true;
  } catch {
    return false;
  }
})();

export function load(): void {
  if (!storageOK) return;
  try {
    const raw = localStorage.getItem(STORE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw) adopt(JSON.parse(raw));
  } catch {
    /* start fresh */
  }
}

export function save(): void {
  saved.savedAt = Date.now();
  if (!storageOK) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
  } catch {
    /* keep going without it */
  }
}

// ---- change notifications ----
type Listener = () => void;
const rulesListeners: Listener[] = [];
export const onRulesChange = (fn: Listener) => { rulesListeners.push(fn); };

export function setRules(patch: Partial<Rules>): void {
  saved.rules = sanitizeRules({ ...saved.rules, ...patch });
  save();
  rulesListeners.forEach(fn => fn());
}

const NBSP_DOT = " · ";
export function rulesShort(r: Rules): string {
  const parts = [r.h17 ? "H17" : "S17", r.das ? "DAS" : "No DAS", r.surrender ? "LS" : "No LS"];
  if (r.double !== "any") parts.push(r.double === "9-11" ? "D 9–11" : "D 10–11");
  return parts.join(NBSP_DOT);
}

export const deckLabel = (r: Rules): string => (r.decks === "1" ? "Single deck" : r.decks === "2" ? "Double deck" : "4–8 decks");
