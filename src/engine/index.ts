// Blackjack expected-value engine: public API.
//
// Pure TypeScript, no dependencies, no Node/DOM APIs: runs in Node and in a browser Worker.
//
// Rules modelled (see ../strategy/types.ts): `rules.decks` -> engineDecks() decks ("4-8" = 6 decks),
// dealer hits/stands on soft 17, double after split, late surrender, doubling restricted to hard
// 9-11 / 10-11 (restriction applies to hard totals; soft hands can't be doubled under it; doubling
// after a split obeys the same restriction). Always assumed: the dealer peeks (all EVs are
// conditional on the dealer NOT having blackjack), blackjack pays 3:2, split up to 4 hands, split aces
// get one card each and can't be resplit, a split ace + ten is 21 (not blackjack), no doubling or
// surrender after hitting, surrender only on the first two cards and never after a split.
//
// Exact parts: the shoe composition (all known cards removed), the dealer's play (drawn without
// replacement from the composition at the moment the player stands, H17/S17, no-blackjack
// conditioning), hitting (composition-dependent recursion with card removal), doubling, and the peek
// conditioning of the player's own draws. Approximations: the split model (split.ts) and the
// "stand on 21" shortcut (hand.ts).

import type { Action, Rank, Rules } from "../strategy/types";
import { engineDecks } from "../strategy/types";
import { canDouble, canSurrender } from "../strategy/resolve";
import { HandContext } from "./hand";
import { splitEVFromTable, splitHandTable, MAX_HANDS } from "./split";
import { assertRank, freshShoe, handShape, withoutCards } from "./shoe";

export { freshShoe, shoeTotal, withoutCards, type Counts } from "./shoe";
export { dealerDistribution, dealerBlackjackProb, dealerGraph, dealerMass, standValue } from "./dealer";
export { HandContext, type HandNumerators } from "./hand";
export { splitHandTable, splitEVFromTable, expectedHandCounts, MAX_HANDS, type SplitHandTable } from "./split";

export interface EVQuery {
  /** The hand's cards (>= 2), 1 = ace, 10 = any ten-value card. For a split hand, player[0] is the split card. */
  player: Rank[];
  /** Dealer upcard (1 = ace). */
  up: Rank;
  rules: Rules;
  /** Other cards known to be out of the shoe (other players' cards, other split hands, ...). */
  seen?: Rank[];
  /** This hand came from a split (double only with DAS + restriction; no surrender). */
  afterSplit?: boolean;
  /** Hands currently in play from splitting (default 1, or 2 when afterSplit). Resplit while < 4, never aces. */
  hands?: number;
}

export interface EVResult {
  stand: number;
  hit: number;
  /** null when doubling isn't allowed for this hand under the rules. */
  double: number | null;
  /** null when the hand isn't a splittable pair (or no more splits are allowed). */
  split: number | null;
  /** null when surrender isn't allowed. */
  surrender: number | null;
  /** argmax over the non-null entries. */
  best: Action;
}

// ---------------------------------------------------------------------------------------------
// Context cache. A HandContext memoises every hand state reachable from one base composition, so
// queries that share the shoe (same rules.decks, upcard, seen cards and H17 flag) reuse each other's
// work. Bounded LRU so a long browser session can't grow without limit.

const MAX_CONTEXTS = 32;
const contexts = new Map<string, HandContext>();

/** Cached HandContext for a base composition. */
export function contextFor(base: ArrayLike<number>, up: number, h17: boolean): HandContext {
  const id = (h17 ? "H" : "S") + up + ":" + Array.prototype.join.call(base, ",");
  let ctx = contexts.get(id);
  if (ctx) {
    contexts.delete(id);
    contexts.set(id, ctx);
    return ctx;
  }
  ctx = new HandContext(base, up, h17);
  contexts.set(id, ctx);
  if (contexts.size > MAX_CONTEXTS) contexts.delete(contexts.keys().next().value as string);
  return ctx;
}

