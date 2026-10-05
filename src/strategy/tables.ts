// PLACEHOLDER: the 4-8 deck chart from the original Strategy Drill artifact, used for every deck group.
// To be replaced by verified tables for 1, 2 and 4-8 decks.
import type { Category, Code, Rules, Upcard } from "./types";
import { UPCARDS } from "./types";

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

export function strategyCode(cat: Category, row: number, up: Upcard, rules: Rules): Code {
  if (cat === "hard") {
    if (row <= 8) row = 8;
    if (row >= 17) {
      if (row > 17) return "S";
    }
  }
  if (cat === "soft") {
    if (row <= 1) return "H";
    if (row >= 9) return "S";
  }
  const table = cat === "hard" ? HARD : cat === "soft" ? SOFT : PAIRS;
  const id = cat + ":" + row + ":" + up;
  let raw = rules.h17 && H17_CHANGES[id] ? H17_CHANGES[id] : table[row].split(" ")[UPCARDS.indexOf(up)];
  if (raw === "Ph") raw = rules.das ? "P" : "H";
  if (!rules.surrender && raw[0] === "R") raw = raw === "Rh" ? "H" : raw === "Rs" ? "S" : "P";
  return raw as Code;
}

export function chartSummary(rules: Rules): string {
  const decks = rules.decks === "1" ? "1 deck" : rules.decks === "2" ? "2 decks" : "4–8 decks";
  const dbl = rules.double === "any" ? "Double any two cards" : rules.double === "9-11" ? "Double on 9–11" : "Double on 10–11";
  return [decks, rules.h17 ? "Dealer hits soft 17" : "Dealer stands on soft 17", rules.das ? "Double after split" : "No double after split",
    rules.surrender ? "Late surrender" : "No surrender", dbl].join(" · ");
}
