// Shoe compositions. Pure TypeScript, no Node or DOM APIs (runs in Node and in a browser Worker).
//
// A composition ("counts") is an array of 10 integers: counts[r - 1] is the number of cards of
// rank r still in the shoe, where r = 1 is an ace and r = 10 is any ten-value card (10, J, Q, K).

import type { Rank } from "../strategy/types";

export type Counts = Int32Array;

/** 32^k: the place value of rank index k (= rank - 1) in a multiset key. */
export const KEY_BASE = 32;
export const POW: readonly number[] = Array.from({ length: 10 }, (_, k) => KEY_BASE ** k);

const RANK_NAME = ["aces", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "ten-value cards"];

/** A full shoe of `decks` 52-card decks. */
export function freshShoe(decks: number): Counts {
  if (!Number.isInteger(decks) || decks < 1) throw new Error(`freshShoe: decks must be a positive integer, got ${decks}`);
  const c = new Int32Array(10);
  for (let k = 0; k < 9; k++) c[k] = 4 * decks;
  c[9] = 16 * decks;
  return c;
}

export function isRank(r: unknown): r is Rank {
  return typeof r === "number" && Number.isInteger(r) && r >= 1 && r <= 10;
}

export function assertRank(r: unknown, what: string): asserts r is Rank {
  if (!isRank(r)) throw new Error(`${what}: ${String(r)} is not a card rank (use 1 for an ace, 2..9, 10 for any ten-value card)`);
}

export function shoeTotal(c: ArrayLike<number>): number {
  let n = 0;
  for (let k = 0; k < 10; k++) n += c[k];
  return n;
}

/**
 * Copy of `c` with `cards` removed. Throws a clear Error when the shoe doesn't hold that many
 * cards of some rank (e.g. five aces from one deck). `label` describes the shoe in the message.
 */
export function withoutCards(c: ArrayLike<number>, cards: readonly number[], label: string): Counts {
  const out = Int32Array.from(c as ArrayLike<number>);
  const asked = new Int32Array(10);
  for (const r of cards) {
    assertRank(r, "card");
    asked[r - 1]++;
  }
  for (let k = 0; k < 10; k++) {
    if (asked[k] > out[k]) {
      throw new Error(
        `Impossible cards: ${asked[k]} ${RANK_NAME[k]} requested but ${label} holds only ${out[k]}.`
      );
    }
    out[k] -= asked[k];
  }
  return out;
}

/** Multiset key of a list of ranks (each rank's count must stay below KEY_BASE). */
export function keyOf(cards: readonly number[]): number {
  let key = 0;
  for (const r of cards) key += POW[r - 1];
  return key;
}

/** Hard total (aces as 1) and whether the hand holds an ace. */
export function handShape(cards: readonly number[]): { hard: number; hasAce: boolean; total: number; soft: boolean } {
  let hard = 0;
  let hasAce = false;
  for (const r of cards) {
    hard += r;
    if (r === 1) hasAce = true;
  }
  const soft = hasAce && hard + 10 <= 21;
  return { hard, hasAce, total: soft ? hard + 10 : hard, soft };
}