/** Drop all cached contexts (frees memory; results are unaffected). */
export function clearEngineCache(): void {
  contexts.clear();
}

const ORDER: Action[] = ["stand", "hit", "double", "split", "surrender"];

function bestOf(r: Omit<EVResult, "best">): Action {
  let best: Action = "stand";
  let bv = -Infinity;
  for (const a of ORDER) {
    const v = r[a];
    if (v !== null && v > bv + 1e-12) {
      bv = v;
      best = a;
    }
  }
  return best;
}

/**
 * Expected values of every action for one hand, per one unit of this hand's initial bet,
 * conditional on the dealer not having blackjack.
 *   stand / hit: hit = take a card and continue optimally (hit or stand).
 *   double: net result with the doubled stake (one card, then stand).
 *   split: combined net result of all resulting hands per one original unit (see split.ts).
 *   surrender: -0.5.
 *
 * Naturals: a two-card 21 not after a split returns stand = 1.5 and best = 'stand'; `hit` is the
 * value of (pointlessly) hitting the soft 21, and double / split / surrender are null.
 *
 * Split aces: the engine doesn't know whether an afterSplit hand came from split aces. A split-ace
 * hand gets one card and must stand; callers should not offer it any other action. An afterSplit
 * [A, A] can't be resplit (split = null).
 *
 * Throws an Error when the cards are impossible for the shoe (e.g. five aces from one deck), when
 * the hand has fewer than 2 cards, or when it is already bust.
 */
export function handEVs(q: EVQuery): EVResult {
  const { player, up, rules } = q;
  const seen = q.seen ?? [];
  const afterSplit = q.afterSplit === true;
  const hands = q.hands ?? (afterSplit ? 2 : 1);
  if (!Array.isArray(player) || player.length < 2) throw new Error("handEVs: a hand needs at least 2 cards");
  player.forEach((r) => assertRank(r, "player card"));
  seen.forEach((r) => assertRank(r, "seen card"));
  assertRank(up, "dealer upcard");
  if (!Number.isInteger(hands) || hands < 1 || hands > MAX_HANDS) throw new Error(`handEVs: hands must be 1..${MAX_HANDS}`);

  const decks = engineDecks(rules.decks);
  const shoe = freshShoe(decks);
  const label = `a ${decks}-deck shoe`;
  // Validate everything together so the message counts player + upcard + seen cards.
  withoutCards(shoe, [...player, up, ...seen], label);
  const base = withoutCards(shoe, [up, ...seen], label);

  const shape = handShape(player);
  if (shape.hard > 21) throw new Error("handEVs: the hand is already bust");
  const n = player.length;
  const ctx = contextFor(base, up, rules.h17);

  const natural = n === 2 && !afterSplit && shape.total === 21;
  const allowDouble = !natural && canDouble(shape.hard, shape.soft, n, rules, afterSplit);
  const nums = ctx.evaluate(player, allowDouble ? ["stand", "hit", "double"] : ["stand", "hit"]);

  const stand = natural ? 1.5 : nums.stand / nums.noBJ;
  const hit = nums.hit / nums.noBJ;
  const double = allowDouble ? nums.double / nums.noBJ : null;
  const surrender = !natural && canSurrender(n, rules, afterSplit) ? -0.5 : null;

  let split: number | null = null;
  const pair = n === 2 && player[0] === player[1];
  if (pair && !natural && hands < MAX_HANDS && !(afterSplit && player[0] === 1)) {
    const x = player[0];
    // Split context: the hand holds one pair card, the other one is out of the shoe.
    const splitCtx = contextFor(withoutCards(base, [x], label), up, rules.h17);
    split = splitEVFromTable(splitHandTable(splitCtx, x), rules, hands + 1);
  }

  const res = { stand, hit, double, split, surrender };
  return { ...res, best: natural ? "stand" : bestOf(res) };
}
