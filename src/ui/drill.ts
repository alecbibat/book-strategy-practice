// The drill: deal a two-card hand against an upcard, ask for the play, explain the answer.
import { CELL_BY_ID, CELLS, cellTitle, correctAction, handName, idOf, LABEL, twoCardHardTotal, twoCardSoft, upPhrase, type Cell } from "../strategy/cells";
import { explainCell } from "../strategy/explain";
import { canDouble, canSurrender } from "../strategy/resolve";
import type { Action, Rank } from "../strategy/types";
import { ACTIONS, upToRank } from "../strategy/types";
import { backHTML, cardHTML, cardKey, makeCard, SUITS, type PlayingCard } from "./cards";
import { $, esc, now, pick } from "./dom";
import { MODES, saved, save, type Mode } from "./store";

const AUTO_MS = 1000;
const BOX_WEIGHT = [8, 3, 1.5, 0.7, 0.35]; // box 0 = missed last time; higher boxes come up less often
const KEYS: Record<string, Action> = { h: "hit", s: "stand", d: "double", p: "split", r: "surrender" };
export const HARD_COMBOS: Record<number, [number, number][]> = {
  8: [[2, 6], [3, 5]],
  9: [[2, 7], [3, 6], [4, 5]],
  10: [[2, 8], [3, 7], [4, 6]],
  11: [[2, 9], [3, 8], [4, 7], [5, 6]],
  12: [[2, 10], [3, 9], [4, 8], [5, 7]],
  13: [[3, 10], [4, 9], [5, 8], [6, 7]],
  14: [[4, 10], [5, 9], [6, 8]],
  15: [[5, 10], [6, 9], [7, 8]],
  16: [[6, 10], [7, 9]],
  17: [[7, 10], [8, 9]]
};

interface Hand extends Cell { id: string; player: PlayingCard[]; upcard: PlayingCard; t0: number }
interface Verdict { chosen: Action; correct: Action; ok: boolean; secs: number }

const freshSession = () => ({ n: 0, c: 0, streak: 0, best: 0, tSum: 0, tN: 0 });

export const drill = {
  session: freshSession(),
  hand: null as Hand | null,
  answered: false,
  verdict: null as Verdict | null,
  force: null as string | null,
  timer: 0 as number,
  notice: "",
  keyboard: false
};

let onOpenAdvisor: (up: Rank, player: Rank[]) => void = () => {};
let onChange: () => void = () => {};

const el = {
  get modes() { return $("modes"); }, get missBadge() { return $("missBadge"); },
  get tAcc() { return $("tAcc"); }, get tAccSub() { return $("tAccSub"); }, get tStreak() { return $("tStreak"); },
  get tBest() { return $("tBest"); }, get tSpeed() { return $("tSpeed"); }, get felt() { return $("felt"); },
  get dealer() { return $("dealerHand"); }, get player() { return $("playerHand"); }, get handName() { return $("handName"); },
  get decide() { return $("decide"); }, get verdict() { return $("verdict"); }, get misses() { return $("misses"); },
  get lifetime() { return $("lifetime"); }, get byType() { return $("byType"); }
};
const btn = (a: Action) => el.decide.querySelector<HTMLButtonElement>('[data-act="' + a + '"]')!;

export function isWeak(id: string): boolean { const s = saved.cells[id]; return !!s && s.m > 0 && s.b < 2; }
function weightOf(id: string): number { const s = saved.cells[id]; return s && s.n ? BOX_WEIGHT[s.b] : BOX_WEIGHT[1]; }

export function available(action: Action): boolean {
  const h = drill.hand;
  if (!h) return false;
  if (action === "split") return h.cat === "pair";
  if (action === "surrender") return canSurrender(2, saved.rules);
  if (action === "double") return canDouble(twoCardHardTotal(h.cat, h.row), twoCardSoft(h.cat, h.row), 2, saved.rules);
  return true;
}

