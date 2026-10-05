// Dealer outcome probabilities, drawing WITHOUT replacement from an exact shoe composition.
//
// The dealer's play depends only on the multiset of cards drawn so far (the order only matters for
// when the dealer stops, which the graph below handles). For each (upcard, H17/S17) we build, once,
// the graph of "dealer still drawing" multisets; every edge is one more card. Given a composition,
// a single forward pass over that graph (in order of cards drawn) accumulates the probability of
// reaching each state and of each final result. That is exact drawing without replacement and costs
// about (#states x 10) multiply-adds (a few hundred states for a 2 upcard).
//
// Peek / no-blackjack conditioning: the first card the dealer draws is the hole card. With an ace up
// a ten-value hole card is blackjack; with a ten up an ace hole card is. Those edges are dropped, so
// the masses returned by `dealerMass` are P(result AND no dealer blackjack), which sum to
// P(no dealer blackjack | composition). `dealerDistribution` divides by that sum.

import type { Rank } from "../strategy/types";
import { POW, shoeTotal, assertRank } from "./shoe";

/** Indices of the dealer results in a mass/distribution array. */
export const D17 = 0, D18 = 1, D19 = 2, D20 = 3, D21 = 4, DBUST = 5;
export const N_RESULTS = 6;

const EDGE_BJ = -100;

export interface DealerGraph {
  up: number;
  h17: boolean;
  /** Number of non-terminal states; state 0 is "upcard only" (hole card not yet drawn). */
  n: number;
  /** drawn[i * 10 + k]: cards of rank k + 1 the dealer has drawn in state i. */
  drawn: Int32Array;
  /** size[i]: number of cards drawn in state i. States are sorted by size (topological order). */
  size: Int32Array;
  /** edge[i * 10 + k]: next state index (>= 0), or -(1 + result) when that card ends the hand, or EDGE_BJ. */
  edge: Int32Array;
}

const graphs = new Map<string, DealerGraph>();

/** Build (or fetch) the dealer state graph for an upcard rank (1 = ace) and the soft-17 rule. */
export function dealerGraph(up: number, h17: boolean): DealerGraph {
  const id = up + (h17 ? "H" : "S");
  const hit = graphs.get(id);
  if (hit) return hit;

  const index = new Map<number, number>();
  const keys: number[] = [0];
  const hards: number[] = [up];
  const aces: boolean[] = [up === 1];
  const drawn: number[] = new Array(10).fill(0);
  const size: number[] = [0];
  const edge: number[] = [];
  index.set(0, 0);

  for (let i = 0; i < keys.length; i++) {
    for (let k = 0; k < 10; k++) {
      const r = k + 1;
      const s = size[i] + 1;
      if (s === 1 && ((up === 1 && r === 10) || (up === 10 && r === 1))) {
        edge.push(EDGE_BJ);
        continue;
      }
      const hard = hards[i] + r;
      const ace = aces[i] || r === 1;
      if (hard > 21) {
        edge.push(-1 - DBUST);
        continue;
      }
      const soft = ace && hard + 10 <= 21;
      const total = soft ? hard + 10 : hard;
      if (total >= 18 || (total === 17 && !(soft && h17))) {
        edge.push(-1 - (total - 17));
        continue;
      }
      const key = keys[i] + POW[k];
      let j = index.get(key);
      if (j === undefined) {
        j = keys.length;
        index.set(key, j);
        keys.push(key);
        hards.push(hard);
        aces.push(ace);
        size.push(s);
        for (let q = 0; q < 10; q++) drawn.push(drawn[i * 10 + q] + (q === k ? 1 : 0));
      }
      edge.push(j);
    }
  }

  const g: DealerGraph = {
    up,
    h17,
    n: keys.length,
    drawn: Int32Array.from(drawn),
    size: Int32Array.from(size),
    edge: Int32Array.from(edge)
  };
  graphs.set(id, g);
  return g;
}

let scratch = new Float64Array(1024);

/**
 * P(dealer result AND no dealer blackjack) for each result, given the exact composition of the
 * unseen cards (`counts`, index rank - 1, which includes the dealer's hole card) and their total.
 * Writes into `out` (length >= 6) and returns the sum (= P(no dealer blackjack)).
 */
export function dealerMass(g: DealerGraph, counts: ArrayLike<number>, total: number, out: Float64Array): number {
  if (scratch.length < g.n) scratch = new Float64Array(g.n * 2);
  const prob = scratch;
  prob.fill(0, 0, g.n);
  for (let o = 0; o < N_RESULTS; o++) out[o] = 0;
  prob[0] = 1;
  const { drawn, size, edge } = g;
  for (let i = 0; i < g.n; i++) {
    const p = prob[i];
    if (p === 0) continue;
    const scale = p / (total - size[i]);
    const b = i * 10;
    for (let k = 0; k < 10; k++) {
      const cnt = counts[k] - drawn[b + k];
      if (cnt <= 0) continue;
      const e = edge[b + k];
      const q = scale * cnt;
      if (e >= 0) prob[e] += q;
      else if (e !== EDGE_BJ) out[-1 - e] += q;
    }
  }
  let sum = 0;
  for (let o = 0; o < N_RESULTS; o++) sum += out[o];
  return sum;
}

/** P(the dealer has blackjack | upcard, composition of unseen cards). */
export function dealerBlackjackProb(up: number, counts: ArrayLike<number>): number {
  const n = shoeTotal(counts);
  if (up === 1) return counts[9] / n;
  if (up === 10) return counts[0] / n;
  return 0;
}

/**
 * The dealer's final-result distribution [17, 18, 19, 20, 21, bust], conditioned on the dealer not
 * having blackjack (US peek), drawing without replacement from `counts` (index rank - 1; the upcard
 * must already be removed). Sums to 1.
 */
export function dealerDistribution(up: Rank, counts: ArrayLike<number>, h17: boolean): number[] {
  assertRank(up, "dealerDistribution upcard");
  const out = new Float64Array(N_RESULTS);
  const sum = dealerMass(dealerGraph(up, h17), counts, shoeTotal(counts), out);
  if (!(sum > 0)) throw new Error("dealerDistribution: the shoe cannot complete a dealer hand");
  return Array.from(out, (m) => m / sum);
}

/**
 * Net result for the player standing on `playerTotal` (> 21 means bust) against dealer masses `m`
 * (unnormalised: the result is scaled the same way, i.e. it is E[payoff AND no dealer blackjack]).
 * `noBJ` is the sum of the masses.
 */
export function standValue(playerTotal: number, m: ArrayLike<number>, noBJ: number): number {
  if (playerTotal > 21) return -noBJ;
  if (playerTotal < 17) return m[DBUST] - (noBJ - m[DBUST]);
  const idx = playerTotal - 17;
  let win = m[DBUST];
  let lose = 0;
  for (let o = 0; o < 5; o++) {
    if (o < idx) win += m[o];
    else if (o > idx) lose += m[o];
  }
  return win - lose;
}
