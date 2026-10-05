// Basic strategy tables for every rule set the app supports: 3 deck groups x dealer H17/S17 x DAS / no
// DAS x late surrender / none x double any two cards / hard 9-11 only / hard 10-11 only = 72 charts.
//
// RULES ASSUMED (see types.ts): the dealer peeks for blackjack (US hole card), so every play is the best
// one given that the dealer does NOT have blackjack; blackjack pays 3:2; split up to 4 hands; split aces
// get one card each and can't be resplit (split ace + ten = 21, not blackjack); no doubling or surrender
// after hitting; late surrender only on the first two cards and never after a split; a doubling
// restriction applies to hard totals (soft hands can't be doubled under it) and to doubling after a split.
//
// HOW THESE TABLES WERE MADE (STRATEGY.md has the full story):
//  * Derived from the exact-shoe EV engine in src/engine. scripts/derive-strategy.ts writes
//    src/strategy/derived.json. It is TOTAL-DEPENDENT basic strategy: each hard total weights its
//    two-card compositions by how likely they are to be dealt, given the upcard and no dealer blackjack.
//    "4-8" decks is modelled as 6 decks. Deriving at 4, 5 and 8 decks changes nothing, except 4,4 v 5
//    (S17, DAS, double 10-11) at 8 decks, which hits by 0.0006. There the 6-deck split (by 0.0027) is
//    kept; blackjackinfo's 8-deck chart also splits.
//  * Cross-checked cell by cell against 72 published charts: Wizard of Odds (1, 2 and 4+ decks; all 24
//    double-any rule sets) and the blackjackinfo.com strategy engine (48 charts at 2, 6 and 8 decks;
//    double-any, plus 9-11 and 10-11 with DAS). Also checked against the original Strategy Drill card
//    (4-8 decks), Hoppe's computed 1- and 6-deck tables, Nairn's 1-deck EV tables and Wikipedia. Every
//    cell agrees except one. 2 decks H17 DAS LS 8,8 v A: Wizard of Odds says Rp, blackjackinfo P.
//    The sources disagree, so this file follows the engine: P, by 0.0061.
//  * close-calls.ts lists every disputed or thin (margin < 0.003) cell. It also lists every deliberate
//    deviation from the engine, and there are none. tables.test.ts checks this file against
//    derived.json, the original card and the rules of the game.
//
// LAYOUT. Each deck group has a base chart for S17, DAS, late surrender and double-any, laid out like
// the classic printed card (columns = dealer 2 3 4 5 6 7 8 9 10 A), plus small override maps.
// strategyCode() applies, in order: the H17 changes, the no-DAS changes, the extra H17 + no-DAS
// changes, then the doubling-restriction changes. Last, without surrender it turns Rh -> H, Rs -> S,
// Rp -> P. Dropping the R is exact: the engine never finds double as the best non-surrender action
// in a surrender cell.
//
// DOUBLING RESTRICTIONS. A first-two-card double keeps its Dh / Ds code even when rules.double forbids
// it for that total. The caller falls back to the second letter via canDouble(), and the engine
// confirms that fallback is the best legal play in every cell of every rule set. Only split cells can
// change with a restriction, because doubling after a split obeys it too.
//
// OFF-CARD ROWS (engine-checked for every rule set):
//  * hard 4-7: always hit; hard 18-21: always stand.
//  * soft 21 (row 10): stand.
//  * soft 12 (row 1, A,A that can't be split): hit, but double vs 6 (4-8 decks; Wikipedia's footnote
//    row agrees) or vs 5-6 (1-2 decks). A split ace never uses this row: it gets one card and stands.

import type { Category, Code, DeckGroup, DoubleRule, Rules, Upcard } from "./types";
import { CODES, UPCARDS } from "./types";

/** Chart rows: row number -> 10 codes for dealer 2..10, A, separated by spaces. */
type Rows = Record<number, string>;
/** Cell id ("hard:16:10", "soft:7:2", "pair:8:11") -> code. */
type Overrides = Record<string, Code>;

interface DeckChart {
  /** Base chart: dealer stands on soft 17, DAS, late surrender, double any two cards. Hard 8..17. */
  hard: Rows;
  /** Soft rows 1..9 (A,A .. A,9). */
  soft: Rows;
  /** Pair rows 2..11 (11 = A,A). */
  pair: Rows;
  /** Changes when the dealer hits soft 17. */
  h17: Overrides;
  /** Changes without double after split. */
  noDas: Overrides;
  /** Extra changes when the dealer hits soft 17 AND there is no DAS (applied after both maps above). */
  h17NoDas: Overrides;
}

