// The 4-8 deck basic strategy chart from the original "Blackjack Strategy Drill" artifact, copied
// verbatim (its STRATEGY-START block). A well-known published chart, kept here as a regression
// reference for the engine: scripts/derive-strategy.ts and src/engine/derived.test.ts compare the
// derived "4-8" tables against it. Not used by the app at runtime.

import type { Category, Code, Rules, Upcard } from "../strategy/types";
import { UPCARDS } from "../strategy/types";

const HARD: Record<number, string> = {
  8: "H H H H H H H H H H",
  9: "H Dh Dh Dh Dh H H H H H",
  10: "Dh Dh Dh Dh Dh Dh Dh Dh H H",
  11: "Dh Dh Dh Dh Dh Dh Dh Dh Dh H",
  12: "H H S S S H H H H H",
  13: "S S S S S H H H H H",
  14: "S S S S S H H H H H",
  15: "S S S S S H H H Rh H",
  16: "S S S S S H H Rh Rh Rh",
  17: "S S S S S S S S S S"
};
const SOFT: Record<number, string> = {
  2: "H H H Dh Dh H H H H H",
  3: "H H H Dh Dh H H H H H",
  4: "H H Dh Dh Dh H H H H H",
  5: "H H Dh Dh Dh H H H H H",
  6: "H Dh Dh Dh Dh H H H H H",
  7: "S Ds Ds Ds Ds S S H H H",
  8: "S S S S S S S S S S",
  9: "S S S S S S S S S S"
};
const PAIRS: Record<number, string> = {
  2: "Ph Ph P P P P H H H H",
  3: "Ph Ph P P P P H H H H",
  4: "H H H Ph Ph H H H H H",
  5: "Dh Dh Dh Dh Dh Dh Dh Dh H H",
  6: "Ph P P P P H H H H H",
  7: "P P P P P P H H H H",
  8: "P P P P P P P P P P",
  9: "P P P P P S P P S S",
  10: "S S S S S S S S S S",
  11: "P P P P P P P P P P"
};
const H17_CHANGES: Record<string, string> = {
  "hard:11:11": "Dh",
  "hard:15:11": "Rh",
  "hard:17:11": "Rs",
  "soft:7:2": "Ds",
  "soft:8:6": "Ds",
  "pair:8:11": "Rp"
};

/**
 * The original chart's code for a cell, specialised to the rules the original app supported
 * (h17, das, surrender). Hard rows below 8 are hit and above 17 stand, as in the original app.
 */
export function referenceCode(cat: Category, row: number, up: Upcard, rules: Pick<Rules, "h17" | "das" | "surrender">): Code {
  if (cat === "hard") {
    if (row < 8) return "H";
    if (row > 17) return "S";
  }
  const table = cat === "hard" ? HARD : cat === "soft" ? SOFT : PAIRS;
  const id = cat + ":" + row + ":" + up;
  let raw = rules.h17 && H17_CHANGES[id] ? H17_CHANGES[id] : table[row].split(" ")[UPCARDS.indexOf(up)];
  if (raw === "Ph") raw = rules.das ? "P" : "H";
  if (!rules.surrender && raw[0] === "R") raw = raw === "Rh" ? "H" : raw === "Rs" ? "S" : "P";
  return raw as Code;
}