// ---------- dealing ----------
function playerCards(c: Cell): PlayingCard[] {
  if (c.cat === "pair") {
    const a = Math.floor(Math.random() * 4);
    const b = (a + 1 + Math.floor(Math.random() * 3)) % 4;
    return [makeCard(c.row, SUITS[a]), makeCard(c.row, SUITS[b])];
  }
  const cards = c.cat === "hard"
    ? pick(HARD_COMBOS[c.row]).map(v => makeCard(v))
    : [makeCard(11), makeCard(c.row)];
  return Math.random() < 0.5 ? cards : cards.reverse();
}

/** Cards for a square; in a single deck no physical card can show up twice. */
function dealCards(c: Cell): { player: PlayingCard[]; upcard: PlayingCard } {
  for (let tries = 0; ; tries++) {
    const player = playerCards(c);
    const upcard = makeCard(c.up);
    if (saved.rules.decks !== "1" || tries > 50) return { player, upcard };
    const keys = [...player, upcard].map(cardKey);
    if (new Set(keys).size === keys.length) return { player, upcard };
  }
}

function candidates(): Cell[] {
  if (saved.mode === "misses") return CELLS.filter(c => isWeak(idOf(c)));
  if (saved.mode === "all") return CELLS;
  return CELLS.filter(c => c.cat === saved.mode);
}

function pickCell(): Cell {
  if (drill.force && CELL_BY_ID[drill.force]) {
    const forced = CELL_BY_ID[drill.force];
    drill.force = null;
    return forced;
  }
  drill.force = null;
  let list = candidates();
  if (!list.length) {
    drill.notice = "Misses cleared. Back to the full chart.";
    saved.mode = "all";
    renderModes();
    save();
    list = CELLS;
  }
  const last = drill.hand && drill.hand.id;
  const pool = list.length > 1 ? list.filter(c => idOf(c) !== last) : list;
  let total = 0;
  const cum = pool.map(c => (total += weightOf(idOf(c))));
  const r = Math.random() * total;
  for (let i = 0; i < cum.length; i++) if (r < cum[i]) return pool[i];
  return pool[pool.length - 1];
}

export function deal(): void {
  clearTimeout(drill.timer);
  drill.timer = 0;
  const cell = pickCell();
  const { player, upcard } = dealCards(cell);
  drill.hand = { ...cell, id: idOf(cell), player, upcard, t0: now() };
  drill.answered = false;
  drill.verdict = null;
  renderHand();
  renderActions();
  renderIdle();
}

export function answer(action: Action): void {
  const h = drill.hand;
  if (!h || drill.answered || !available(action)) return;
  const correct = correctAction(h, saved.rules);
  const ok = action === correct;
  const secs = Math.max(0, (now() - h.t0) / 1000);
  drill.answered = true;
  drill.verdict = { chosen: action, correct, ok, secs };
  const S = drill.session;
  S.n++;
  if (ok) { S.c++; S.streak++; S.best = Math.max(S.best, S.streak); S.tSum += Math.min(secs, 20); S.tN++; } else S.streak = 0;
  const st = saved.cells[h.id] || (saved.cells[h.id] = { n: 0, c: 0, m: 0, b: 1, t: 0 });
  st.n++;
  st.t = Date.now();
  if (ok) { st.c++; st.b = Math.min(4, st.b + 1); } else { st.m++; st.b = 0; }
  save();
  renderActions();
  renderVerdict();
  renderTally();
  renderMisses();
  onChange();
  if (ok && saved.auto) drill.timer = window.setTimeout(deal, AUTO_MS);
}

export function next(): void { if (drill.answered) deal(); }

// ---------- rendering ----------
export function renderModes(): void {
  el.modes.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === saved.mode)));
  const n = weakList().length;
  el.missBadge.hidden = n === 0;
  el.missBadge.textContent = String(n);
}

export function renderTally(): void {
  const S = drill.session;
  el.tAcc.textContent = S.n ? Math.round(100 * S.c / S.n) + "%" : "–";
  el.tAccSub.textContent = S.n ? S.c + " of " + S.n : "no hands yet";
  el.tStreak.textContent = String(S.streak);
  el.tBest.textContent = "best " + S.best;
  el.tSpeed.textContent = S.tN ? (S.tSum / S.tN).toFixed(1) + "s" : "–";
}

