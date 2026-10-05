import { describe, expect, it } from "vitest";
import type { Rank } from "../strategy/types";
import { dealerDistribution, freshShoe, withoutCards } from "./index";

const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ---- Independent reference 1: infinite deck (with replacement), written from scratch. ----
// Peek conditioning: the hole card is drawn from the non-blackjack cards only, renormalised.
function infiniteDealer(up: Rank, h17: boolean): number[] {
  const p = (r: number) => (r === 10 ? 4 / 13 : 1 / 13);
  const out = [0, 0, 0, 0, 0, 0];
  const play = (hard: number, ace: boolean, prob: number): void => {
    const soft = ace && hard + 10 <= 21;
    const total = soft ? hard + 10 : hard;
    if (hard > 21) out[5] += prob;
    else if (total > 17 || (total === 17 && !(soft && h17))) out[total - 17] += prob;
    else for (let r = 1; r <= 10; r++) play(hard + r, ace || r === 1, prob * p(r));
  };
  for (let hole = 1; hole <= 10; hole++) {
    if ((up === 1 && hole === 10) || (up === 10 && hole === 1)) continue;
    play(up + hole, up === 1 || hole === 1, p(hole));
  }
  const s = out.reduce((a, b) => a + b, 0);
  return out.map((x) => x / s);
}

// ---- Independent reference 2: brute force over every ordered draw sequence, without replacement. ----
function bruteDealer(up: Rank, counts: number[], h17: boolean): number[] {
  const c = counts.slice();
  const out = [0, 0, 0, 0, 0, 0];
  const play = (hard: number, ace: boolean, prob: number, first: boolean): void => {
    const soft = ace && hard + 10 <= 21;
    const total = soft ? hard + 10 : hard;
    if (!first) {
      if (hard > 21) { out[5] += prob; return; }
      if (total > 17 || (total === 17 && !(soft && h17))) { out[total - 17] += prob; return; }
    }
    const n = c.reduce((a, b) => a + b, 0);
    for (let r = 1; r <= 10; r++) {
      if (c[r - 1] === 0) continue;
      if (first && ((up === 1 && r === 10) || (up === 10 && r === 1))) continue; // dealer blackjack
      const q = prob * c[r - 1] / n;
      c[r - 1]--;
      play(hard + r, ace || r === 1, q, false);
      c[r - 1]++;
    }
  };
  play(up, up === 1, 1, true);
  const s = out.reduce((a, b) => a + b, 0);
  return out.map((x) => x / s);
}

describe("dealer distribution", () => {
  it("sums to 1 for every upcard, deck count and soft-17 rule", () => {
    for (const decks of [1, 2, 6, 8]) {
      for (const h17 of [false, true]) {
        for (const up of RANKS) {
          const d = dealerDistribution(up, withoutCards(freshShoe(decks), [up], "shoe"), h17);
          expect(d).toHaveLength(6);
          expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
          d.forEach((x) => expect(x).toBeGreaterThanOrEqual(0));
        }
      }
    }
  });

  it("matches an independent infinite-deck calculation with a 2000-deck shoe (to 1e-3)", () => {
    let worst = 0;
    for (const h17 of [false, true]) {
      for (const up of RANKS) {
        const big = dealerDistribution(up, withoutCards(freshShoe(2000), [up], "shoe"), h17);
        const inf = infiniteDealer(up, h17);
        for (let o = 0; o < 6; o++) worst = Math.max(worst, Math.abs(big[o] - inf[o]));
      }
    }
    expect(worst).toBeLessThan(1e-3);
    // In fact the residual finite-shoe effect is tiny.
    expect(worst).toBeLessThan(1e-4);
  });

  it("matches brute-force enumeration of ordered draws without replacement on small shoes", () => {
    const shoes = [
      [2, 2, 2, 2, 2, 2, 2, 2, 2, 8],
      [1, 3, 0, 2, 4, 1, 2, 0, 3, 6],
      [4, 4, 4, 4, 4, 4, 4, 4, 4, 15] // one deck minus a ten
    ];
    for (const s of shoes.slice(0, 2)) {
      for (const h17 of [false, true]) {
        for (const up of RANKS) {
          const got = dealerDistribution(up, s, h17);
          const want = bruteDealer(up, s, h17);
          for (let o = 0; o < 6; o++) expect(got[o]).toBeCloseTo(want[o], 12);
        }
      }
    }
    // A full single deck is still feasible for the brute force with high upcards.
    for (const up of [7, 8, 9, 10] as Rank[]) {
      const s = shoes[2].slice();
      if (up !== 10) { s[9]++; s[up - 1]--; }
      const got = dealerDistribution(up, s, true);
      const want = bruteDealer(up, s, true);
      for (let o = 0; o < 6; o++) expect(got[o]).toBeCloseTo(want[o], 12);
    }
  });

  it("H17 only changes results when the dealer can reach soft 17", () => {
    const shoe = withoutCards(freshShoe(6), [10], "shoe");
    // With a ten up the dealer can never hold a soft total (T + A is blackjack, excluded; any other
    // hand with a ten and an ace counts the ace as 1), so H17 cannot matter.
    expect(dealerDistribution(10, shoe, true)).toEqual(dealerDistribution(10, shoe, false));
    const s6 = withoutCards(freshShoe(6), [6], "shoe");
    const a = dealerDistribution(6, s6, false), b = dealerDistribution(6, s6, true);
    expect(b[0]).toBeLessThan(a[0]); // fewer 17s
    expect(b[5]).toBeGreaterThan(a[5]); // more busts with a 6 up
  });
});
