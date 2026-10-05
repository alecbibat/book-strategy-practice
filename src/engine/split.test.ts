import { describe, expect, it } from "vitest";
import type { Rank, Rules } from "../strategy/types";
import { DECK_GROUPS, engineDecks } from "../strategy/types";
import { configValue, expectedHandCounts, freshShoe, handEVs, HandContext, splitConfigs, splitHandTable, splitValues, withoutCards } from "./index";

/**
 * Independent enumeration of the resplit process: every sequence of second cards (P = pair card,
 * O = other card), dealt one at a time to the hands waiting for one, with exact draw probabilities.
 * Returns P(hands produced, stuck hands) keyed "p,q".
 */
function enumerateDeals(nx: number, n: number, handsAfter: number, maxHands: number): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (seq: string, prob: number): void => {
    // Replay the sequence from the start: simple and obviously right.
    let waiting = 2, inPlay = handsAfter, produced = 2, stuck = 0, pairsDrawn = 0;
    for (const c of seq) {
      if (c === "P") {
        pairsDrawn++;
        if (inPlay < maxHands) { inPlay++; produced++; waiting++; } else { stuck++; waiting--; }
      } else waiting--;
    }
    if (waiting === 0) {
      const key = produced + "," + stuck;
      out.set(key, (out.get(key) ?? 0) + prob);
      return;
    }
    const left = n - seq.length;
    const pairsLeft = nx - pairsDrawn;
    if (pairsLeft > 0) walk(seq + "P", (prob * pairsLeft) / left);
    if (left - pairsLeft > 0) walk(seq + "O", (prob * (left - pairsLeft)) / left);
  };
  walk("", 1);
  return out;
}

describe("resplit configurations", () => {
  it("match an independent enumeration of every deal exactly", () => {
    for (const [nx, n] of [[2, 48], [1, 47], [0, 46], [22, 310], [6, 98], [4, 30]]) {
      for (const [handsAfter, maxHands] of [[2, 4], [3, 4], [4, 4], [2, 2], [2, 3]]) {
        const want = enumerateDeals(nx, n, handsAfter, maxHands);
        const got = splitConfigs(nx, n, handsAfter, maxHands);
        expect(got.reduce((s, c) => s + c.prob, 0)).toBeCloseTo(1, 12);
        expect(got.length).toBe(want.size);
        for (const c of got) expect(c.prob, `${nx}/${n} ${handsAfter}->${maxHands} p=${c.p} q=${c.q}`).toBeCloseTo(want.get(c.p + "," + c.q) ?? NaN, 12);
      }
    }
  });

  it("with no resplits allowed, each of the 2 hands is stuck with probability p(pair card)", () => {
    const [en, es] = expectedHandCounts(22, 310, 2, 2, 2);
    expect(es).toBeCloseTo((2 * 22) / 310, 12);
    expect(en + es).toBeCloseTo(2, 12);
  });
});