const CHARTS: Record<DeckGroup, DeckChart> = {
  // ---------------------------------------------------------------- single deck
  "1": {
    hard: {
      // columns: dealer 2, 3, 4, 5, 6, 7, 8, 9, 10, A
      8: "H H H Dh Dh H H H H H",
      9: "Dh Dh Dh Dh Dh H H H H H",
      10: "Dh Dh Dh Dh Dh Dh Dh Dh H H",
      11: "Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh",
      12: "H H S S S H H H H H",
      13: "S S S S S H H H H H",
      14: "S S S S S H H H H H",
      15: "S S S S S H H H H H",
      16: "S S S S S H H H Rh Rh",
      17: "S S S S S S S S S S"
    },
    soft: {
      1: "H H H Dh Dh H H H H H",
      2: "H H Dh Dh Dh H H H H H",
      3: "H H Dh Dh Dh H H H H H",
      4: "H H Dh Dh Dh H H H H H",
      5: "H H Dh Dh Dh H H H H H",
      6: "Dh Dh Dh Dh Dh H H H H H",
      7: "S Ds Ds Ds Ds S S H H S",
      8: "S S S S Ds S S S S S",
      9: "S S S S S S S S S S"
    },
    pair: {
      2: "P P P P P P H H H H",
      3: "P P P P P P P H H H",
      4: "H H P P P H H H H H",
      5: "Dh Dh Dh Dh Dh Dh Dh Dh H H",
      6: "P P P P P P H H H H",
      7: "P P P P P P P H Rs H",
      8: "P P P P P P P P P P",
      9: "P P P P P S P P S S",
      10: "S S S S S S S S S S",
      11: "P P P P P P P P P P"
    },
    h17: {
      "hard:15:11": "Rh",
      "hard:17:11": "Rs",
      "soft:7:11": "H",
      "pair:7:11": "Rh",
      "pair:9:11": "P" // split by 0.0022 (Nairn's exact splits give the same); Wizard of Odds and Hoppe agree
    },
    noDas: {
      "pair:2:2": "H",
      "pair:3:2": "H",
      "pair:3:3": "H",
      "pair:3:8": "H",
      "pair:4:4": "H",
      "pair:4:5": "Dh",
      "pair:4:6": "Dh",
      "pair:6:7": "H",
      "pair:7:8": "H"
    },
    h17NoDas: {
      "pair:9:11": "S"
    }
  },

  // ---------------------------------------------------------------- double deck
  "2": {
    hard: {
      // columns: dealer 2, 3, 4, 5, 6, 7, 8, 9, 10, A
      8: "H H H H H H H H H H",
      9: "Dh Dh Dh Dh Dh H H H H H",
      10: "Dh Dh Dh Dh Dh Dh Dh Dh H H",
      11: "Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh",
      12: "H H S S S H H H H H",
      13: "S S S S S H H H H H",
      14: "S S S S S H H H H H",
      15: "S S S S S H H H Rh H",
      16: "S S S S S H H H Rh Rh",
      17: "S S S S S S S S S S"
    },
    soft: {
      1: "H H H Dh Dh H H H H H",
      2: "H H H Dh Dh H H H H H",
      3: "H H H Dh Dh H H H H H",
      4: "H H Dh Dh Dh H H H H H",
      5: "H H Dh Dh Dh H H H H H",
      6: "H Dh Dh Dh Dh H H H H H",
      7: "S Ds Ds Ds Ds S S H H H",
      8: "S S S S S S S S S S",
      9: "S S S S S S S S S S"
    },
    pair: {
      2: "P P P P P P H H H H",
      3: "P P P P P P H H H H",
      4: "H H H P P H H H H H",
      5: "Dh Dh Dh Dh Dh Dh Dh Dh H H",
      6: "P P P P P P H H H H",
      7: "P P P P P P P H H H",
      8: "P P P P P P P P P P",
      9: "P P P P P S P P S S",
      10: "S S S S S S S S S S",
      11: "P P P P P P P P P P"
    },
    h17: {
      "hard:15:11": "Rh",
      "hard:17:11": "Rs",
      "soft:3:4": "Dh",
      "soft:7:2": "Ds",
      "soft:8:6": "Ds"
      // pair:8:11 stays P with DAS (split beats surrender by 0.0061): blackjackinfo agrees, Wizard of Odds says Rp.
    },
    noDas: {
      "pair:2:2": "H",
      "pair:2:3": "H",
      "pair:3:2": "H",
      "pair:3:3": "H",
      "pair:4:5": "H",
      "pair:4:6": "H",
      "pair:6:7": "H",
      "pair:7:8": "H"
    },
    h17NoDas: {
      "pair:8:11": "Rp"
    }
  },

  // ---------------------------------------------------------------- 4 to 8 decks (the original Strategy Drill card)
  "4-8": {
    hard: {
      // columns: dealer 2, 3, 4, 5, 6, 7, 8, 9, 10, A
      8: "H H H H H H H H H H",
      9: "H Dh Dh Dh Dh H H H H H",
      10: "Dh Dh Dh Dh Dh Dh Dh Dh H H",
      11: "Dh Dh Dh Dh Dh Dh Dh Dh Dh H",
      12: "H H S S S H H H H H",
      13: "S S S S S H H H H H",
      14: "S S S S S H H H H H",
      15: "S S S S S H H H Rh H",
      16: "S S S S S H H Rh Rh Rh",
      17: "S S S S S S S S S S"
    },
    soft: {
      1: "H H H H Dh H H H H H",
      2: "H H H Dh Dh H H H H H",
      3: "H H H Dh Dh H H H H H",
      4: "H H Dh Dh Dh H H H H H",
      5: "H H Dh Dh Dh H H H H H",
      6: "H Dh Dh Dh Dh H H H H H",
      7: "S Ds Ds Ds Ds S S H H H",
      8: "S S S S S S S S S S",
      9: "S S S S S S S S S S"
    },
    pair: {
      2: "P P P P P P H H H H",
      3: "P P P P P P H H H H",
      4: "H H H P P H H H H H",
      5: "Dh Dh Dh Dh Dh Dh Dh Dh H H",
      6: "P P P P P H H H H H",
      7: "P P P P P P H H H H",
      8: "P P P P P P P P P P",
      9: "P P P P P S P P S S",
      10: "S S S S S S S S S S",
      11: "P P P P P P P P P P"
    },
    h17: {
      "hard:11:11": "Dh",
      "hard:15:11": "Rh",
      "hard:17:11": "Rs",
      "soft:7:2": "Ds",
      "soft:8:6": "Ds",
      "pair:8:11": "Rp"
    },
    noDas: {
      "pair:2:2": "H",
      "pair:2:3": "H",
      "pair:3:2": "H",
      "pair:3:3": "H",
      "pair:4:5": "H",
      "pair:4:6": "H",
      "pair:6:2": "H"
    },
    h17NoDas: {}
  }
};

