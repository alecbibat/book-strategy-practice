// Composition-dependent hit / stand / double values for one player hand.
//
// Units and conditioning. Every value inside a HandContext is a NUMERATOR:
//     E[ net payoff * 1{dealer has no blackjack} | cards seen so far ]
// in units of the hand's initial bet. The player only acts after the dealer has peeked, so the
// quantity we want is E[payoff | seen, no dealer blackjack] = numerator / P(no blackjack | seen).
// At any decision point every alternative shares the same denominator, so comparing numerators picks
// the same action as comparing conditional EVs, and numerators of later decision points combine
// linearly. Callers divide by `noBJ` once, at the decision they report.
//
// This handles the peek EXACTLY, including its effect on the player's own draws: the dealer's hole
// card is one of the unseen cards, so (by exchangeability) the player's next card is drawn from the
// full unseen composition, and the hole card is drawn later by the dealer graph from what is left,
// with the blackjack hole card excluded. No "player draws ignore the hole card" approximation needed.
//
// Hitting is solved exactly by recursion over the multiset of cards in the hand, removing each card
// from the shoe as it is drawn (memoised on that multiset), choosing max(stand, hit) at every point.
// The dealer is played out exactly, without replacement, from the composition at the moment the
// player stands (see dealer.ts).
//
// Degenerate shoes: if the player has drawn every remaining card the hand must stand; if the dealer
// runs out of cards mid-hand those paths are dropped (their probability is lost). Real games
// reshuffle long before either can happen.
//
// Approximation: once a hand totals 21 it stands (hitting 21 is never better in practice; with exact
// composition effects it could in principle differ by a negligible amount). The explicit `hit` value
// asked for at the root is still computed.

import { dealerGraph, dealerMass, N_RESULTS, standValue, type DealerGraph } from "./dealer";
import { POW, shoeTotal, withoutCards, keyOf, handShape } from "./shoe";

export interface HandNumerators {
  /** E[payoff * 1{no dealer BJ}] for standing now. */
  stand: number;
  /** ... for hitting now and then playing optimally (stand/hit only). */
  hit: number;
  /** ... for doubling now (one card, then stand; payoff counted on the doubled stake). */
  double: number;
  /** P(no dealer blackjack | composition after these cards). */
  noBJ: number;
}

export class HandContext {
  readonly up: number;
  readonly h17: boolean;
  /** Composition the hand's cards are drawn from (upcard and any other known cards already removed). */
  readonly base: Int32Array;
  private readonly g: DealerGraph;
  /** Working composition: base minus the hand currently being evaluated. */
  private readonly c: Int32Array;
  private n: number;
  private readonly memoV = new Map<number, number>();
  private readonly memoS = new Map<number, number>();
  private readonly mass = new Float64Array(N_RESULTS);

  constructor(base: ArrayLike<number>, up: number, h17: boolean) {
    this.up = up;
    this.h17 = h17;
    this.base = Int32Array.from(base as ArrayLike<number>);
    this.c = Int32Array.from(this.base);
    this.n = shoeTotal(this.c);
    this.g = dealerGraph(up, h17);
  }

  /** Number of memoised hand states (for diagnostics). */
  get size(): number {
    return this.memoV.size;
  }

  /** P(no dealer blackjack | current working composition). */
  private noBJ(): number {
    if (this.up === 1) return 1 - this.c[9] / this.n;
    if (this.up === 10) return 1 - this.c[0] / this.n;
    return 1;
  }

  /** Stand numerator for the hand `key` with the given final total (working composition = base - hand). */
  private stand(key: number, total: number): number {
    const hit = this.memoS.get(key);
    if (hit !== undefined) return hit;
    const m = this.mass;
    const sum = dealerMass(this.g, this.c, this.n, m);
    const v = standValue(total, m, sum);
    this.memoS.set(key, v);
    return v;
  }

  /** Optimal (stand or hit) numerator for a non-bust hand. */
  private value(key: number, hard: number, hasAce: boolean): number {
    const memo = this.memoV.get(key);
    if (memo !== undefined) return memo;
    const total = hasAce && hard + 10 <= 21 ? hard + 10 : hard;
    const s = this.stand(key, total);
    // No hitting at 21 (see header) or when the shoe is empty.
    const v = total >= 21 || this.n === 0 ? s : Math.max(s, this.hitValue(key, hard, hasAce));
    this.memoV.set(key, v);
    return v;
  }

  /** Numerator for taking one card and then playing optimally. */
  private hitValue(key: number, hard: number, hasAce: boolean): number {
    const c = this.c;
    const n = this.n;
    let acc = 0;
    for (let k = 0; k < 10; k++) {
      const cnt = c[k];
      if (cnt === 0) continue;
      const r = k + 1;
      const h2 = hard + r;
      c[k]--;
      this.n--;
      const v = h2 > 21 ? -this.noBJ() : this.value(key + POW[k], h2, hasAce || r === 1);
      c[k]++;
      this.n++;
      acc += cnt * v;
    }
    return acc / n;
  }

  /** Numerator for doubling: one card, then stand, on twice the stake. */
  private doubleValue(key: number, hard: number, hasAce: boolean): number {
    const c = this.c;
    const n = this.n;
    let acc = 0;
    for (let k = 0; k < 10; k++) {
      const cnt = c[k];
      if (cnt === 0) continue;
      const r = k + 1;
      const h2 = hard + r;
      c[k]--;
      this.n--;
      let v: number;
      if (h2 > 21) v = -this.noBJ();
      else {
        const ace = hasAce || r === 1;
        v = this.stand(key + POW[k], ace && h2 + 10 <= 21 ? h2 + 10 : h2);
      }
      c[k]++;
      this.n++;
      acc += cnt * v;
    }
    return (2 * acc) / n;
  }

  /**
   * Numerators for a hand (2 or more cards, not bust) drawn from this context's base composition.
   * Throws if the base doesn't hold the cards.
   */
  evaluate(cards: readonly number[], what: Array<"stand" | "hit" | "double"> = ["stand", "hit", "double"]): HandNumerators {
    const after = withoutCards(this.base, cards, "the remaining shoe");
    const shape = handShape(cards);
    if (shape.hard > 21) throw new Error("The hand is already bust.");
    const key = keyOf(cards);
    // Move the working composition to base - hand for the duration of the call.
    this.c.set(after);
    this.n = shoeTotal(after);
    try {
      if (this.n === 0) throw new Error("The shoe is empty.");
      const noBJ = this.noBJ();
      if (noBJ <= 0) throw new Error("With these cards the dealer must have blackjack.");
      const stand = this.stand(key, shape.total);
      const hit = what.includes("hit") ? this.hitValue(key, shape.hard, shape.hasAce) : NaN;
      const double = what.includes("double") ? this.doubleValue(key, shape.hard, shape.hasAce) : NaN;
      return { stand, hit, double, noBJ };
    } finally {
      this.c.set(this.base);
      this.n = shoeTotal(this.base);
    }
  }
}
