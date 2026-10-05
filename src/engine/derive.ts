// Total-dependent basic strategy derivation from the EV engine.
//
// Used by scripts/derive-strategy.ts (which writes src/strategy/derived.json) and by the tests.
//
// Method, per (decks, H17/S17, upcard):
//  * Every 2-card starting hand is evaluated exactly (composition-dependent EVs, see hand.ts), from a
//    shoe with the upcard removed, conditional on no dealer blackjack.
//  * Hard rows 5..19 combine every 2-card NON-PAIR, ace-free composition making the total, weighted
//    by its probability of being dealt given the upcard AND given that the dealer has no blackjack
//    (the decision is made after the peek). Ten-value cards are one rank. Soft rows are A,x; pair
//    rows are x,x (pair of tens = any two ten-value cards).
//  * Doubling the first two cards is evaluated AS IF it were allowed even when rules.double restricts
//    it (codes then say Dh/Ds and the app falls back to the second letter). Doubling after a split
//    still obeys the restriction inside the split EV.
//  * Code: hs = better of hit/stand. If surrender is allowed and -0.5 beats every other action ->
//    R + letter of the best non-surrender action (h, s or p; if that action is double it is reported
//    as an anomaly and the hs letter is used). Else a pair whose split is best -> P. Else double
//    beating hs -> Dh/Ds. Else H/S.
//  * Pairs under restricted doubling: when the pair itself can't be doubled (4,4 under 9-11 / 10-11)
//    a Dx code would fall back to x, so if splitting beats hit/stand the cell is P (or Rp) instead.
//    Without this, 1 deck S17 DAS 10-11 4,4 v 6 came out Dh (= hit) under the earlier split model,
//    although split beats hit (by 0.019 with the current split values).
//
// Hit/stand/double EVs depend only on (decks, h17); split EVs on (decks, h17, das, double), so one
// `UpcardData` serves every combination of the other rules.

import type { Action, Category, Code, DeckGroup, Rules, Upcard } from "../strategy/types";
import { DECK_GROUPS, DOUBLE_RULES, UPCARDS, engineDecks, upToRank } from "../strategy/types";
import { canDouble } from "../strategy/resolve";
import { HandContext } from "./hand";
import { splitEVFromTable, splitHandTable, type SplitHandTable } from "./split";
import { freshShoe, handShape, withoutCards } from "./shoe";

export const HARD_ROWS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
export const SOFT_ROWS = [2, 3, 4, 5, 6, 7, 8, 9];
export const PAIR_ROWS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export const comboKey = (r: Rules): string =>
  `${r.decks}|${r.h17 ? "H17" : "S17"}|${r.das ? "DAS" : "NDAS"}|${r.surrender ? "LS" : "NS"}|${r.double}`;

export function allRuleCombos(): Rules[] {
  const out: Rules[] = [];
  for (const decks of DECK_GROUPS)
    for (const h17 of [false, true])
      for (const das of [false, true])
        for (const surrender of [false, true])
          for (const double of DOUBLE_RULES) out.push({ decks, h17, das, surrender, double });
  return out;
}

/** Numerators of one 2-card starting hand (see hand.ts) plus its dealing weight. */
interface StartHand {
  stand: number;
  hit: number;
  double: number;
  noBJ: number;
  /** Proportional to P(this composition is dealt | upcard). */
  weight: number;
}

export interface UpcardData {
  decks: DeckGroup;
  h17: boolean;
  up: Upcard;
  /** Keyed "a,b" with a <= b (ranks, 1 = ace). */
  hands: Map<string, StartHand>;
  /** Split tables keyed by pair rank 1..10. */
  splits: Map<number, SplitHandTable>;
}

/** Evaluate every starting hand and every pair's split table for one (decks, h17, upcard). */
export function computeUpcard(decks: DeckGroup, h17: boolean, up: Upcard): UpcardData {
  const u = upToRank(up);
  const shoe = withoutCards(freshShoe(engineDecks(decks)), [u], "the shoe");
  const ctx = new HandContext(shoe, u, h17);
  const hands = new Map<string, StartHand>();
  for (let a = 1; a <= 10; a++) {
    for (let b = a; b <= 10; b++) {
      const weight = a === b ? shoe[a - 1] * (shoe[a - 1] - 1) : 2 * shoe[a - 1] * shoe[b - 1];
      if (weight === 0) continue;
      hands.set(a + "," + b, { ...ctx.evaluate([a, b]), weight });
    }
  }
  const splits = new Map<number, SplitHandTable>();
  for (let x = 1; x <= 10; x++) {
    if (shoe[x - 1] < 2) continue;
    const sctx = new HandContext(withoutCards(shoe, [x], "the shoe"), u, h17);
    splits.set(x, splitHandTable(sctx, x));
  }
  return { decks, h17, up, hands, splits };
}

export interface CellEVs {
  stand: number;
  hit: number;
  /** As if doubling the first two cards were allowed. */
  double: number;
  split: number | null;
  surrender: number | null;
}

/** The 2-card compositions behind a chart row, as [a, b] with a <= b. */
export function rowHands(cat: Category, row: number): Array<[number, number]> {
  if (cat === "soft") return [[1, row]];
  if (cat === "pair") return row === 11 ? [[1, 1]] : [[row, row]];
  const out: Array<[number, number]> = [];
  for (let a = 2; a <= 10; a++) {
    const b = row - a;
    if (b > a && b <= 10) out.push([a, b]);
  }
  return out;
}

