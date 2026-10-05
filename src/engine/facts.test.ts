// Famous composition facts, API behaviour and performance.
import { describe, expect, it } from "vitest";
import type { Rank, Rules } from "../strategy/types";
import { clearEngineCache, handEVs } from "./index";
import { computeUpcard, cellEVs } from "./derive";

const R = (decks: Rules["decks"], h17 = false, das = true, surrender = false, double: Rules["double"] = "any"): Rules =>
  ({ decks, h17, das, surrender, double });

describe("composition facts", () => {
  it("16 vs 10 in 6 decks: stand and hit are within about half a percent", () => {
    const rules = R("4-8");
    for (const player of [[10, 6], [9, 7]] as Rank[][]) {
      const e = handEVs({ player, up: 10, rules });
      expect(Math.abs(e.stand - e.hit)).toBeLessThan(0.0075);
    }
    // Total-dependent (both compositions weighted by how often they are dealt).
    const ev = cellEVs(computeUpcard("4-8", false, 10), "hard", 16, rules);
    expect(Math.abs(ev.stand - ev.hit)).toBeLessThan(0.0075);
    expect(ev.hit).toBeGreaterThan(ev.stand); // the chart says hit
    // 3-card 16s favour standing: 10,4,2 vs 10 (small cards gone, tens relatively rich).
    const three = handEVs({ player: [10, 4, 2], up: 10, rules });
    expect(three.stand).toBeGreaterThan(three.hit);
  });

  it("1 deck S17: 7,7 vs 10 stand beats hit", () => {
    const e = handEVs({ player: [7, 7], up: 10, rules: R("1", false, false) });
    expect(e.stand).toBeGreaterThan(e.hit);
  });

  it("1 deck S17: doubling 11 vs A beats hitting (every composition); in 6 decks S17 hitting is better", () => {
    for (const player of [[2, 9], [3, 8], [4, 7], [5, 6]] as Rank[][]) {
      const e = handEVs({ player, up: 1, rules: R("1") });
      expect(e.double as number).toBeGreaterThan(e.hit);
    }
    const six = cellEVs(computeUpcard("4-8", false, 11), "hard", 11, R("4-8"));
    expect(six.hit).toBeGreaterThan(six.double);
    const sixH17 = cellEVs(computeUpcard("4-8", true, 11), "hard", 11, R("4-8", true));
    expect(sixH17.double).toBeGreaterThan(sixH17.hit);
  });

  it("1 deck S17: A,8 vs 6 doubles, 6 decks S17 stands", () => {
    const one = handEVs({ player: [1, 8], up: 6, rules: R("1") });
    expect(one.double as number).toBeGreaterThan(one.stand);
    const six = handEVs({ player: [1, 8], up: 6, rules: R("4-8") });
    expect(six.stand).toBeGreaterThan(six.double as number);
  });

  it("removing cards moves EVs the right way", () => {
    // 12 vs 2 when lots of tens are known to be gone: hitting gets better.
    const plain = handEVs({ player: [10, 2], up: 2, rules: R("1") });
    const tensGone = handEVs({ player: [10, 2], up: 2, rules: R("1"), seen: [10, 10, 10, 10, 10, 10] });
    expect(tensGone.hit - tensGone.stand).toBeGreaterThan(plain.hit - plain.stand);
    // Card order doesn't matter.
    expect(handEVs({ player: [6, 10], up: 9, rules: R("2") })).toEqual(handEVs({ player: [10, 6], up: 9, rules: R("2") }));
  });

  it("hitting hard 16 is exactly one card then stand (hit = double / 2)", () => {
    const e = handEVs({ player: [9, 7], up: 10, rules: R("2") });
    expect(e.hit).toBeCloseTo((e.double as number) / 2, 12);
  });
});

