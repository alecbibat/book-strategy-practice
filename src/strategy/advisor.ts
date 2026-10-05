// Turns any set of cards (dealer upcard plus the player's hand) into a basic-strategy play.
import { CELL_BY_ID } from "./cells";
import { canDouble, canSurrender, codeChain, resolveCode, type Availability } from "./resolve";
import { strategyCode } from "./tables";
import type { Action, Category, Code, Rank, Rules, Upcard } from "./types";
import { rankToUp } from "./types";

export const MAX_SPLIT_HANDS = 4;

export interface HandValue {
  /** Total with every ace counted as 1. */
  hard: number;
  /** Best total (an ace counted as 11 when that doesn't bust). */
  total: number;
  soft: boolean;
  /** Two cards of the same value (any two ten-value cards count). */
  pair: boolean;
  n: number;
}

export function handValue(cards: Rank[]): HandValue {
  const hard = cards.reduce((s, r) => s + r, 0);
  const hasAce = cards.includes(1);
  const soft = hasAce && hard + 10 <= 21;
  return { hard, total: soft ? hard + 10 : hard, soft, pair: cards.length === 2 && cards[0] === cards[1], n: cards.length };
}

export interface AdvisorContext {
  /** The hand came from splitting a pair. */
  afterSplit?: boolean;
  /** Hands in play from splitting (counts this one). Defaults to 2 after a split, else 1. */
  hands?: number;
}

export type Advice =
  | { kind: "need-upcard" }
  | { kind: "need-cards"; have: number }
  | { kind: "blackjack" }
  | { kind: "bust"; value: HandValue }
  | { kind: "twenty-one"; value: HandValue }
  | {
      kind: "play";
      action: Action;
      /** The chart square this answer came from, as "cat:row:up". */
      cellId: string;
      cat: Category;
      row: number;
      up: Upcard;
      code: Code;
      /** The code's preference order, e.g. double then hit. */
      chain: Action[];
      avail: Availability;
      value: HandValue;
      /** True when the square isn't on the printed card (hard 4-7 or 18-20, soft 12). */
      offChart: boolean;
      /** Square on the printed card showing the same advice, when there is one. */
      chartCellId: string | null;
      /** Plain-language notes about why the play differs from the square's first choice. */
      notes: string[];
    };

const VERB: Record<Action, string> = { hit: "hit", stand: "stand", double: "double", split: "split", surrender: "surrender" };

export function advise(player: Rank[], up: Rank | null, rules: Rules, ctx: AdvisorContext = {}): Advice {
  if (up === null) return { kind: "need-upcard" };
  if (player.length < 2) return { kind: "need-cards", have: player.length };
  const afterSplit = !!ctx.afterSplit;
  const hands = ctx.hands ?? (afterSplit ? 2 : 1);
  const value = handValue(player);
  const upcard = rankToUp(up);

  if (value.n === 2 && value.total === 21 && !afterSplit) return { kind: "blackjack" };
  if (value.total > 21) return { kind: "bust", value };
  if (value.total === 21) return { kind: "twenty-one", value };

  const canSplitHere = value.pair && (!afterSplit || (player[0] !== 1 && hands < MAX_SPLIT_HANDS));
  const avail: Availability = {
    double: canDouble(value.hard, value.soft, value.n, rules, afterSplit),
    surrender: canSurrender(value.n, rules, afterSplit),
    split: canSplitHere
  };
  const notes: string[] = [];

  // A splittable pair is looked up in the pairs section; everything else by its total.
  const lookups: { cat: Category; row: number }[] = [];
  if (canSplitHere) lookups.push({ cat: "pair", row: player[0] === 1 ? 11 : player[0] });
  lookups.push(value.soft ? { cat: "soft", row: value.total - 11 } : { cat: "hard", row: value.hard });

  for (const { cat, row } of lookups) {
    const code = strategyCode(cat, row, upcard, rules);
    const action = resolveCode(code, avail);
    if (!action) continue; // a pair that can't be split here: fall through to its total
    const chain = codeChain(code);
    if (chain[0] !== action) notes.push(fallbackReason(chain, action, value, rules, afterSplit));
    if (value.pair && !canSplitHere && cat !== "pair") {
      notes.unshift(player[0] === 1 && afterSplit
        ? "Aces can’t be resplit, so this plays as a soft 12."
        : "You’re at the " + MAX_SPLIT_HANDS + "-hand limit, so this plays as a total.");
    }
    const cellId = cat + ":" + row + ":" + upcard;
    const onChart = !!CELL_BY_ID[cellId];
    return {
      kind: "play", action, cellId, cat, row, up: upcard, code, chain, avail, value,
      offChart: !onChart, chartCellId: onChart ? cellId : null, notes
    };
  }
  throw new Error("No play found for " + player.join(",") + " vs " + up);
}

function fallbackReason(chain: Action[], action: Action, value: HandValue, rules: Rules, afterSplit: boolean): string {
  const wanted = chain[0];
  const why =
    wanted === "double"
      ? value.n > 2
        ? "you can only double on your first two cards"
        : afterSplit && !rules.das
          ? "this table doesn’t allow doubling after a split"
          : rules.double === "9-11"
            ? "this table only allows doubling on hard 9, 10 and 11"
            : "this table only allows doubling on hard 10 and 11"
      : wanted === "surrender"
        ? value.n > 2
          ? "you can only surrender your first two cards"
          : afterSplit
            ? "you can’t surrender after splitting"
            : "surrender isn’t offered"
        : "splitting isn’t possible here";
  return "The chart says " + VERB[wanted] + ", but " + why + ", so " + VERB[action] + ".";
}

/** Short name for a hand, e.g. "Soft 18", "Hard 16", "Pair of 8s", "Blackjack". */
export function describeHand(cards: Rank[], afterSplit = false): string {
  if (!cards.length) return "";
  const v = handValue(cards);
  if (v.n === 1) return cards[0] === 1 ? "Ace" : String(cards[0]);
  if (v.n === 2 && v.total === 21 && !afterSplit) return "Blackjack";
  if (v.total > 21) return "Bust · " + v.total;
  if (v.pair) return cards[0] === 1 ? "Pair of aces" : cards[0] === 10 ? "Pair of tens" : "Pair of " + cards[0] + "s";
  return (v.soft ? "Soft " : "Hard ") + v.total;
}
