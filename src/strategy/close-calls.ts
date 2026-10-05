// Close calls and disputed cells in the strategy tables (tables.ts), with the reasoning for each.
//
// DEVIATIONS lists every cell where tables.ts deliberately differs from the EV engine's derivation
// (src/strategy/derived.json). There are none. Across all 72 rule sets, the engine agrees with every
// published chart we could check (72 charts, see STRATEGY.md), except where the published charts
// disagree with each other. In that case we follow the engine.
//
// CLOSE_CALLS documents the cells worth knowing about, where tables.ts follows the engine: published
// sources disagree, no published chart exists for the exact rules, the engine's margin is under 0.003
// of a bet, or an earlier derivation got the cell wrong. tables.test.ts re-checks every entry: the
// chosen code, the engine code and the margin.
//
// `margin` is the engine's total-dependent EV of the chosen play minus that of the best other LEGAL
// play for a fresh two-card hand, in units of the initial bet. Legal means doubling only where
// rules.double allows it for that total, and surrender only with late surrender. A deviation would
// have a negative margin.

import type { Action, Code } from "./types";

export interface CloseCall {
  /** Rule sets: a combo key "decks|H17/S17|DAS/NDAS|LS/NS|double", where "*" matches any value in that field. */
  keys: string;
  /** Chart cell "cat:row:upcard" (upcard 11 = ace; soft row = the non-ace card). */
  cell: string;
  /** Code tables.ts returns. */
  chosen: Code;
  /** Code the EV engine derives. */
  engine: Code;
  /** Chosen play minus the best other legal play (engine EV, units of the initial bet). */
  margin: number;
  /** The best other legal play. */
  runnerUp: Action;
  /** Published sources on this cell for these rules. */
  sources: string;
  rationale: string;
}

/** True when a combo key matches a pattern with "*" wildcards. */
export function matchesKey(pattern: string, key: string): boolean {
  const p = pattern.split("|");
  const k = key.split("|");
  return p.length === k.length && p.every((x, i) => x === "*" || x === k[i]);
}

/** Cells where tables.ts deliberately differs from the engine. None: the engine is followed everywhere. */
export const DEVIATIONS: CloseCall[] = [];

