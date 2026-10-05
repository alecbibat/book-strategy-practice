// Shared vocabulary for the strategy tables, the EV engine and the UI.

/** Which chart to use. "4-8" covers 4 to 8 deck shoes (the engine models it as 6 decks). */
export type DeckGroup = "1" | "2" | "4-8";

/** Which first-two-card totals may be doubled. Restrictions apply to hard totals only. */
export type DoubleRule = "any" | "9-11" | "10-11";

/**
 * Table rules that change basic strategy.
 * Always assumed: the dealer peeks for blackjack (US hole card), blackjack pays 3:2,
 * split up to 4 hands, split aces get one card each and can't be resplit.
 */
export interface Rules {
  decks: DeckGroup;
  /** Dealer hits soft 17. */
  h17: boolean;
  /** Double after split allowed (subject to the same `double` restriction). */
  das: boolean;
  /** Late surrender offered (first two cards, after the dealer checks for blackjack). */
  surrender: boolean;
  double: DoubleRule;
}

export const DEFAULT_RULES: Rules = { decks: "4-8", h17: false, das: true, surrender: true, double: "any" };

export const DECK_GROUPS: DeckGroup[] = ["1", "2", "4-8"];
export const DOUBLE_RULES: DoubleRule[] = ["any", "9-11", "10-11"];

export type Action = "hit" | "stand" | "double" | "split" | "surrender";
export const ACTIONS: Action[] = ["hit", "stand", "double", "split", "surrender"];

/** Chart sections. */
export type Category = "hard" | "soft" | "pair";

/**
 * Dealer upcard value: 2..10, 11 = ace.
 * Chart rows:
 *   hard: the hard total, 4..21 (the printed card shows 8..17; ≤7 always hit, ≥18 always stand)
 *   soft: the non-ace part of the total, so soft total = 11 + row. 1..10 (A,A as soft 12 .. soft 21).
 *         The printed card shows 2..9 (A,2 .. A,9).
 *   pair: the pair card's value 2..11 (10 = any two ten-value cards, 11 = aces).
 */
export type Upcard = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export const UPCARDS: Upcard[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * A chart cell, already specialised for the full rule set:
 *   H  hit             S  stand
 *   Dh double, else hit (when doubling isn't allowed for this hand)
 *   Ds double, else stand
 *   P  split (if splitting isn't possible, play the hand by its total)
 *   Rh surrender, else hit    Rs surrender, else stand    Rp surrender, else split
 * Surrender codes only appear when rules.surrender is true. Doubling codes may appear even when
 * the rule restricts doubling for that total; resolution falls back to the second letter.
 */
export type Code = "H" | "S" | "Dh" | "Ds" | "P" | "Rh" | "Rs" | "Rp";
export const CODES: Code[] = ["H", "S", "Dh", "Ds", "P", "Rh", "Rs", "Rp"];

/** Card value as the engine sees it: 1 = ace, 10 = any ten-value card. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const upToRank = (up: Upcard): Rank => (up === 11 ? 1 : up) as Rank;
export const rankToUp = (r: Rank): Upcard => (r === 1 ? 11 : r) as Upcard;

/** Number of decks the engine uses for a deck group. */
export const engineDecks = (g: DeckGroup): number => (g === "1" ? 1 : g === "2" ? 2 : 6);
