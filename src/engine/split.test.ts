import { describe, expect, it } from "vitest";
import type { Rules } from "../strategy/types";
import { expectedHandCounts, handEVs } from "./index";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("resplit hand counts", () => {
  it("with no resplits allowed, each of the 2 hands is stuck with probability p(pair card)", () => {
    const [en, es] = expectedHandCounts(22, 310, 2, 2, 2);
    expect(es).toBeCloseTo((2 * 22) / 310, 12);
    expect(en + es).toBeCloseTo(2, 12);
  });

  it("matches a direct simulation of dealing second cards from a real shoe, resplitting up to 4 hands", () => {
    for (const [nx, n] of [[2, 48], [22, 310], [6, 98]]) {
      const [en, es] = expectedHandCounts(nx, n, 2, 2);
      const rand = rng(nx * 1000 + n);
      const trials = 400_000;
      let sn = 0, ss = 0;
      for (let t = 0; t < trials; t++) {
        let pairLeft = nx, left = n, open = 2, hands = 2;
        while (open > 0) {
          const isPair = rand() * left < pairLeft;
          left--;
          if (isPair) {
            pairLeft--;
            if (hands < 4) { hands++; open++; } else { ss++; open--; }
          } else { sn++; open--; }
        }
      }
      // Standard errors are below 0.002 here; allow 0.006.
      expect(Math.abs(sn / trials - en)).toBeLessThan(0.006);
      expect(Math.abs(ss / trials - es)).toBeLessThan(0.006);
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
});