describe("split model", () => {
  const R = (decks: Rules["decks"], h17: boolean, das: boolean, double: Rules["double"] = "any"): Rules =>
    ({ decks, h17, das, surrender: false, double });
  const table = (decks: number, up: Rank, x: Rank, h17: boolean, levels?: number) =>
    splitHandTable(new HandContext(withoutCards(freshShoe(decks), [up, x], "shoe"), up, h17), x, { levels });

  it("with resplitting switched off, the configuration sum equals two hands with both pair cards out (identity)", () => {
    // Exercises the configuration distribution, the hypergeometric removal of the other hands' second
    // cards and the depletion levels: with maxHands = handsAfter they must collapse exactly.
    for (const decks of [1, 2, 6]) {
      for (const [up, x] of [[6, 8], [10, 2], [1, 9], [5, 4], [9, 3]] as Array<[Rank, Rank]>) {
        const t = table(decks, up, x, false);
        for (const rules of [R("1", false, true), R("1", false, false), R("1", false, true, "10-11")]) {
          const v = splitValues(t, rules, 2);
          expect(configValue(t, rules, 2, 2), `${decks}D ${x},${x} v ${up}`).toBeCloseTo(v.noResplit, 12);
          expect(configValue(t, rules, 3, 3)).toBeCloseTo(v.noResplit, 12);
        }
      }
    }
  });

  // Nairn's exact single-deck splitting tables (github.com/nairnj/Blackjack webtables/OneDeck.html,
  // "EXACT SPLITTING"; values for A and 10 up are conditional on no dealer blackjack). Columns:
  // MH = max hands 2 / 3 / 4 (MH 2 = no resplit), DD = doubling after the split: No / Any / 10&11.
  // [rules, upcard (1 = ace), pair card, DD, [MH2, MH3, MH4]] (aces: MH2 only, no resplit).
  // These are cells where Nairn's no-resplit value equals the engine's (exact) one, i.e. where Nairn's
  // split hands are played the same way; see the next test for the others.
  const NAIRN: Array<["S17" | "H17", number, number, "No" | "Any" | "10&11", number[]]> = [
    ["S17", 6, 8, "No", [0.233716, 0.267683, 0.269513]],
    ["S17", 6, 8, "Any", [0.34037, 0.383004, 0.385294]],
    ["S17", 6, 8, "10&11", [0.340021, 0.38259, 0.384873]],
    ["S17", 5, 2, "No", [0.127678, 0.136, 0.136489]],
    ["S17", 5, 2, "10&11", [0.235914, 0.253521, 0.254528]],
    ["S17", 4, 3, "No", [0.00933911, 0.0153797, 0.0157778]],
    ["S17", 4, 3, "Any", [0.135241, 0.152335, 0.153363]],
    ["S17", 6, 6, "Any", [0.155507, 0.16934, 0.16934]],
    ["S17", 6, 6, "10&11", [0.108253, 0.120067, 0.120067]],
    ["S17", 4, 9, "Any", [0.299234, 0.308672, 0.309099]],
    ["S17", 1, 8, "No", [-0.340317, -0.325769, -0.324889]],
    ["S17", 1, 8, "Any", [-0.333718, -0.318552, -0.317635]],
    ["H17", 1, 9, "Any", [-0.185971, -0.184139, -0.18394]],
    ["S17", 5, 7, "Any", [0.193212, 0.222213, 0.223782]],
    ["H17", 6, 8, "10&11", [0.308012, 0.34513, 0.347113]],
    ["H17", 4, 2, "Any", [0.118095, 0.130955, 0.131666]],
    ["S17", 2, 2, "Any", [-0.0393101, -0.0358712, -0.0358712]],
    ["S17", 1, 4, "Any", [-0.535358, -0.562365, -0.563821]],
    ["S17", 6, 4, "10&11", [0.191026, 0.19389, 0.194133]],
    ["H17", 5, 4, "Any", [0.259383, 0.267434, 0.26786]],
    ["S17", 10, 1, "No", [0.194252]],
    ["S17", 6, 1, "No", [0.758276]]
  ];

  it("matches Nairn's exact single-deck split values (no resplit to 1e-5, resplits to 2e-4)", () => {
    for (const [s17, up, x, dd, vals] of NAIRN) {
      const h17 = s17 === "H17";
      const rules = R("1", h17, dd !== "No", dd === "10&11" ? "10-11" : "any");
      const t = table(1, up as Rank, x as Rank, h17);
      const where = `${s17} ${x},${x} v ${up} DD ${dd}`;
      expect(Math.abs(splitValues(t, rules, 2).noResplit - vals[0]), where + " MH2").toBeLessThan(1e-5);
      if (x === 1) continue;
      expect(Math.abs(splitValues(t, rules, 2, 3).resplit! - vals[1]), where + " MH3").toBeLessThan(2e-4);
      expect(Math.abs(splitValues(t, rules, 2, 4).resplit! - vals[2]), where + " MH4").toBeLessThan(2e-4);
    }
    // The old model (each hand valued with only the two original pair cards out) misses by up to 0.005.
    const old = splitValues(table(1, 6, 8, false, 1), R("1", false, true), 2, 4).resplit!;
    expect(Math.abs(old - 0.385294)).toBeGreaterThan(1e-3);
  });

  it("is above Nairn where Nairn's split hands keep the unsplit hand's decisions (documented discrepancy)", () => {
    // In about half of Nairn's single-deck split cells, even the no-resplit value (which the engine
    // computes exactly) is lower than the engine's, by up to 0.009. Playing each split hand with the
    // decisions of the UNSPLIT hand (the other pair card still counted in the shoe) reproduces several
    // of them exactly, e.g. 2,2 v 6 S17 no DAS: 0.118982. A real-deal Monte Carlo of the engine's
    // own play gives 0.1271 +- 0.0006 (8M rounds), so the engine's 0.1259 is achievable and Nairn's
    // value is for weaker split-hand play. The tables use the engine's values.
    const v = splitValues(table(1, 6, 2, false), R("1", false, false), 2).noResplit;
    expect(v - 0.118982).toBeGreaterThan(0.006);
    expect(v).toBeCloseTo(0.12593, 4);
  });

  it("converges in the number of depletion levels", () => {
    for (const decks of [2, 6]) {
      for (const [up, x] of [[2, 2], [10, 8], [6, 6]] as Array<[Rank, Rank]>) {
        const rules = R("4-8", false, true);
        const a = splitValues(table(decks, up, x, false, 3), rules, 2).resplit!;
        const b = splitValues(table(decks, up, x, false, 6), rules, 2).resplit!;
        expect(Math.abs(a - b), `${decks}D ${x},${x} v ${up}`).toBeLessThan(1e-5);
      }
    }
  });
});

describe("split EV", () => {
  const rules: Rules = { decks: "4-8", h17: false, das: true, surrender: false, double: "any" };
  it("DAS makes splitting small pairs against weak cards more valuable", () => {
    for (const x of [2, 3, 4, 6] as const) {
      const das = handEVs({ player: [x, x], up: 5, rules }).split as number;
      const ndas = handEVs({ player: [x, x], up: 5, rules: { ...rules, das: false } }).split as number;
      expect(das).toBeGreaterThan(ndas);
      // Restricting doubles to 10-11 also limits doubling after the split.
      const r1011 = handEVs({ player: [x, x], up: 5, rules: { ...rules, double: "10-11" } }).split as number;
      expect(r1011).toBeLessThanOrEqual(das);
      expect(r1011).toBeGreaterThanOrEqual(ndas);
    }
  });
  it("split aces: one card each, so DAS and the double rule don't matter", () => {
    const a = handEVs({ player: [1, 1], up: 6, rules }).split;
    expect(handEVs({ player: [1, 1], up: 6, rules: { ...rules, das: false, double: "10-11" } }).split).toBe(a);
  });
  it("is finite for every pair, upcard and deck group", () => {
    for (const decks of DECK_GROUPS) {
      for (let x = 1; x <= 10; x++) {
        for (const up of [1, 2, 6, 10] as Rank[]) {
          const s = handEVs({ player: [x, x] as Rank[], up, rules: { ...rules, decks } }).split;
          expect(Number.isFinite(s), `${decks} ${engineDecks(decks)} ${x},${x} v ${up}`).toBe(true);
        }
      }
    }
  });
});
