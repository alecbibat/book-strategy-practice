// Famous composition facts, API behaviour and performance.
import { describe, expect, it } from "vitest";
import type { Rank, Rules } from "../strategy/types";
import { clearEngineCache, freshShoe, handEVs, HandContext, splitHandTable, splitValues, withoutCards } from "./index";
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

  it("resplitting is worth something: 1 deck 8,8 v 6 gains about 0.045 from resplits", () => {
    const rules = R("1");
    const t = splitHandTable(new HandContext(withoutCards(freshShoe(1), [6, 8], "shoe"), 6, false), 8);
    const v = splitValues(t, rules, 2);
    expect(v.resplit! - v.noResplit).toBeGreaterThan(0.04);
    expect(v.resplit! - v.noResplit).toBeLessThan(0.05);
    expect(handEVs({ player: [8, 8], up: 6, rules }).split).toBe(v.resplit);
  });

  it("`hands` sets how many hands a resplit may still open, with the other hands' split cards out", () => {
    // 2 decks so that pair cards are left for every resplit. handsAfter = hands + 1.
    const rules = R("2");
    const tableWith = (siblings: number) =>
      splitHandTable(new HandContext(withoutCards(freshShoe(2), [6, ...new Array<Rank>(siblings + 1).fill(8)], "shoe"), 6, false), 8);
    const first = handEVs({ player: [8, 8], up: 6, rules }).split!;
    expect(first).toBe(splitValues(tableWith(0), rules, 2).best);
    const at2 = handEVs({ player: [8, 8], up: 6, rules, afterSplit: true, hands: 2 }).split!;
    expect(at2).toBe(splitValues(tableWith(1), rules, 3).best);
    // At 3 hands the resplit makes the 4th hand and nothing more can be resplit.
    const at3 = handEVs({ player: [8, 8], up: 6, rules, afterSplit: true, hands: 3 }).split!;
    const t3 = tableWith(2);
    expect(at3).toBe(splitValues(t3, rules, 4).noResplit);
    expect(splitValues(t3, rules, 3).best - at3).toBeGreaterThan(0.03); // what an off-by-one would give
    expect(handEVs({ player: [8, 8], up: 6, rules, afterSplit: true, hands: 4 }).split).toBeNull();
  });

  it("after a split, the other hands' split cards are out of the shoe", () => {
    const rules = R("1");
    // Splitting 2s: this hand is 2,9 and the other hand holds a 2.
    const split = handEVs({ player: [2, 9], up: 5, rules, afterSplit: true, hands: 2 });
    const asSeen = handEVs({ player: [2, 9], up: 5, rules, seen: [2] });
    expect([split.stand, split.hit, split.double]).toEqual([asSeen.stand, asSeen.hit, asSeen.double]);
    expect(split.surrender).toBeNull();
    // 3 hands of 8s: two other 8s are out, so this hand's 8,8 uses the last two 8s of a single deck.
    expect(() => handEVs({ player: [8, 8], up: 6, rules, afterSplit: true, hands: 3, seen: [8] })).toThrow(/counting the split card in each of the other 2 hands/);
    expect(() => handEVs({ player: [8, 8], up: 6, rules, afterSplit: true, hands: 4 })).toThrow(/5 8s requested/);
  });

  it("split aces stand: one card each, no double, no resplit, no surrender", () => {
    for (const second of [1, 2, 5, 6, 9] as Rank[]) {
      const e = handEVs({ player: [1, second], up: 6, rules: R("4-8", false, true, true), afterSplit: true, hands: 2 });
      expect(e.best, `A,${second}`).toBe("stand");
      expect([e.double, e.split, e.surrender]).toEqual([null, null, null]);
      expect(Number.isFinite(e.hit)).toBe(true); // informational only
    }
    expect(() => handEVs({ player: [1, 5, 2], up: 6, rules: R("4-8"), afterSplit: true })).toThrow(/split aces/);
    // An ace drawn to a split 8 is an ordinary hand: player[0] is the split card.
    expect(handEVs({ player: [8, 1], up: 6, rules: R("4-8"), afterSplit: true }).best).not.toBe("hit");
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
    // Ten or ace up, and the player's draw can take the last unseen card (no hole card left for it).
    const deck: Rank[] = [];
    for (let r = 1; r <= 10; r++) for (let i = 0; i < (r === 10 ? 16 : 4); i++) deck.push(r as Rank);
    const allBut = (keep: Rank[]) => {
      const out = deck.slice();
      for (const c of keep) out.splice(out.indexOf(c), 1);
      return out;
    };
    const cases: Array<{ up: Rank; unseen: Rank[] }> = [
      { up: 10, unseen: [10] }, // one unseen card
      { up: 10, unseen: [9, 2] },
      { up: 1, unseen: [9, 2] }
    ];
    for (const { up, unseen } of cases) {
      const r = handEVs({ player: [10, 6], up, rules: R("1", false, true, true), seen: allBut([up, 10, 6, ...unseen]) });
      for (const v of [r.stand, r.hit, r.double]) expect(Number.isFinite(v), `${up} up, unseen ${unseen}`).toBe(true);
    }
  });
});
