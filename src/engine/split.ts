// Expected value of splitting a pair.
//
// Notation: x = the pair card, S0 = the shoe at the split decision (upcard, known cards and both pair
// cards removed), nx = pair cards left in S0, n = cards left in S0.
//
// Hand configurations. Second cards are dealt one per open hand; drawing x while fewer than 4 hands
// are in play is a resplit, drawing x at the limit leaves a "stuck" x,x hand that is played as a
// total. `splitConfigs` gives the exact distribution of (p hands produced, q of them stuck) from
// sequential draws out of S0. In a configuration, m = p + q pair cards are in the hands, p - q hands
// hold a non-pair second card, and q hold a second x.
//
// Hand values. Every hand is valued with ALL m pair cards out of the shoe and with the other hands'
// second cards out too. Those other second cards are non-pair cards whose ranks are not known in
// advance; they are handled exactly (to first order in the player's information) by exchangeability:
// removing k unseen cards at random from a shoe does not change the expected result of a fixed way of
// playing, so for a hand with m pair cards out,
//     A(m, 0) = sum_j Hyp(j | k) * A(m + j, k - j)
// where A(m, k) is the hand's value with k other non-pair cards also out, and Hyp(j | k) is the
// hypergeometric probability that j of k random cards are pair cards. Solving for A(m, k) needs only
// the "pure" values A(m', 0) for m' = m .. m + k, i.e. the hand evaluated in shoes with more pair cards
// removed. The same holds for stuck hands (B). Pure values come from HandContexts with 0, 1, 2, ...
// extra pair cards out beyond the two being split ("levels"); levels beyond the ones computed are
// extrapolated linearly. Only rare 4-hand deals reach them: computing 6 levels instead of 3 changes
// split values by under 3e-6.
//
// Why this is right: the cards are a random permutation, and the probability of any complete deal
// depends only on which cards each hand and the dealer receive, not on the order in which the roles
// draw. So other hands' hit cards can be treated as drawn after the dealer's (they don't affect this
// hand), and a hand's second card and the dealer's cards see only the pair cards and second cards
// that are out. Approximations left: each hand's play uses the cards out at the split (pair cards and
// configuration) but not the exact ranks of the other hands' cards (an information effect of order
// 1e-5), and the extrapolated levels.
//
// Checks (split.test.ts, montecarlo.test.ts): with resplitting disabled the configuration sum equals
// 2 x (one hand with both pair cards out) identically; split EVs match Nairn's exact single-deck
// splitting tables to about 1e-5 (worst 3e-4) wherever Nairn plays split hands the same way (in the
// other cells Nairn's split hands are played less well and its values are lower; see the test); and
// a real-deal resplit Monte Carlo agrees. STRATEGY.md ("Split accuracy") has the numbers.
//
// Policy: "always resplit when allowed" vs "never resplit"; we keep the better (both are playable).
// Conditioning on no dealer blackjack: hand numerators (see hand.ts) are divided by P(no blackjack)
// at the split decision.
//
// Split aces: one card each, no resplit, so only level 0 is needed and the two hands are exact.

import type { Rules } from "../strategy/types";
import { canDouble } from "../strategy/resolve";
import { HandContext } from "./hand";
import { handShape, shoeTotal, withoutCards } from "./shoe";

export const MAX_HANDS = 4;

/** Pure-value levels computed exactly by default; deeper levels are extrapolated. */
export const DEFAULT_SPLIT_LEVELS = 3;

/** Numerators for every second card r (index r - 1) at one depletion level. NaN where impossible. */
export interface SplitLevel {
  stand: number[];
  hit: number[];
  double: number[];
}

/** Per-second-card values for split hands [x, r], independent of DAS / doubling restrictions. */
export interface SplitHandTable {
  x: number;
  /** Draw probability of each second card rank (index rank - 1) from S0. */
  p: number[];
  /**
   * levels[L]: numerators with L more pair cards out than at the split decision. For r != x that is
   * the hand [x, r] with m = L + 2 pair cards out; for r = x it is the stuck hand [x, x] with
   * m = L + 3 pair cards out.
   */
  levels: SplitLevel[];
  /** Hard total and softness of [x, r], for canDouble. */
  hard: number[];
  soft: boolean[];
  /** P(no dealer blackjack) at the split decision. */
  noBJ: number;
  /** Pair cards left and total cards left in S0. */
  nx: number;
  n: number;
}

export interface SplitTableOptions {
  /** Levels to compute exactly (default DEFAULT_SPLIT_LEVELS; 1 = the old "both pair cards out" model). */
  levels?: number;
  /** Context factory for the deeper levels (handEVs passes its cache); default: a new HandContext. */
  context?: (base: ArrayLike<number>) => HandContext;
}