/** Weighted EVs for one chart cell under `rules` (the first-two-card double is as-if allowed). */
export function cellEVs(data: UpcardData, cat: Category, row: number, rules: Rules): CellEVs {
  let ws = 0, wh = 0, wd = 0, wn = 0;
  for (const [a, b] of rowHands(cat, row)) {
    const h = data.hands.get(a + "," + b);
    if (!h) continue;
    ws += h.weight * h.stand;
    wh += h.weight * h.hit;
    wd += h.weight * h.double;
    wn += h.weight * h.noBJ;
  }
  if (wn === 0) throw new Error(`No compositions for ${cat}:${row}`);
  let split: number | null = null;
  if (cat === "pair") {
    const t = data.splits.get(row === 11 ? 1 : row);
    if (t) split = splitEVFromTable(t, rules, 2);
  }
  return { stand: ws / wn, hit: wh / wn, double: wd / wn, split, surrender: rules.surrender ? -0.5 : null };
}

/**
 * The cell's actions that are legal for a fresh two-card hand under `rules`, best first: doubling only
 * where rules.double allows it for the two cards, surrender only with late surrender, split only for
 * pairs. (cellEVs' `double` is as-if allowed; this drops it where it isn't.)
 */
export function legalRanking(ev: CellEVs, cat: Category, row: number, rules: Rules): Array<[Action, number]> {
  const [a, b] = rowHands(cat, row)[0];
  const shape = handShape([a, b]);
  const out: Array<[Action, number]> = [["stand", ev.stand], ["hit", ev.hit]];
  if (canDouble(shape.hard, shape.soft, 2, rules)) out.push(["double", ev.double]);
  if (ev.split !== null) out.push(["split", ev.split]);
  if (ev.surrender !== null) out.push(["surrender", ev.surrender]);
  return out.sort((x, y) => y[1] - x[1]);
}

export interface CellDecision {
  code: Code;
  /** Relevant actions sorted best first, with EVs. */
  ranking: Array<[Action, number]>;
  anomaly?: string;
}

const LETTER: Record<string, string> = { hit: "h", stand: "s", split: "p" };

export function decideCode(ev: CellEVs, cat: Category, row: number, rules: Rules): CellDecision {
  const ranking: Array<[Action, number]> = [["stand", ev.stand], ["hit", ev.hit], ["double", ev.double]];
  if (ev.split !== null) ranking.push(["split", ev.split]);
  if (ev.surrender !== null) ranking.push(["surrender", ev.surrender]);
  ranking.sort((x, y) => y[1] - x[1]);

  const hs: "h" | "s" = ev.hit > ev.stand ? "h" : "s";
  const hsV = Math.max(ev.hit, ev.stand);
  const nonSurr = ranking.filter(([a]) => a !== "surrender");
  const [bestNon, bestNonV] = nonSurr[0];
  let anomaly: string | undefined;
  let code: Code;
  if (ev.surrender !== null && ev.surrender > bestNonV) {
    if (bestNon === "double") {
      anomaly = "surrender is best and double is the best non-surrender action; used R" + hs;
      code = ("R" + hs) as Code;
    } else code = ("R" + LETTER[bestNon]) as Code;
  } else if (bestNon === "split") code = "P";
  else if (ev.double > hsV) code = ("D" + hs) as Code;
  else code = hs === "h" ? "H" : "S";

  // Restricted doubling: a Dx code falls back to x. A pair that can't be doubled falls back to the
  // better of split and x instead; any other hand is flagged if surrender would beat the fallback.
  if (code[0] === "D") {
    const [a, b] = rowHands(cat, row)[0];
    const shape = handShape([a, b]);
    if (!canDouble(shape.hard, shape.soft, 2, rules)) {
      if (cat === "pair" && ev.split !== null && ev.split > hsV) {
        code = ev.surrender !== null && ev.surrender > ev.split ? "Rp" : "P";
      } else if (ev.surrender !== null && ev.surrender > hsV) {
        anomaly = `double (as-if) is best but not allowed under double=${rules.double}; surrender beats the ${hs} fallback`;
      }
    }
  }
  return { code, ranking, anomaly };
}

export const cellId = (cat: Category, row: number, up: Upcard): string => `${cat}:${row}:${up}`;

export const ROWS: Record<Category, number[]> = { hard: HARD_ROWS, soft: SOFT_ROWS, pair: PAIR_ROWS };

export interface DerivedCombo {
  hard: Record<string, string>;
  soft: Record<string, string>;
  pair: Record<string, string>;
}

export interface CellReport {
  key: string;
  cell: string;
  cat: Category;
  row: number;
  up: Upcard;
  rules: Rules;
  ev: CellEVs;
  decision: CellDecision;
}

/**
 * Derive all codes for every combo sharing (decks, h17). Calls `onCell` for each cell.
 * Returns combos keyed by comboKey.
 */
export function deriveDecksH17(
  decks: DeckGroup,
  h17: boolean,
  onCell?: (r: CellReport) => void
): Record<string, DerivedCombo> {
  const perUp = UPCARDS.map((up) => computeUpcard(decks, h17, up));
  const out: Record<string, DerivedCombo> = {};
  for (const rules of allRuleCombos()) {
    if (rules.decks !== decks || rules.h17 !== h17) continue;
    const key = comboKey(rules);
    const combo: DerivedCombo = { hard: {}, soft: {}, pair: {} };
    for (const cat of ["hard", "soft", "pair"] as Category[]) {
      for (const row of ROWS[cat]) {
        const codes: string[] = [];
        UPCARDS.forEach((up, i) => {
          const ev = cellEVs(perUp[i], cat, row, rules);
          const decision = decideCode(ev, cat, row, rules);
          codes.push(decision.code);
          onCell?.({ key, cell: cellId(cat, row, up), cat, row, up, rules, ev, decision });
        });
        combo[cat][String(row)] = codes.join(" ");
      }
    }
    out[key] = combo;
  }
  return out;
}

