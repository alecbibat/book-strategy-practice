// Playing cards on the felt.
import type { Rank } from "../strategy/types";
import { esc, pick } from "./dom";

export type Suit = "♠" | "♥" | "♦" | "♣";
export const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const SUIT_NAME: Record<Suit, string> = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };
const TEXT_STYLE = "︎"; // keep suits as text glyphs, not emoji
export const TENS = ["10", "J", "Q", "K"] as const;
const RANK_NAME: Record<string, string> = { A: "Ace", K: "King", Q: "Queen", J: "Jack" };

export interface PlayingCard {
  rank: string;
  suit: Suit;
  red: boolean;
}

export const cardKey = (c: PlayingCard) => c.rank + c.suit;
export const rankText = (r: Rank) => (r === 1 ? "A" : String(r));

/** A card of a given value (2..10, 11 = ace); ten-values pick a random 10/J/Q/K. */
export function makeCard(value: number, suit?: Suit, tenRank?: string): PlayingCard {
  const s = suit ?? pick(SUITS);
  const rank = value === 11 || value === 1 ? "A" : value === 10 ? (tenRank ?? pick(TENS)) : String(value);
  return { rank, suit: s, red: s === "♥" || s === "♦" };
}

export function spoken(card: PlayingCard): string {
  return (RANK_NAME[card.rank] || card.rank) + " of " + SUIT_NAME[card.suit];
}

/**
 * Card markup. `tag` lets the advisor render cards as buttons (tap to remove).
 */
export function cardHTML(card: PlayingCard, i: number, opts: { tag?: "div" | "button"; attrs?: string; label?: string; cls?: string } = {}): string {
  const tag = opts.tag ?? "div";
  const glyph = card.suit + TEXT_STYLE;
  const isFace = card.rank === "J" || card.rank === "Q" || card.rank === "K";
  const idx = (cls: string) =>
    '<span class="idx ' + cls + (card.rank === "10" ? " ten" : "") + '" aria-hidden="true">' + card.rank + "<i>" + glyph + "</i></span>";
  const center = isFace
    ? '<span class="pip face" aria-hidden="true">' + card.rank + "</span>"
    : '<span class="pip" aria-hidden="true">' + glyph + "</span>";
  const label = opts.label ?? spoken(card);
  const role = tag === "div" ? ' role="img"' : ' type="button"';
  return "<" + tag + ' class="card' + (card.red ? " red" : "") + (opts.cls ? " " + opts.cls : "") + '" style="--i:' + i + '"' + role +
    ' aria-label="' + esc(label) + '"' + (opts.attrs ? " " + opts.attrs : "") + ">" +
    idx("tl") + center + idx("br") + "</" + tag + ">";
}

export function backHTML(i: number): string {
  return '<div class="card back" style="--i:' + i + '" role="img" aria-label="Face-down card"></div>';
}

export function slotHTML(label: string, i: number, attrs = ""): string {
  return '<div class="card slot" style="--i:' + i + '" ' + attrs + '><span aria-hidden="true">?</span><span class="sr">' + esc(label) + "</span></div>";
}