function evalLevel(ctx: HandContext, x: number, avail: number[], withPair: boolean): SplitLevel {
  const lv: SplitLevel = { stand: [], hit: [], double: [] };
  for (let r = 1; r <= 10; r++) {
    if (avail[r - 1] === 0 || (r === x && !withPair)) {
      lv.stand.push(NaN); lv.hit.push(NaN); lv.double.push(NaN);
      continue;
    }
    const v = ctx.evaluate([x, r], x === 1 ? ["stand"] : ["stand", "hit", "double"]);
    lv.stand.push(v.stand);
    lv.hit.push(x === 1 ? NaN : v.hit);
    lv.double.push(x === 1 ? NaN : v.double);
  }
  return lv;
}

/**
 * Numerators for every possible second card of a split hand starting with `x`, at every level.
 * `ctx.base` must be the composition with the upcard, any other known cards and ONE pair card
 * removed (the hand itself holds the other pair card).
 */
export function splitHandTable(ctx: HandContext, x: number, opts: SplitTableOptions = {}): SplitHandTable {
  const post = Int32Array.from(ctx.base);
  if (post[x - 1] < 1) throw new Error("splitHandTable: base must still hold the pair card in the hand");
  post[x - 1]--; // S0: both pair cards out
  const n = shoeTotal(post);
  const t: SplitHandTable = { x, p: [], levels: [], hard: [], soft: [], noBJ: 0, nx: post[x - 1], n };
  t.noBJ = ctx.up === 1 ? 1 - post[9] / n : ctx.up === 10 ? 1 - post[0] / n : 1;
  for (let r = 1; r <= 10; r++) {
    t.p.push(post[r - 1] / n);
    const shape = handShape([x, r]);
    t.hard.push(shape.hard);
    t.soft.push(shape.soft);
  }
  const avail = Array.from(post);
  // Level 0 (always): errors here (an empty shoe, a forced dealer blackjack) are the caller's to see.
  t.levels.push(evalLevel(ctx, x, avail, true));
  // Split aces get one card each and can't be resplit: deeper levels are never used.
  const want = x === 1 ? 1 : Math.max(1, opts.levels ?? DEFAULT_SPLIT_LEVELS);
  const make = opts.context ?? ((b: ArrayLike<number>) => new HandContext(b, ctx.up, ctx.h17));
  for (let L = 1; L < want; L++) {
    // Level L needs L more pair cards out for [x, r]; the stuck hand [x, x] needs one more still.
    if (post[x - 1] < L) break;
    try {
      const lctx = make(withoutCards(ctx.base, new Array(L).fill(x), "the shoe"));
      t.levels.push(evalLevel(lctx, x, avail, post[x - 1] >= L + 1));
    } catch {
      break; // degenerate shoe: fall back to extrapolation
    }
  }
  return t;
}

export interface SplitConfig {
  /** Hands produced by this split (2 + resplits). */
  p: number;
  /** Hands stuck with a second pair card at the hand limit. */
  q: number;
  prob: number;
}

/**
 * Exact distribution of the hands a split produces, dealing second cards in order from a shoe with
 * `nx` pair cards among `n` cards, starting with `open` hands that need a second card and `total`
 * hands in play (resplit while total < maxHands).
 */
export function splitConfigs(nx: number, n: number, total: number, maxHands = MAX_HANDS, open = 2): SplitConfig[] {
  const acc = new Map<number, number>();
  const go = (o: number, tot: number, j: number, d: number, q: number, made: number, prob: number): void => {
    if (prob === 0) return;
    if (o === 0) {
      const key = made * 16 + q;
      acc.set(key, (acc.get(key) ?? 0) + prob);
      return;
    }
    const left = n - d;
    const px = left > 0 ? Math.max(0, nx - j) / left : 0;
    if (px > 0) {
      if (tot < maxHands) go(o + 1, tot + 1, j + 1, d + 1, q, made + 1, prob * px);
      else go(o - 1, tot, j + 1, d + 1, q + 1, made, prob * px);
    }
    if (px < 1) go(o - 1, tot, j, d + 1, q, made, prob * (1 - px));
  };
  go(open, total, 0, 0, 0, open, 1);
  return [...acc.entries()].map(([key, prob]) => ({ p: key >> 4, q: key & 15, prob }));
}

/**
 * E[#non-pair hands], E[#stuck pair hands] for the hands produced by splitting, starting with
 * `open` hands that still need a second card and `total` hands in play.
 */
export function expectedHandCounts(nx: number, n: number, open: number, total: number, maxHands = MAX_HANDS): [number, number] {
  let en = 0;
  let es = 0;
  for (const c of splitConfigs(nx, n, total, maxHands, open)) {
    en += c.prob * (c.p - c.q);
    es += c.prob * c.q;
  }
  return [en, es];
}

function choose(a: number, b: number): number {
  if (b < 0 || b > a) return 0;
  let r = 1;
  for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i;
  return r;
}

/** P(j of k cards drawn without replacement from T cards are among the X pair cards). */
function hyp(j: number, k: number, X: number, T: number): number {
  const den = choose(T, k);
  return den > 0 ? (choose(X, j) * choose(T - X, k - j)) / den : 0;
}

export interface SplitValues {
  /** Both hands take one second card each, no resplitting (exact). */
  noResplit: number;
  /** Always resplit while allowed; null when no resplit is possible. */
  resplit: number | null;
  /** max(noResplit, resplit): the value the engine reports. */
  best: number;
}