function renderHand(): void {
  const h = drill.hand!;
  el.dealer.innerHTML = cardHTML(h.upcard, 0) + backHTML(1);
  el.player.innerHTML = h.player.map((c, i) => cardHTML(c, i + 2)).join("");
  el.handName.textContent = handName(h.cat, h.row);
}

export function renderActions(): void {
  const v = drill.verdict;
  el.decide.classList.toggle("answered", drill.answered);
  for (const a of ACTIONS) {
    const b = btn(a);
    b.disabled = drill.answered || !available(a);
    b.classList.toggle("is-correct", !!(drill.answered && v && a === v.correct));
    b.classList.toggle("is-wrong", !!(drill.answered && v && a === v.chosen && !v.ok));
  }
  // Surrender isn't part of the game at all when the table doesn't offer it.
  btn("surrender").hidden = !saved.rules.surrender;
  el.decide.classList.toggle("no-surrender", !saved.rules.surrender);
}

function renderIdle(): void {
  const h = drill.hand!;
  el.verdict.className = "verdict";
  const notice = drill.notice;
  drill.notice = "";
  el.verdict.innerHTML =
    '<div class="v-head"><span>What’s the play?</span></div>' +
    '<p class="v-rule">' + esc(notice || handName(h.cat, h.row) + " against " + upPhrase(h.up) + ".") +
    ' <span class="keys">Keys: H, S, D, P' + (saved.rules.surrender ? ", R" : "") + ".</span></p>";
}

function renderVerdict(): void {
  const h = drill.hand!, v = drill.verdict!;
  const ex = explainCell(h.cat, h.row, h.up, saved.rules);
  el.verdict.className = "verdict " + (v.ok ? "good" : "bad");
  let html = '<div class="v-head"><span class="v-mark" aria-hidden="true">' + (v.ok ? "✓" : "✕") + "</span>" +
    "<span>" + (v.ok ? LABEL[v.correct] + " is right." : LABEL[v.correct] + " is the play.") + "</span>" +
    '<span class="v-time">' + v.secs.toFixed(1) + "s</span></div>";
  html += '<p class="v-rule">' + (v.ok ? "" : "You chose " + LABEL[v.chosen].toLowerCase() + ". ") + esc(ex.summary) +
    (ex.tip ? " " + esc(ex.tip) : "") +
    (ex.notes.length ? '<span class="v-extra">' + esc(ex.notes.join(" ")) + "</span>" : "") + "</p>";
  const nextBtn = !v.ok || !saved.auto;
  html += '<div class="v-actions">' + (nextBtn ? '<button type="button" class="v-next" id="nextBtn">Next hand</button>' : "") +
    '<button type="button" class="text-btn" id="toAdvisor">Exact odds</button></div>';
  if (!nextBtn) html += '<div class="v-bar" style="--dur:' + AUTO_MS + 'ms"></div>';
  el.verdict.innerHTML = html;
  if (drill.keyboard && nextBtn) $("nextBtn").focus({ preventScroll: true });
}

function weakList() {
  return CELLS.filter(c => isWeak(idOf(c)))
    .map(c => ({ c, id: idOf(c), s: saved.cells[idOf(c)] }))
    .sort((a, b) => a.s.b - b.s.b || b.s.m - a.s.m || b.s.t - a.s.t);
}

function tallyLifetime() {
  const by: Record<string, [number, number]> = { hard: [0, 0], soft: [0, 0], pair: [0, 0] };
  let n = 0, c = 0, seen = 0;
  for (const id of Object.keys(saved.cells)) {
    const s = saved.cells[id], k = id.slice(0, id.indexOf(":"));
    if (!by[k]) continue;
    by[k][0] += s.n; by[k][1] += s.c; n += s.n; c += s.c; seen++;
  }
  return { n, c, seen, by };
}
const pct = (c: number, n: number) => (n ? Math.round(100 * c / n) + "%" : "–");

