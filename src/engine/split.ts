// Expected value of splitting a pair.
//
// Model (each approximation is standard for "exact" basic-strategy engines):
//  * Every split hand starts from one pair card with BOTH pair cards removed from the shoe. The hands
//    are evaluated independently: one hand's draws are not removed from the shoe seen by the other
//    hands or by the dealer ("independent hands" approximation).
//  * For the second card r of a split hand:
//      - r is the pair card and resplitting is allowed (not aces, fewer than 4 hands) -> resplit;
//      - otherwise the hand is played optimally from [x, r]: stand / hit (composition-dependent,
//        exact, see hand.ts) / double when the rules allow doubling after a split
//        (canDouble(..., afterSplit = true): DAS plus the same hard-total restriction).
//    Split aces get exactly one card each and stand (A + ten is 21, not blackjack); no resplit.
//  * Resplits: v_nonpair = average value of [x, r] over r != x (weighted by draw probability),
//    v_stuck = value of [x, x] played as a total. Split EV = v_nonpair * E[#non-pair hands] +
//    v_stuck * E[#hands that drew a pair card once no more splits are allowed]. The expectations
//    come from a small recursion over (open hands, total hands, pair cards drawn, cards drawn), with
//    the pair-card probability updated as pair cards and other second cards leave the shoe. The hand
//    values themselves always use the "both pair cards removed" composition (extra pair cards drawn
//    for resplits are not removed from it).
//  * The resplit policy is "always resplit when allowed". We also compute "never resplit" and keep
//    the better of the two (both are playable strategies, so the max is still a valid lower bound on
//    the optimum and it avoids forcing a bad resplit on marginal pairs).
//  * Conditioning on no dealer blackjack: hand numerators are divided by P(no blackjack) at the moment
//    of the split decision (see hand.ts for why numerators combine linearly).

import type { Rules } from "../strategy/types";
import { canDouble } from "../strategy/resolve";
import { HandContext } from "./hand";
import { handShape, shoeTotal } from "./shoe";

export const MAX_HANDS = 4;

/** Per-second-card values for a split hand [x, r], independent of DAS / doubling restrictions. */
export interface SplitHandTable {
  x: number;
  /** Draw probability of each second card rank (index rank - 1) from the post-split composition. */
  p: number[];
  stand: number[];
  hit: number[];
  double: number[];
  /** Hard total and softness of [x, r], for canDouble. */
  hard: number[];
  soft: boolean[];
  /** P(no dealer blackjack) at the split decision. */
  noBJ: number;
  /** Pair cards left and total cards left after both pair cards are removed. */
  nx: number;
  n: number;
}

/**
 * Numerators for every possible second card of a split hand starting with `x`.
 * `ctx.base` must be the composition with the upcard, any other known cards and ONE pair card
 * removed (the hand itself holds the other pair card).
 */
export function splitHandTable(ctx: HandContext, x: number): SplitHandTable {
  const post = Int32Array.from(ctx.base);
  if (post[x - 1] < 1) throw new Error("splitHandTable: base must still hold the pair card in the hand");
  post[x - 1]--; // composition at the split decision: both pair cards out
  const n = shoeTotal(post);
  const t: SplitHandTable = {
    x, p: [], stand: [], hit: [], double: [], hard: [], soft: [], noBJ: 0, nx: post[x - 1], n
  };
  t.noBJ = ctx.up === 1 ? 1 - post[9] / n : ctx.up === 10 ? 1 - post[0] / n : 1;
  for (let r = 1; r <= 10; r++) {
    const cnt = post[r - 1];
    t.p.push(cnt / n);
    const shape = handShape([x, r]);
    t.hard.push(shape.hard);
    t.soft.push(shape.soft);
    if (cnt === 0) {
      t.stand.push(0); t.hit.push(0); t.double.push(0);
      continue;
    }
    const v = ctx.evaluate([x, r], x === 1 ? ["stand"] : ["stand", "hit", "double"]);
    t.stand.push(v.stand);
    t.hit.push(x === 1 ? NaN : v.hit);
    t.double.push(x === 1 ? NaN : v.double);
  }
  return t;
}

/**
 * E[#non-pair hands], E[#stuck pair hands] for the hands produced by splitting, starting with
 * `open` hands that still need a second card and `total` hands in play.
 */
export function expectedHandCounts(nx: number, n: number, open: number, total: number, maxHands = MAX_HANDS): [number, number] {
  const memo = new Map<string, [number, number]>();
  const go = (o: number, tot: number, j: number, d: number): [number, number] => {
    if (o === 0) return [0, 0];
    const id = o + "," + tot + "," + j + "," + d;
    const m = memo.get(id);
    if (m) return m;
    const left = n - d;
    const px = left > 0 ? Math.max(0, nx - j) / left : 0;
    let en = 0;
    let es = 0;
    if (px > 0) {
      if (tot < maxHands) {
        const [a, b] = go(o + 1, tot + 1, j + 1, d + 1);
        en += px * a; es += px * b;
      } else {
        const [a, b] = go(o - 1, tot, j + 1, d + 1);
        en += px * a; es += px * (b + 1);
      }
    }
    if (px < 1) {
      const [a, b] = go(o - 1, tot, j, d + 1);
      en += (1 - px) * (a + 1); es += (1 - px) * b;
    }
    const res: [number, number] = [en, es];
    memo.set(id, res);
    return res;
  };
  return go(open, total, 0, 0);
}

/**
 * Split EV (combined net result of all resulting hands, per one original unit, conditional on no
 * dealer blackjack) for given rules. `handsAfter` = number of hands in play right after this split
 * (2 for a first split).
 */
export function splitEVFromTable(t: SplitHandTable, rules: Rules, handsAfter: number): number {
  const u: number[] = [];
  for (let k = 0; k < 10; k++) {
    if (t.p[k] === 0) { u.push(0); continue; }
    let v = t.stand[k];
    if (t.x !== 1) {
      v = Math.max(v, t.hit[k]);
      if (canDouble(t.hard[k], t.soft[k], 2, rules, true)) v = Math.max(v, t.double[k]);
    }
    u.push(v / t.noBJ);
  }
  let all = 0;
  for (let k = 0; k < 10; k++) all += t.p[k] * u[k];
  const noResplit = 2 * all;
  if (t.x === 1 || handsAfter >= MAX_HANDS) return noResplit;
  const px = t.p[t.x - 1];
  if (px === 0) return noResplit;
  const vStuck = u[t.x - 1];
  const vNonPair = px < 1 ? (all - px * vStuck) / (1 - px) : 0;
  const [en, es] = expectedHandCounts(t.nx, t.n, 2, handsAfter);
  const resplit = vNonPair * en + vStuck * es;
  return Math.max(noResplit, resplit);
}
