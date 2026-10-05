// The squares of the printed strategy card, and how to name them.
import { canDouble, canSurrender, resolveCode } from "./resolve";
import { strategyCode } from "./tables";
import type { Action, Category, Code, Rules, Upcard } from "./types";
import { UPCARDS } from "./types";

export interface Cell {
  cat: Category;
  row: number;
  up: Upcard;
}

export const SECTIONS: { cat: Category; title: string; rows: number[] }[] = [
  { cat: "hard", title: "Hard totals", rows: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] },
  { cat: "soft", title: "Soft totals", rows: [2, 3, 4, 5, 6, 7, 8, 9] },
  { cat: "pair", title: "Pairs", rows: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
];

export const CELLS: Cell[] = [];
SECTIONS.forEach(s => s.rows.forEach(row => UPCARDS.forEach(up => CELLS.push({ cat: s.cat, row, up }))));

export const idOf = (c: Cell): string => c.cat + ":" + c.row + ":" + c.up;
export const CELL_BY_ID: Record<string, Cell> = {};
CELLS.forEach(c => { CELL_BY_ID[idOf(c)] = c; });

export const LABEL: Record<Action, string> = { hit: "Hit", stand: "Stand", double: "Double", split: "Split", surrender: "Surrender" };
export const SHORT: Record<Action, string> = { hit: "H", stand: "S", double: "D", split: "P", surrender: "R" };

export const upLabel = (u: Upcard): string => (u === 11 ? "A" : String(u));
export function rowLabel(cat: Category, row: number): string {
  if (cat === "hard") return String(row);
  if (cat === "soft") return "A," + (row === 10 ? "10" : row);
  return row === 11 ? "A,A" : row === 10 ? "10,10" : row + "," + row;
}
export const cellTitle = (c: Cell): string => rowLabel(c.cat, c.row) + " vs " + upLabel(c.up);

export function handName(cat: Category, row: number): string {
  if (cat === "hard") return "Hard " + row;
  if (cat === "soft") return "Soft " + (11 + row);
  if (row === 11) return "Pair of aces";
  if (row === 10) return "Pair of tens";
  return "Pair of " + row + "s";
}

export function upPhrase(u: Upcard): string {
  return u === 11 ? "an ace" : u === 8 ? "an 8" : "a " + u;
}

/** Hard total (aces as 1) of the two cards a chart square stands for, used for doubling restrictions. */
export function twoCardHardTotal(cat: Category, row: number): number {
  if (cat === "hard") return row;
  if (cat === "soft") return 1 + row;
  return row === 11 ? 2 : row * 2;
}

/** Whether a chart square's two-card hand is soft (an ace counted as 11). Pairs of aces count as soft. */
export const twoCardSoft = (cat: Category, row: number): boolean => cat === "soft" || (cat === "pair" && row === 11);

/** The code and the action a fresh two-card hand in this square should take under these rules. */
export function cellPlay(cat: Category, row: number, up: Upcard, rules: Rules): { code: Code; action: Action } {
  const code = strategyCode(cat, row, up, rules);
  const avail = {
    double: canDouble(twoCardHardTotal(cat, row), twoCardSoft(cat, row), 2, rules),
    surrender: canSurrender(2, rules),
    split: cat === "pair"
  };
  const action = resolveCode(code, avail);
  if (action) return { code, action };
  // Only reachable if a non-pair square asked to split, which the tables never do.
  throw new Error("No playable action for " + cat + ":" + row + ":" + up);
}

export const correctAction = (c: Cell, rules: Rules): Action => cellPlay(c.cat, c.row, c.up, rules).action;