describe("handEVs API", () => {
  it("throws a clear error for impossible cards", () => {
    expect(() => handEVs({ player: [1, 1], up: 1, rules: R("1"), seen: [1, 1] })).toThrow(/5 aces requested but a 1-deck shoe holds only 4/);
    expect(() => handEVs({ player: [10, 6], up: 1, rules: R("1"), seen: [1, 1, 1, 1] })).toThrow(/aces/);
    expect(() => handEVs({ player: [10], up: 1, rules: R("1") })).toThrow(/at least 2 cards/);
    expect(() => handEVs({ player: [10, 6, 9], up: 1, rules: R("1") })).toThrow(/bust/);
    expect(() => handEVs({ player: [11 as Rank, 6], up: 1, rules: R("1") })).toThrow(/rank/);
  });

  it("naturals pay 3:2 and stand", () => {
    const e = handEVs({ player: [1, 10], up: 10, rules: R("4-8", false, true, true) });
    expect(e.stand).toBe(1.5);
    expect(e.best).toBe("stand");
    expect(e.double).toBeNull();
    expect(e.split).toBeNull();
    expect(e.surrender).toBeNull();
    // After a split, A + ten is just 21.
    const s = handEVs({ player: [10, 1], up: 10, rules: R("4-8"), afterSplit: true });
    expect(s.stand).toBeLessThan(1);
    expect(s.stand).toBeGreaterThan(0.8);
  });

  it("null fields follow the rules", () => {
    const base = handEVs({ player: [8, 8], up: 10, rules: R("4-8", false, true, true) });
    expect(base.split).not.toBeNull();
    expect(base.surrender).toBe(-0.5);
    expect(base.double).not.toBeNull();
    // 3 cards: no double, split or surrender.
    const three = handEVs({ player: [8, 4, 2], up: 10, rules: R("4-8", false, true, true) });
    expect([three.double, three.split, three.surrender]).toEqual([null, null, null]);
    // Doubling restrictions apply to hard totals; soft hands can't double under them.
    expect(handEVs({ player: [1, 7], up: 4, rules: R("4-8", false, true, false, "9-11") }).double).toBeNull();
    expect(handEVs({ player: [5, 3], up: 5, rules: R("4-8", false, true, false, "9-11") }).double).toBeNull();
    expect(handEVs({ player: [5, 4], up: 5, rules: R("4-8", false, true, false, "9-11") }).double).not.toBeNull();
    expect(handEVs({ player: [5, 4], up: 5, rules: R("4-8", false, true, false, "10-11") }).double).toBeNull();
    // After a split: double only with DAS, never surrender.
    expect(handEVs({ player: [8, 3], up: 5, rules: R("4-8", false, false, true), afterSplit: true }).double).toBeNull();
    const das = handEVs({ player: [8, 3], up: 5, rules: R("4-8", false, true, true), afterSplit: true });
    expect(das.double).not.toBeNull();
    expect(das.surrender).toBeNull();
    // Resplits: allowed while fewer than 4 hands, never aces.
    expect(handEVs({ player: [8, 8], up: 10, rules: R("4-8"), afterSplit: true, hands: 3 }).split).not.toBeNull();
    expect(handEVs({ player: [8, 8], up: 10, rules: R("4-8"), afterSplit: true, hands: 4 }).split).toBeNull();
    expect(handEVs({ player: [1, 1], up: 6, rules: R("4-8"), afterSplit: true }).split).toBeNull();
    expect(handEVs({ player: [10, 9], up: 6, rules: R("4-8") }).split).toBeNull();
  });

  it("best is the argmax of the non-null fields", () => {
    for (const [player, up] of [[[8, 8], 10], [[10, 6], 10], [[5, 6], 6], [[10, 9], 7], [[2, 2], 4]] as Array<[Rank[], Rank]>) {
      const e = handEVs({ player, up, rules: R("2", true, true, true) });
      const vals = [e.stand, e.hit, e.double, e.split, e.surrender].filter((x): x is number => x !== null);
      expect(e[e.best]).toBe(Math.max(...vals));
    }
  });

  it("resplitting is worth something: split EV with more hands allowed is at least as good", () => {
    const first = handEVs({ player: [8, 8], up: 6, rules: R("1") }).split as number;
    const last = handEVs({ player: [8, 8], up: 6, rules: R("1"), afterSplit: true, hands: 3 }).split as number;
    expect(first).toBeGreaterThanOrEqual(last);
  });
});

describe("performance", () => {
  it("any 2-card hand is well under 200 ms from a cold cache (1 and 6 decks)", () => {
    let worst = 0;
    let worstHand = "";
    for (const decks of ["1", "4-8"] as const) {
      for (const up of [2, 3, 1] as Rank[]) {
        for (let a = 1; a <= 10; a++) {
          for (let b = a; b <= 10; b++) {
            clearEngineCache();
            const t0 = performance.now();
            handEVs({ player: [a, b] as Rank[], up, rules: R(decks, true, true, true) });
            const ms = performance.now() - t0;
            if (ms > worst) { worst = ms; worstHand = `${decks} decks ${a},${b} vs ${up}`; }
          }
        }
      }
    }
    expect(worst, worstHand).toBeLessThan(200);
  });
});

describe("degenerate shoes", () => {
  it("never returns NaN and explains impossible situations", () => {
    // Ace up with only ten-value cards left unseen: the dealer must have blackjack.
    const allButTens: Rank[] = [];
    for (let r = 1; r <= 9; r++) for (let i = 0; i < 4; i++) allButTens.push(r as Rank);
    const seen = allButTens.slice();
    seen.splice(seen.indexOf(1), 1); // the upcard
    seen.splice(seen.indexOf(9), 1); // player's 9
    seen.splice(seen.indexOf(2), 1); // player's 2
    expect(() => handEVs({ player: [9, 2], up: 1, rules: R("1"), seen })).toThrow(/must have blackjack/);
    // A nearly empty shoe still gives finite numbers.
    const e = handEVs({ player: [10, 2], up: 6, rules: R("1"), seen: [...allButTens.filter((r) => r > 6), 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] });
    for (const v of [e.stand, e.hit, e.double]) expect(Number.isFinite(v)).toBe(true);
  });
});