export const CLOSE_CALLS: CloseCall[] = [
  // ---- Published sources disagree, or the result depends on the deck count inside "4-8" ----
  {
    keys: "2|H17|DAS|LS|*", cell: "pair:8:11", chosen: "P", engine: "P", margin: 0.0042, runnerUp: "surrender",
    sources: "blackjackinfo engine: P. gsdriver/blackjack-strategy (from the Wizard of Odds calculator): P. Wizard of Odds 2-deck chart: Rp.",
    rationale:
      "Sources disagree, so we follow the engine: split beats surrender by 0.0042. The Wizard's raw table has one code for DAS and no DAS. Without DAS, surrender is better (next entry), which probably explains its Rp."
  },
  {
    keys: "2|H17|NDAS|LS|*", cell: "pair:8:11", chosen: "Rp", engine: "Rp", margin: 0.0023, runnerUp: "split",
    sources: "Wizard of Odds: Rp. blackjackinfo engine: Rp.",
    rationale: "Without DAS the split loses 0.0023 to surrender. All sources agree."
  },
  {
    keys: "4-8|S17|DAS|*|10-11", cell: "pair:4:5", chosen: "P", engine: "P", margin: 0.0019, runnerUp: "hit",
    sources: "blackjackinfo engine, 6 decks and 8 decks (double 10-11, DAS): P.",
    rationale:
      "\"4-8\" is modelled as 6 decks, where split leads by 0.0019. At 8 decks the engine has hit ahead by 0.0008, which is within its split-model error. blackjackinfo's 8-deck chart splits, so P stands for the whole 4-8 group. It is the only cell that differs between 4, 5, 6 and 8 decks."
  },
  {
    keys: "1|H17|DAS|*|*", cell: "pair:9:11", chosen: "P", engine: "P", margin: 0.0002, runnerUp: "stand",
    sources: "Wizard of Odds chart (Ps), Hoppe's computed 1-deck H17 table, Nairn's EVs (split by 0.0022): P. Hoppe notes that the Wizard's hand calculator says stand.",
    rationale: "The thinnest split on any card. The published charts split, and so does the engine."
  },

  // ---- Rules with no published chart: split cells under restricted doubling (1 deck) ----
  {
    keys: "1|S17|DAS|*|10-11", cell: "pair:4:4", chosen: "H", engine: "H", margin: 0.0013, runnerUp: "split",
    sources: "No published chart. Nairn's 1-deck EVs (double 10-11 also after splits): hit +0.09786 vs split +0.09739, hit by 0.0005.",
    rationale:
      "The only split cell that a doubling restriction changes in any rule set. Splitting 4s loses its 4+5 = 9 doubles, so P (double-any) becomes H. The engine's hit value equals Nairn's to five places."
  },
  {
    keys: "1|S17|DAS|*|10-11", cell: "pair:4:6", chosen: "P", engine: "P", margin: 0.0157, runnerUp: "hit",
    sources: "No published chart. Nairn's 1-deck EVs: split.",
    rationale:
      "A derivation bug, now fixed. Doubling 4,4 (hard 8) as if allowed scores +0.193, which beats splitting (+0.191), so the cell came out Dh, which falls back to hit. Under 10-11 that double isn't allowed, and split beats hit by 0.0157. derive.ts now falls back to the split for pairs."
  },

  // ---- Thin cells (< 0.003) where every published chart agrees with the engine ----
  {
    keys: "1|S17|*|*|any", cell: "soft:8:6", chosen: "Ds", engine: "Ds", margin: 0.0003, runnerUp: "stand",
    sources: "Wizard of Odds, Hoppe, Nairn (by 0.0003), Phrack 1993, Hi-Opt I: Ds.", rationale: "A,8 v 6 in a single deck, S17."
  },
  {
    keys: "2|S17|*|*|*", cell: "soft:7:11", chosen: "H", engine: "H", margin: 0.0001, runnerUp: "stand",
    sources: "Wizard of Odds, blackjackinfo engine: H.", rationale: "A,7 v A, 2 decks S17. Stand in 1 deck S17, hit everywhere else."
  },
  {
    keys: "2|S17|*|*|any", cell: "soft:6:2", chosen: "H", engine: "H", margin: 0.0006, runnerUp: "double",
    sources: "Wizard of Odds, blackjackinfo engine: H.", rationale: "A,6 v 2: double in 1 deck, hit from 2 decks up."
  },
  {
    keys: "2|H17|*|*|any", cell: "soft:6:2", chosen: "H", engine: "H", margin: 0.0002, runnerUp: "double",
    sources: "Wizard of Odds, blackjackinfo engine: H.", rationale: "As above, with H17."
  },
  {
    keys: "2|H17|*|*|any", cell: "soft:3:4", chosen: "Dh", engine: "Dh", margin: 0.0005, runnerUp: "hit",
    sources: "Wizard of Odds, blackjackinfo engine, gsdriver: Dh.", rationale: "A,3 v 4 doubles in 2 decks only when the dealer hits soft 17."
  },
  {
    keys: "2|S17|*|*|any", cell: "soft:3:4", chosen: "H", engine: "H", margin: 0.0013, runnerUp: "double",
    sources: "Wizard of Odds, blackjackinfo engine: H.", rationale: "A,3 v 4, 2 decks S17."
  },
  {
    keys: "2|H17|*|*|any", cell: "soft:7:2", chosen: "Ds", engine: "Ds", margin: 0.0006, runnerUp: "stand",
    sources: "Wizard of Odds, blackjackinfo engine: Ds.", rationale: "A,7 v 2 with H17: double in 2+ decks, stand in 1 deck."
  },
  {
    keys: "4-8|S17|*|*|*", cell: "hard:12:4", chosen: "S", engine: "S", margin: 0.0027, runnerUp: "hit",
    sources: "Original Strategy Drill card, Wizard of Odds, blackjackinfo engine, Hoppe: S.", rationale: "12 v 4, multi-deck S17."
  },
  {
    keys: "4-8|S17|*|*|any", cell: "soft:2:5", chosen: "Dh", engine: "Dh", margin: 0.0025, runnerUp: "hit",
    sources: "Original card, Wizard of Odds, blackjackinfo engine, Hoppe: Dh.", rationale: "A,2 v 5, multi-deck S17."
  },
  {
    keys: "4-8|S17|*|*|any", cell: "soft:4:4", chosen: "Dh", engine: "Dh", margin: 0.0030, runnerUp: "hit",
    sources: "Original card, Wizard of Odds, blackjackinfo engine, Hoppe: Dh.", rationale: "A,4 v 4, multi-deck S17."
  },
  {
    keys: "1|*|*|LS|*", cell: "hard:15:10", chosen: "H", engine: "H", margin: 0.0020, runnerUp: "surrender",
    sources: "Wizard of Odds, Hoppe, Nairn (by 0.0016), gsdriver: H.", rationale: "15 v 10 surrenders from 2 decks up but not in a single deck."
  },
  {
    keys: "2|*|*|LS|*", cell: "hard:15:10", chosen: "Rh", engine: "Rh", margin: 0.0014, runnerUp: "hit",
    sources: "Wizard of Odds, blackjackinfo engine: Rh.", rationale: "15 v 10, 2 decks."
  },
  {
    keys: "1|H17|*|LS|*", cell: "hard:17:11", chosen: "Rs", engine: "Rs", margin: 0.0013, runnerUp: "stand",
    sources: "Wizard of Odds, Hoppe: Rs.", rationale: "17 v A when the dealer hits soft 17, 1 deck."
  },
  {
    keys: "2|S17|NDAS|*|*", cell: "pair:6:2", chosen: "P", engine: "P", margin: 0.0013, runnerUp: "hit",
    sources: "Wizard of Odds, blackjackinfo engine: P.", rationale: "6,6 v 2 without DAS splits in 1-2 decks, hits in 4-8 decks."
  },
  {
    keys: "2|*|DAS|*|*", cell: "pair:7:8", chosen: "P", engine: "P", margin: 0.0029, runnerUp: "hit",
    sources: "Wizard of Odds, blackjackinfo engine (including 9-11 and 10-11): P.", rationale: "7,7 v 8 with DAS, 1-2 decks."
  },

  // ---- Soft 12 that can't be split (row 1): not on the printed card, so no published row except Wikipedia's 4-8 deck footnote ----
  {
    keys: "2|S17|*|*|any", cell: "soft:1:5", chosen: "Dh", engine: "Dh", margin: 0.0014, runnerUp: "hit",
    sources: "No published chart for 2 decks.",
    rationale:
      "Only for a two-card A,A that can't be split but can be doubled, which doesn't happen under these rules. Split aces get one card and stand; a soft 12 with 3+ cards can't double, so it hits."
  },
  {
    keys: "2|H17|*|*|any", cell: "soft:1:5", chosen: "Dh", engine: "Dh", margin: 0.0020, runnerUp: "hit",
    sources: "No published chart for 2 decks.", rationale: "As above."
  },
  {
    keys: "4-8|S17|*|*|any", cell: "soft:1:6", chosen: "Dh", engine: "Dh", margin: 0.0027, runnerUp: "hit",
    sources: "Wikipedia's 4-8 deck chart footnote (A,A when splitting is forbidden but hitting allowed): H H H H Dh H H H H H.",
    rationale: "Matches Wikipedia's footnote row (which is H17; with H17 the double wins by 0.0168)."
  }
];
