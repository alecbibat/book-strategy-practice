// Exact cross-check of stand / hit / double on small shoes against a naive evaluator written
// independently of the engine. The naive evaluator deals the dealer's hole card EXPLICITLY first
// (conditioned on no blackjack), lets the player draw from what is left, and makes every hit/stand
// decision from the posterior over the unknown hole card. The engine instead draws the hole card
// last and works with "payoff x no-blackjack" numerators; the two must agree to rounding error.
import { describe, expect, it } from "vitest";
import type { Rank } from "../strategy/types";
import { HandContext, withoutCards } from "./index";

type Comp = number[]; // index rank - 1

function dealerFinals(up: number, hole: number, rest: Comp, h17: boolean): number[] {
  // P(final = 17..21, bust) playing out from up + hole, brute force over ordered draws.
  const out = [0, 0, 0, 0, 0, 0];
  const c = rest.slice();
  const play = (hard: number, ace: boolean, prob: number): void => {
    const soft = ace && hard + 10 <= 21;
    const total = soft ? hard + 10 : hard;
    if (hard > 21) { out[5] += prob; return; }
    if (total > 17 || (total === 17 && !(soft && h17))) { out[total - 17] += prob; return; }
    const n = c.reduce((a, b) => a + b, 0);
    for (let r = 1; r <= 10; r++) {
      if (!c[r - 1]) continue;
      const q = prob * c[r - 1] / n;
      c[r - 1]--;
      play(hard + r, ace || r === 1, q);
      c[r - 1]++;
    }
  };
  play(up + hole, up === 1 || hole === 1, 1);
  return out;
}

function settle(player: number, d: number[]): number {
  if (player > 21) return -1;
  let ev = d[5];
  for (let o = 0; o < 5; o++) ev += player > 17 + o ? d[o] : player < 17 + o ? -d[o] : 0;
  return ev;
}

function naive(unseenRoot: Comp, up: number, h17: boolean, hand: number[]) {
  const isBJ = (h: number) => (up === 1 && h === 10) || (up === 10 && h === 1);
  const tot = (cards: number[]) => {
    const hard = cards.reduce((a, b) => a + b, 0);
    return cards.includes(1) && hard + 10 <= 21 ? hard + 10 : hard;
  };
  const key = (cards: number[]) => cards.slice().sort((a, b) => a - b).join(",");
  const unseenOf = (cards: number[]) => {
    const u = unseenRoot.slice();
    for (const r of cards.slice(hand.length)) u[r - 1]--;
    return u;
  };
  const posterior = (u: Comp) => {
    const w: Array<[number, number]> = [];
    let s = 0;
    for (let h = 1; h <= 10; h++) if (u[h - 1] && !isBJ(h)) { w.push([h, u[h - 1]]); s += u[h - 1]; }
    return w.map(([h, x]) => [h, x / s] as [number, number]);
  };
  const standMemo = new Map<string, number>();
  const qStand = (cards: number[], h: number): number => {
    const k = key(cards) + "|" + h;
    let v = standMemo.get(k);
    if (v === undefined) {
      const rest = unseenOf(cards);
      rest[h - 1]--;
      v = settle(tot(cards), dealerFinals(up, h, rest, h17));
      standMemo.set(k, v);
    }
    return v;
  };
  const policyMemo = new Map<string, "stand" | "hit">();
  const qStarMemo = new Map<string, number>();
  const qHit = (cards: number[], h: number): number => {
    const rest = unseenOf(cards);
    rest[h - 1]--;
    const n = rest.reduce((a, b) => a + b, 0);
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (!rest[r - 1]) continue;
      const next = [...cards, r];
      const hard = next.reduce((a, b) => a + b, 0);
      ev += (rest[r - 1] / n) * (hard > 21 ? -1 : qStar(next, h));
    }
    return ev;
  };
  const policy = (cards: number[]): "stand" | "hit" => {
    const k = key(cards);
    let p = policyMemo.get(k);
    if (!p) {
      let s = 0, hi = 0;
      for (const [h, w] of posterior(unseenOf(cards))) { s += w * qStand(cards, h); hi += w * qHit(cards, h); }
      p = hi > s ? "hit" : "stand"; // no "stand on 21" shortcut here
      policyMemo.set(k, p);
    }
    return p;
  };
  const qStar = (cards: number[], h: number): number => {
    const k = key(cards) + "|" + h;
    let v = qStarMemo.get(k);
    if (v === undefined) {
      v = policy(cards) === "stand" ? qStand(cards, h) : qHit(cards, h);
      qStarMemo.set(k, v);
    }
    return v;
  };
  const qDouble = (cards: number[], h: number): number => {
    const rest = unseenOf(cards);
    rest[h - 1]--;
    const n = rest.reduce((a, b) => a + b, 0);
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (!rest[r - 1]) continue;
      const next = [...cards, r];
      ev += (rest[r - 1] / n) * 2 * (next.reduce((a, b) => a + b, 0) > 21 ? -1 : qStand(next, h));
    }
    return ev;
  };
  let stand = 0, hit = 0, dbl = 0;
  for (const [h, w] of posterior(unseenRoot)) {
    stand += w * qStand(hand, h);
    hit += w * qHit(hand, h);
    dbl += w * qDouble(hand, h);
  }
  return { stand, hit, double: dbl };
}

describe("exact cross-check with an explicit hole card (small shoes)", () => {
  const shoes: Comp[] = [
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 8],
    [3, 2, 3, 2, 3, 2, 1, 2, 2, 9]
  ];
  const cases: Array<[Rank[], Rank]> = [
    [[10, 6], 10], [[9, 7], 10], [[5, 6], 1], [[10, 6], 1], [[2, 3], 1], [[1, 7], 10],
    [[2, 3], 6], [[1, 2], 4], [[10, 2], 2], [[8, 8], 9], [[4, 1], 1], [[3, 9], 7]
  ];
  for (const [si, shoe] of shoes.entries()) {
    for (const h17 of [false, true]) {
      it(`shoe ${si} ${h17 ? "H17" : "S17"}: stand, hit and double match exactly`, () => {
        let checked = 0;
        for (const [hand, up] of cases) {
          const base = withoutCards(shoe, [up], "shoe");
          let unseen: Comp;
          try { unseen = Array.from(withoutCards(base, hand, "shoe")); } catch { continue; }
          const ctx = new HandContext(base, up, h17);
          const nums = ctx.evaluate(hand);
          const want = naive(unseen, up, h17, hand);
          expect(nums.stand / nums.noBJ).toBeCloseTo(want.stand, 11);
          expect(nums.hit / nums.noBJ).toBeCloseTo(want.hit, 11);
          expect(nums.double / nums.noBJ).toBeCloseTo(want.double, 11);
          checked++;
        }
        expect(checked).toBeGreaterThanOrEqual(10);
      });
    }
  }
});
