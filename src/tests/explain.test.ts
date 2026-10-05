import { describe, expect, it } from "vitest";
import { CELLS, cellPlay } from "../strategy/cells";
import { explainCell, formatUps, rowSummary, ruleNotes } from "../strategy/explain";
import type { Rules, Upcard } from "../strategy/types";
import { DEFAULT_RULES } from "../strategy/types";
import { HARD_COMBOS } from "../ui/drill";

const R = (patch: Partial<Rules> = {}): Rules => ({ ...DEFAULT_RULES, ...patch });

const ALL_RULES: Rules[] = [];
for (const decks of ["1", "2", "4-8"] as const)
  for (const h17 of [false, true])
    for (const das of [false, true])
      for (const surrender of [false, true])
        for (const double of ["any", "9-11", "10-11"] as const) ALL_RULES.push({ decks, h17, das, surrender, double });

describe("formatUps", () => {
  it.each([
    [[8], "an 8"],
    [[11], "an ace"],
    [[10, 11], "a 10 or an ace"],
    [[4, 5, 6], "4, 5 and 6"],
    [[3, 4, 5, 6], "3 through 6"],
    [[2, 7, 8], "2, 7 and 8"],
    [[7, 8, 9, 10, 11], "7 through ace"],
    [[2, 3, 4, 5, 6, 8, 9], "2 through 6, 8 and 9"]
  ] as [Upcard[], string][])("%j -> %s", (ups, text) => {
    expect(formatUps(ups)).toBe(text);
  });
});

describe("rowSummary (4-8 decks, S17, DAS, late surrender)", () => {
  it("reads like the classic card", () => {
    expect(rowSummary("hard", 12, R())).toBe("Hard 12: stand against 4, 5 and 6, otherwise hit.");
    expect(rowSummary("hard", 17, R())).toBe("Hard 17: always stand.");
    expect(rowSummary("soft", 7, R())).toBe("Soft 18 (A,7): double against 3 through 6, stand against 2, 7 and 8, otherwise hit.");
    expect(rowSummary("pair", 9, R())).toBe("Pair of 9s: split against 2 through 6, 8 and 9, otherwise stand.");
    expect(rowSummary("hard", 16, R())).toBe("Hard 16: surrender against 9, 10 and ace, hit against a 7 or an 8, otherwise stand.");
  });

  it("follows the rules it's given", () => {
    expect(rowSummary("hard", 16, R({ surrender: false }))).toBe("Hard 16: stand against 2 through 6, otherwise hit.");
    expect(rowSummary("soft", 7, R({ double: "10-11" }))).toBe("Soft 18 (A,7): hit against 9, 10 and ace, otherwise stand.");
  });
});

describe("ruleNotes", () => {
  it("says what changes under other rules", () => {
    expect(ruleNotes("soft", 7, 2, R())).toContain("If the dealer hits soft 17, double.");
    const h17 = ruleNotes("soft", 7, 2, R({ h17: true }));
    expect(h17).toContain("If doubling isn’t allowed, stand.");
    expect(h17).toContain("If the dealer stands on soft 17, stand.");
    expect(ruleNotes("hard", 16, 10, R())).toContain("If surrender isn’t offered, hit.");
    expect(ruleNotes("hard", 16, 10, R({ surrender: false }))).toContain("Where late surrender is offered, surrender.");
    expect(ruleNotes("pair", 4, 5, R())).toContain("Without double after split, hit.");
  });
});

describe("every square under every rule set", () => {
  it("explains the play it recommends", () => {
    for (const rules of ALL_RULES) {
      for (const c of CELLS) {
        const ex = explainCell(c.cat, c.row, c.up, rules);
        expect(ex.action).toBe(cellPlay(c.cat, c.row, c.up, rules).action);
        // The row summary must name the recommended play somewhere.
        expect(ex.summary).toContain(ex.action === "double" ? "double" : ex.action);
        for (const n of ex.notes) expect(n).not.toMatch(/undefined/);
      }
    }
  });
});

describe("drill deals", () => {
  it("only uses two-card combos that make the total and aren't pairs", () => {
    for (const [total, combos] of Object.entries(HARD_COMBOS)) {
      for (const [a, b] of combos) {
        expect(a + b).toBe(Number(total));
        expect(a).not.toBe(b);
        expect(a).toBeGreaterThan(1);
      }
    }
  });
});