/** Split changes caused by a doubling restriction (it also limits doubling after a split). */
const RESTRICTED: Array<{ decks: DeckGroup; h17: boolean; das: boolean; double: Exclude<DoubleRule, "any">; cells: Overrides }> = [
  // 1 deck, S17, DAS on 10-11 only: splitting 4s loses its 4+5 = 9 doubles, so 4,4 v 4 hits, by
  // 0.0005 (hit +0.09786, split +0.09739, the same as Nairn's exact 1-deck values). Every other split
  // is unchanged in every rule set.
  { decks: "1", h17: false, das: true, double: "10-11", cells: { "pair:4:4": "H" } }
];

const WITHOUT_SURRENDER: Partial<Record<Code, Code>> = { Rh: "H", Rs: "S", Rp: "P" };

/** Rows strategyCode accepts, per section (see types.ts). */
export const ROW_RANGE: Record<Category, readonly [number, number]> = { hard: [4, 21], soft: [1, 10], pair: [2, 11] };

// ---------------------------------------------------------------------------------------------
// Validate the data once at load time, so a typo fails loudly instead of returning a wrong play.

const STORED_ROWS: Record<Category, number[]> = {
  hard: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  soft: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  pair: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

function parseRow(line: string, where: string): Code[] {
  const codes = line.trim().split(/\s+/) as Code[];
  if (codes.length !== UPCARDS.length || codes.some((c) => !CODES.includes(c))) {
    throw new Error(`strategy tables: bad row ${where}: "${line}"`);
  }
  return codes;
}

/** Base cells per deck group, keyed by cell id. */
const BASE: Record<DeckGroup, Map<string, Code>> = {} as Record<DeckGroup, Map<string, Code>>;
for (const [decks, chart] of Object.entries(CHARTS) as Array<[DeckGroup, DeckChart]>) {
  const cells = new Map<string, Code>();
  for (const cat of ["hard", "soft", "pair"] as Category[]) {
    const rows = Object.keys(chart[cat]).map(Number);
    if (rows.join() !== STORED_ROWS[cat].join()) throw new Error(`strategy tables: ${decks} ${cat} rows must be ${STORED_ROWS[cat].join(",")}`);
    for (const row of rows) {
      parseRow(chart[cat][row], `${decks} ${cat}:${row}`).forEach((code, i) => cells.set(`${cat}:${row}:${UPCARDS[i]}`, code));
    }
  }
  const overrideMaps = [chart.h17, chart.noDas, chart.h17NoDas, ...RESTRICTED.filter((r) => r.decks === decks).map((r) => r.cells)];
  for (const o of overrideMaps) {
    for (const [id, code] of Object.entries(o)) {
      if (!cells.has(id) || !CODES.includes(code)) throw new Error(`strategy tables: bad override ${decks} ${id} = ${code}`);
    }
  }
  BASE[decks] = cells;
}

// ---------------------------------------------------------------------------------------------

const comboKey = (r: Rules): string =>
  `${r.decks}|${r.h17 ? "H17" : "S17"}|${r.das ? "DAS" : "NDAS"}|${r.surrender ? "LS" : "NS"}|${r.double}`;

const cache = new Map<string, Map<string, Code>>();

/** Every stored cell for one rule set. */
function tableFor(rules: Rules): Map<string, Code> {
  const key = comboKey(rules);
  const hit = cache.get(key);
  if (hit) return hit;
  const chart = CHARTS[rules.decks];
  if (!chart) throw new RangeError(`strategy tables: unknown deck group ${String(rules.decks)}`);
  const table = new Map(BASE[rules.decks]);
  const apply = (o: Overrides) => Object.entries(o).forEach(([id, code]) => table.set(id, code));
  if (rules.h17) apply(chart.h17);
  if (!rules.das) apply(chart.noDas);
  if (rules.h17 && !rules.das) apply(chart.h17NoDas);
  for (const r of RESTRICTED) {
    if (r.decks === rules.decks && r.h17 === rules.h17 && r.das === rules.das && r.double === rules.double) apply(r.cells);
  }
  if (!rules.surrender) {
    for (const [id, code] of table) {
      const plain = WITHOUT_SURRENDER[code];
      if (plain) table.set(id, plain);
    }
  }
  cache.set(key, table);
  return table;
}

/**
 * The basic strategy code for a chart square under the given rules.
 *   hard: row = hard total 4..21; soft: row = non-ace part 1..10 (soft 12..21); pair: row = 2..11 (11 = A,A).
 * Throws a RangeError for rows or upcards outside those ranges.
 */
export function strategyCode(cat: Category, row: number, up: Upcard, rules: Rules): Code {
  const range = ROW_RANGE[cat];
  if (!range) throw new RangeError(`strategyCode: unknown section ${String(cat)}`);
  if (!Number.isInteger(row) || row < range[0] || row > range[1]) {
    throw new RangeError(`strategyCode: ${cat} row must be ${range[0]}..${range[1]}, got ${row}`);
  }
  if (!UPCARDS.includes(up)) throw new RangeError(`strategyCode: upcard must be 2..11, got ${up}`);
  if (cat === "hard" && row < 8) return "H";
  if (cat === "hard" && row > 17) return "S";
  if (cat === "soft" && row === 10) return "S";
  return tableFor(rules).get(`${cat}:${row}:${up}`) as Code;
}

/** Short human description of the chart, e.g. "4–8 decks · Dealer stands on soft 17 · ...". */
export function chartSummary(rules: Rules): string {
  const decks = rules.decks === "1" ? "1 deck" : rules.decks === "2" ? "2 decks" : "4–8 decks";
  const dbl =
    rules.double === "any" ? "Double any two cards" : rules.double === "9-11" ? "Double on hard 9–11 only" : "Double on hard 10–11 only";
  return [
    decks,
    rules.h17 ? "Dealer hits soft 17" : "Dealer stands on soft 17",
    rules.das ? "Double after split" : "No double after split",
    rules.surrender ? "Late surrender" : "No surrender",
    dbl
  ].join(" · ");
}