/** Pure values for one rule set: A0[L] = non-pair hand with L + 2 pair cards out, B0[L] = stuck hand with L + 3. */
function pureValues(t: SplitHandTable, rules: Rules): { A0: number[]; B0: number[]; px: number } {
  const x = t.x;
  const xi = x - 1;
  const px = t.p[xi];
  const A0: number[] = [];
  const B0: number[] = [];
  for (const lv of t.levels) {
    // Best playable value (per unit, conditional on no blackjack) of each level-L hand.
    const u: number[] = [];
    for (let k = 0; k < 10; k++) {
      let v = lv.stand[k];
      if (x !== 1) {
        v = Math.max(v, lv.hit[k]);
        if (canDouble(t.hard[k], t.soft[k], 2, rules, true)) v = Math.max(v, lv.double[k]);
      }
      u.push(v / t.noBJ);
    }
    let a = 0;
    for (let k = 0; k < 10; k++) if (k !== xi && t.p[k] > 0) a += t.p[k] * u[k];
    A0.push(px < 1 ? a / (1 - px) : 0);
    B0.push(u[xi]);
  }
  return { A0, B0, px };
}

/** vals[L], extrapolated linearly past the last finite entry. */
function level(vals: number[], L: number): number {
  let top = vals.length - 1;
  while (top >= 0 && !Number.isFinite(vals[top])) top--;
  if (top < 0) return 0;
  if (L <= top) return vals[L];
  if (top === 0 || !Number.isFinite(vals[top - 1])) return vals[top];
  return vals[top] + (L - top) * (vals[top] - vals[top - 1]);
}

/**
 * Value of all the hands a split produces when every pair card drawn is resplit while fewer than
 * `maxHands` hands are in play: the configuration sum described at the top of this file. With
 * handsAfter >= maxHands nothing is resplit, and this equals SplitValues.noResplit identically.
 */
export function configValue(t: SplitHandTable, rules: Rules, handsAfter: number, maxHands = MAX_HANDS): number {
  const { A0, B0 } = pureValues(t, rules);
  const { nx, n } = t;
  const memoA = new Map<number, number>();
  const memoB = new Map<number, number>();
  // A(m, k): non-pair hand, m pair cards out, k other non-pair cards out (population: S0 minus the
  // extra pair cards and this hand's own card).
  const A = (m: number, k: number): number => {
    if (k === 0) return level(A0, m - 2);
    const id = m * 16 + k;
    const hit = memoA.get(id);
    if (hit !== undefined) return hit;
    const X = nx + 2 - m;
    const T = n + 1 - m;
    let v = level(A0, m - 2);
    for (let j = 1; j <= k && j <= X; j++) v -= hyp(j, k, X, T) * A(m + j, k - j);
    const h0 = hyp(0, k, X, T);
    v = h0 > 0 ? v / h0 : 0;
    memoA.set(id, v);
    return v;
  };
  // B(m, k): stuck x,x hand, m pair cards out (two of them in this hand), k non-pair cards out.
  const B = (m: number, k: number): number => {
    if (k === 0) return level(B0, m - 3);
    const id = m * 16 + k;
    const hit = memoB.get(id);
    if (hit !== undefined) return hit;
    const X = nx + 2 - m;
    const T = n + 2 - m;
    let v = level(B0, m - 3);
    for (let j = 1; j <= k && j <= X; j++) v -= hyp(j, k, X, T) * B(m + j, k - j);
    const h0 = hyp(0, k, X, T);
    v = h0 > 0 ? v / h0 : 0;
    memoB.set(id, v);
    return v;
  };
  let total = 0;
  for (const { p, q, prob } of splitConfigs(nx, n, handsAfter, maxHands)) {
    if (prob === 0) continue;
    const m = p + q;
    if (p > q) total += prob * (p - q) * A(m, p - q - 1);
    if (q > 0) total += prob * q * B(m, p - q);
  }
  return total;
}

/**
 * Split EVs (combined net result of all resulting hands, per one original unit, conditional on no
 * dealer blackjack) for given rules. `handsAfter` = number of hands in play right after this split
 * (2 for a first split).
 */
export function splitValues(t: SplitHandTable, rules: Rules, handsAfter: number, maxHands = MAX_HANDS): SplitValues {
  const { A0, B0, px } = pureValues(t, rules);
  // Exact: each hand's value with both pair cards out (other hands' cards are unseen, see the header).
  const noResplit = 2 * ((1 - px) * level(A0, 0) + (px > 0 ? px * level(B0, 0) : 0));
  if (t.x === 1 || handsAfter >= maxHands || px === 0) return { noResplit, resplit: null, best: noResplit };
  const resplit = configValue(t, rules, handsAfter, maxHands);
  return { noResplit, resplit, best: Math.max(noResplit, resplit) };
}

/** splitValues(...).best. */
export function splitEVFromTable(t: SplitHandTable, rules: Rules, handsAfter: number): number {
  return splitValues(t, rules, handsAfter).best;
}
