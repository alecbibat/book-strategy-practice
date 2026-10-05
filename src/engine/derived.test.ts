// src/strategy/derived.json: shape, freshness (re-derived here for some combos) and agreement with
// the original Strategy Drill chart for 4-8 decks.
import { describe, expect, it } from "vitest";
import derived from "../strategy/derived.json";
import type { Category, Code, Rules, Upcard } from "../strategy/types";
import { CODES, UPCARDS } from "../strategy/types";
import { allRuleCombos, comboKey, decideCode, deriveDecksH17, ROWS } from "./derive";
import { referenceCode } from "./reference-chart";

type Combo = Record<Category, Record<string, string>>;
const combos = derived.combos as Record<string, Combo>;
const CATS: Category[] = ["hard", "soft", "pair"];

describe("derived.json", () => {
  it("has all 72 combos with 10 valid codes per row", () => {
    const keys = allRuleCombos().map(comboKey);
    expect(keys).toHaveLength(72);
    expect(Object.keys(combos).sort()).toEqual(keys.slice().sort());
    for (const rules of allRuleCombos()) {
      const c = combos[comboKey(rules)];
      for (const cat of CATS) {
        expect(Object.keys(c[cat]).map(Number)).toEqual(ROWS[cat]);
        for (const row of ROWS[cat]) {
          const codes = c[cat][row].split(" ");
          expect(codes).toHaveLength(10);
          for (const code of codes) {
            expect(CODES).toContain(code as Code);
            if (code[0] === "R") expect(rules.surrender).toBe(true);
            if (code === "P" || code === "Rp") expect(cat).toBe("pair");
          }
        }
      }
    }
    expect(derived.meta.generatedBy).toMatch(/derive-strategy/);
    expect(JSON.stringify(derived).length).toBeLessThan(200 * 1024);
  });

  it("matches the original artifact's 4-8 deck chart in every cell (double any)", () => {
    const mismatches: string[] = [];
    for (const rules of allRuleCombos()) {
      if (rules.decks !== "4-8" || rules.double !== "any") continue;
      const c = combos[comboKey(rules)];
      for (const cat of CATS) {
        for (const row of ROWS[cat]) {
          const codes = c[cat][row].split(" ");
          UPCARDS.forEach((up: Upcard, i) => {
            const ref = referenceCode(cat, row, up, rules);
            if (codes[i] !== ref) mismatches.push(`${comboKey(rules)} ${cat}:${row}:${up} derived ${codes[i]} chart ${ref}`);
          });
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("first-two-card doubling is evaluated as if allowed, so hard/soft rows don't depend on the double rule", () => {
    for (const rules of allRuleCombos()) {
      if (rules.double === "any") continue;
      const c = combos[comboKey(rules)];
      const any = combos[comboKey({ ...rules, double: "any" })];
      expect(c.hard).toEqual(any.hard);
      expect(c.soft).toEqual(any.soft);
    }
  });

  it("is up to date with the engine (re-derived for 1 deck H17 and 4-8 decks S17)", () => {
    for (const [decks, h17] of [["1", true], ["4-8", false]] as const) {
      const fresh = deriveDecksH17(decks, h17);
      for (const key of Object.keys(fresh)) expect(combos[key]).toEqual(fresh[key]);
    }
  });

  it("lists close cells with margins below 0.005", () => {
    expect(derived.close.length).toBeGreaterThan(0);
    for (const e of derived.close) {
      expect(combos[e.key]).toBeDefined();
      expect(e.margin).toBeGreaterThanOrEqual(0);
      expect(e.margin).toBeLessThan(0.005);
      expect(e.best).not.toBe(e.second);
      const [cat, row, up] = e.cell.split(":");
      const codes = combos[e.key][cat as Category][row].split(" ");
      expect(codes[UPCARDS.indexOf(Number(up) as Upcard)]).toBe(e.code);
    }
  });

  it("a pair that can't be doubled under the restriction falls back to the split when the split beats hit/stand", () => {
    // 1 deck S17 DAS, 4,4 v 6: double (as if allowed) +0.193 > split +0.191 > hit +0.175.
    const ev = { stand: -0.114, hit: 0.175, double: 0.193, split: 0.191, surrender: null };
    const rules: Rules = { decks: "1", h17: false, das: true, surrender: false, double: "10-11" };
    expect(decideCode(ev, "pair", 4, rules).code).toBe("P"); // 4,4 = hard 8 can't be doubled under 10-11
    expect(decideCode(ev, "pair", 4, { ...rules, double: "any" }).code).toBe("Dh");
    expect(decideCode({ ...ev, split: 0.17 }, "pair", 4, rules).code).toBe("Dh"); // hit beats split: Dh falls back to hit
    expect(decideCode(ev, "pair", 5, rules).code).toBe("Dh"); // 5,5 = hard 10 can be doubled
    expect(combos["1|S17|DAS|NS|10-11"].pair["4"].split(" ")[4]).toBe("P");
  });
});
