import type { Action, Code, Rules } from "./types";

/** The actions a code asks for, in order of preference. */
export function codeChain(code: Code): Action[] {
  switch (code) {
    case "H": return ["hit"];
    case "S": return ["stand"];
    case "Dh": return ["double", "hit"];
    case "Ds": return ["double", "stand"];
    case "P": return ["split"];
    case "Rh": return ["surrender", "hit"];
    case "Rs": return ["surrender", "stand"];
    case "Rp": return ["surrender", "split"];
  }
}

export interface Availability {
  double: boolean;
  surrender: boolean;
  split: boolean;
}

/**
 * First action in the code's chain that is available, or null when the chain runs out
 * (only possible for P / Rp when the hand can't be split — then play it by its total).
 */
export function resolveCode(code: Code, avail: Availability): Action | null {
  for (const a of codeChain(code)) {
    if (a === "double" && !avail.double) continue;
    if (a === "surrender" && !avail.surrender) continue;
    if (a === "split" && !avail.split) continue;
    return a;
  }
  return null;
}

/**
 * Whether a hand may be doubled.
 * @param hardTotal the hand's total counting every ace as 1
 * @param soft whether an ace is currently counted as 11
 */
export function canDouble(hardTotal: number, soft: boolean, nCards: number, rules: Rules, afterSplit = false): boolean {
  if (nCards !== 2) return false;
  if (afterSplit && !rules.das) return false;
  if (rules.double === "any") return true;
  if (soft) return false;
  const lo = rules.double === "9-11" ? 9 : 10;
  return hardTotal >= lo && hardTotal <= 11;
}

export function canSurrender(nCards: number, rules: Rules, afterSplit = false): boolean {
  return rules.surrender && nCards === 2 && !afterSplit;
}
