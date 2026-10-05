// Plain-language explanations, generated from the resolved chart so they stay true for every rule set.
import { cellPlay, handName, LABEL, upPhrase } from "./cells";
import type { Action, Category, Rules, Upcard } from "./types";
import { UPCARDS } from "./types";

const VERB: Record<Action, string> = { hit: "hit", stand: "stand", double: "double", split: "split", surrender: "surrender" };
const PASSIVE = (a: Action) => a === "hit" || a === "stand";

const num = (u: Upcard) => (u === 11 ? "ace" : String(u));

/** "a 7", "a 10 or an ace", "4, 5 and 6", "2 through 6, 8 and 9", "7 through ace". */
export function formatUps(ups: Upcard[]): string {
  const sorted = [...ups].sort((a, b) => a - b);
  if (sorted.length === 1) return upPhrase(sorted[0]);
  if (sorted.length === 2) return upPhrase(sorted[0]) + " or " + upPhrase(sorted[1]);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i + 1 >= 4) parts.push(num(sorted[i]) + " through " + num(sorted[j]));
    else for (let k = i; k <= j; k++) parts.push(num(sorted[k]));
    i = j + 1;
  }
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

/** Resolved play for each upcard of a chart row, for a fresh two-card hand. */
export function rowPlays(cat: Category, row: number, rules: Rules): Record<number, Action> {
  const out: Record<number, Action> = {};
  UPCARDS.forEach(u => { out[u] = cellPlay(cat, row, u, rules).action; });
  return out;
}

/** "Hard 12: stand against 4, 5 and 6, otherwise hit." */
export function rowSummary(cat: Category, row: number, rules: Rules): string {
  const plays = rowPlays(cat, row, rules);
  const groups = new Map<Action, Upcard[]>();
  UPCARDS.forEach(u => {
    const a = plays[u];
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a)!.push(u);
  });
  const name = rowName(cat, row);
  if (groups.size === 1) return name + ": always " + VERB[[...groups.keys()][0]] + ".";

  const entries = [...groups.entries()];
  // The "otherwise" action: a passive play (hit or stand) covering the most upcards; ties go to the one that holds the ace.
  const passive = entries.filter(([a]) => PASSIVE(a));
  let fallback: Action | null = null;
  if (passive.length) {
    passive.sort((x, y) => y[1].length - x[1].length || (y[1].includes(11) ? 1 : 0) - (x[1].includes(11) ? 1 : 0));
    fallback = passive[0][0];
  } else {
    fallback = entries.sort((x, y) => y[1].length - x[1].length)[0][0];
  }
  const named = entries
    .filter(([a]) => a !== fallback)
    .sort((x, y) => Number(PASSIVE(x[0])) - Number(PASSIVE(y[0])) || x[1][0] - y[1][0]);
  const clauses = named.map(([a, ups]) => VERB[a] + " against " + formatUps(ups));
  return name + ": " + clauses.join(", ") + ", otherwise " + VERB[fallback] + ".";
}

export function rowName(cat: Category, row: number): string {
  if (cat === "soft") return handName(cat, row) + (row === 1 ? " (A,A)" : row === 10 ? "" : " (A," + row + ")");
  return handName(cat, row);
}

/** A short "why" for the play, only where it holds for the play actually recommended. */
export function cellTip(cat: Category, row: number, up: Upcard, action: Action): string | null {
  if (cat === "pair") {
    if (row === 11 && action === "split") return "Two hands starting with an ace are worth far more than one soft 12.";
    if (row === 10 && action === "stand") return "Never split 10s. A 20 is too strong to break up.";
    if (row === 5 && action !== "split") return "Never split 5s. Play them as a hard 10.";
    if (row === 8 && action === "split") return "A 16 is the worst total you can hold. Two hands starting with 8 do better.";
    if (row === 8 && action === "surrender") return "Against an ace that hits soft 17, giving up half the bet costs less than splitting.";
    if (row === 9 && action === "stand" && up === 7) return "Against a 7, your 18 already beats the dealer’s likely 17.";
    if (row === 9 && action === "stand" && up >= 10) return "Against a 10 or an ace, two hands starting with 9 do worse than one 18.";
    return null;
  }
  if (action === "surrender") return "Surrender gives back half your bet. Playing this hand out loses more than that on average.";
  if (cat === "hard") {
    if (row === 11 && action === "double") return "11 is the best total to double on: any ten makes 21.";
    if (row === 12 && action === "hit" && (up === 2 || up === 3)) return "A dealer 2 or 3 doesn’t bust often enough to justify standing on 12.";
    if (row >= 12 && row <= 16 && action === "stand" && up <= 6) return "The dealer’s small card busts often. Don’t risk busting first.";
    if (row >= 13 && row <= 16 && action === "hit" && up >= 7) return "Against a strong upcard, standing on a stiff total loses more often than hitting.";
    return null;
  }
  if (row === 6 && action === "hit") return "Never stand on soft 17. One more card can’t bust a soft hand.";
  if (row === 7 && action === "hit") return "Your 18 is behind those cards, and one more card can’t bust a soft hand.";
  return null;
}

const DOUBLE_RULE_TEXT = { any: "any two cards", "9-11": "hard 9, 10 and 11", "10-11": "hard 10 and 11" } as const;

/**
 * Notes about how the play changes with the rules: fallbacks when an option isn't available,
 * and what a different table would do.
 */
export function ruleNotes(cat: Category, row: number, up: Upcard, rules: Rules): string[] {
  const notes: string[] = [];
  const { code, action } = cellPlay(cat, row, up, rules);
  const other = (patch: Partial<Rules>) => cellPlay(cat, row, up, { ...rules, ...patch }).action;

  if (code === "Dh" || code === "Ds") {
    const alt = code === "Dh" ? "hit" : "stand";
    if (action === "double") notes.push("If doubling isn’t allowed, " + alt + ".");
    else notes.push("This table only lets you double " + DOUBLE_RULE_TEXT[rules.double] + ", so " + alt + ". Where you can double any two cards, double.");
  }
  if (action === "surrender") {
    const alt = other({ surrender: false });
    notes.push("If surrender isn’t offered, " + VERB[alt] + ".");
  } else if (!rules.surrender && other({ surrender: true }) === "surrender") {
    notes.push("Where late surrender is offered, surrender.");
  }
  if (cat === "pair") {
    const dasAlt = other({ das: !rules.das });
    if (dasAlt !== action) notes.push((rules.das ? "Without double after split, " : "With double after split, ") + VERB[dasAlt] + ".");
  }
  const h17Alt = other({ h17: !rules.h17 });
  if (h17Alt !== action) notes.push((rules.h17 ? "If the dealer stands on soft 17, " : "If the dealer hits soft 17, ") + VERB[h17Alt] + ".");
  return notes;
}

export interface CellExplanation {
  action: Action;
  title: string;
  summary: string;
  tip: string | null;
  notes: string[];
}

export function explainCell(cat: Category, row: number, up: Upcard, rules: Rules): CellExplanation {
  const { action } = cellPlay(cat, row, up, rules);
  return {
    action,
    title: LABEL[action],
    summary: rowSummary(cat, row, rules),
    tip: cellTip(cat, row, up, action),
    notes: ruleNotes(cat, row, up, rules)
  };
}