export function renderMisses(): void {
  const list = weakList();
  const shown = list.slice(0, 8);
  if (shown.length) {
    el.misses.innerHTML = shown.map(x => {
      const a = correctAction(x.c, saved.rules);
      const note = x.s.b === 0 ? "missed " + x.s.m + "×" : "1 more right to clear";
      return '<button type="button" class="miss" data-drill="' + x.id + '"><span class="miss-hand">' + esc(cellTitle(x.c)) +
        '</span><span class="tag t-' + a + '">' + LABEL[a] + '</span><span class="miss-note">' + note + "</span></button>";
    }).join("") + (list.length > shown.length ? '<p class="empty">+' + (list.length - shown.length) + " more in the Misses drill.</p>" : "");
  } else {
    el.misses.innerHTML = '<p class="empty">Nothing to review right now. Hands you miss land here and stay until you get them right twice in a row.</p>';
  }
  const L = tallyLifetime();
  el.lifetime.textContent = L.n ? L.n + (L.n === 1 ? " hand · " : " hands · ") + pct(L.c, L.n) : "";
  const types = ([["Hard", "hard"], ["Soft", "soft"], ["Pairs", "pair"]] as const)
    .filter(t => L.by[t[1]][0])
    .map(t => t[0] + " " + pct(L.by[t[1]][1], L.by[t[1]][0]));
  el.byType.hidden = !L.n;
  el.byType.textContent = L.n ? types.concat(L.seen + " of " + CELLS.length + " chart squares seen").join(" · ") : "";
  renderModes();
}

/** Rules changed: the right answers may have changed, so refresh whatever shows them. */
export function onRules(): void {
  if (drill.hand && !drill.answered) { renderActions(); renderIdle(); }
  else if (drill.hand && drill.answered) renderActions();
  renderMisses();
}

export function resetProgress(): void {
  saved.cells = {};
  drill.session = freshSession();
  if (saved.mode === "misses") saved.mode = "all";
  save();
  renderTally();
  renderMisses();
  drill.notice = "Progress cleared.";
  deal();
}

export function drillCell(id: string): void {
  if (!CELL_BY_ID[id]) return;
  drill.force = id;
  deal();
}

export function currentHandRanks(): { up: Rank; player: Rank[] } | null {
  const h = drill.hand;
  if (!h) return null;
  const toRank = (c: PlayingCard): Rank => (c.rank === "A" ? 1 : TEN_RANKS.has(c.rank) ? 10 : (Number(c.rank) as Rank));
  return { up: upToRank(h.up), player: h.player.map(toRank) };
}
const TEN_RANKS = new Set(["10", "J", "Q", "K"]);

/** Keyboard handling while the drill is showing. Returns true when the key was used. */
export function drillKey(e: KeyboardEvent): boolean {
  const k = (e.key || "").toLowerCase();
  if (!drill.answered && KEYS[k]) {
    if (available(KEYS[k])) { e.preventDefault(); drill.keyboard = true; answer(KEYS[k]); }
    return true;
  }
  if (drill.answered && (k === "enter" || k === " " || k === "n")) {
    const t = e.target as HTMLElement | null;
    if (t && t.tagName === "BUTTON" && !(t as HTMLButtonElement).disabled && k !== "n") return false; // let the focused button act
    e.preventDefault();
    next();
    return true;
  }
  return false;
}

export function initDrill(opts: { openAdvisor: (up: Rank, player: Rank[]) => void; changed: () => void }): void {
  onOpenAdvisor = opts.openAdvisor;
  onChange = opts.changed;
  el.decide.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
    if (b && !b.disabled) answer(b.dataset.act as Action);
  });
  el.verdict.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    if (t.closest("#toAdvisor")) {
      clearTimeout(drill.timer);
      drill.timer = 0;
      const cur = currentHandRanks();
      if (cur) onOpenAdvisor(cur.up, cur.player);
      return;
    }
    if (t.closest("#nextBtn") || (drill.answered && drill.timer)) next();
  });
  el.modes.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
    if (!b || !MODES.includes(b.dataset.mode as Mode)) return;
    saved.mode = b.dataset.mode as Mode;
    save();
    renderModes();
    deal();
  });
  renderTally();
  renderMisses();
  deal();
  requestAnimationFrame(() => requestAnimationFrame(() => el.felt.classList.remove("no-anim")));
}
