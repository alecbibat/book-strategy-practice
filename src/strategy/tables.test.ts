// Verification of the final strategy tables (tables.ts) for all 72 rule sets:
//  (a) they equal the EV engine's derivation (derived.json), apart from documented deviations (none);
//  (b) for 4-8 decks they reproduce the original Strategy Drill card;
//  (c) they obey the basic facts of the game;
//  (d) the resolved action is always legal;
//  (e) the engine confirms every resolved first-two-card play is the best legal play, including the
//      off-card rows and the doubling-restriction fallbacks, and every close-calls.ts entry is accurate;
//  (f) spot checks against published charts.
import { beforeAll, describe, expect, it } from "vitest";
import derived from "./derived.json";
import { CLOSE_CALLS, DEVIATIONS, matchesKey, type CloseCall } from "./close-calls";
import { canDouble, canSurrender, codeChain, resolveCode, type Availability } from "./resolve";
import { ROW_RANGE, chartSummary, strategyCode } from "./tables";
import type { Action, Category, Code, Rank, Rules, Upcard } from "./types";
import { CODES, DECK_GROUPS, UPCARDS, upToRank } from "./types";
import { allRuleCombos, cellEVs, comboKey, computeUpcard, decideCode, ROWS, type CellEVs, type UpcardData } from "../engine/derive";
import { handEVs } from "../engine/index";

const COMBOS = allRuleCombos();
const CATS: Category[] = ["hard", "soft", "pair"];
const derivedCombos = derived.combos as Record<string, Record<Category, Record<string, string>>>;
const idOf = (cat: Category, row: number, up: Upcard) => `${cat}:${row}:${up}`;
const rowsOf = (cat: Category): number[] => {
  const [lo, hi] = ROW_RANGE[cat];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
};

function derivedCode(rules: Rules, cat: Category, row: number, up: Upcard): Code {
  return derivedCombos[comboKey(rules)][cat][String(row)].split(" ")[UPCARDS.indexOf(up)] as Code;
}
const findEntry = (list: CloseCall[], key: string, id: string) => list.find((e) => e.cell === id && matchesKey(e.keys, key));

/** Hard total (aces as 1) and softness of the two cards a chart square stands for. */
function twoCard(cat: Category, row: number): { hard: number; soft: boolean } {
  if (cat === "hard") return { hard: row, soft: false };
  if (cat === "soft") return { hard: 1 + row, soft: true };
  return { hard: row === 11 ? 2 : 2 * row, soft: row === 11 };
}

// --------------------------------------------------------------------------------------------
// The original Strategy Drill artifact's chart, copied verbatim (its STRATEGY-START block).
const ORIGINAL_HARD: Record<number, string> = {
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
const ORIGINAL_SOFT: Record<number, string> = {
  2: "H H H Dh Dh H H H H H",
  3: "H H H Dh Dh H H H H H",
  4: "H H Dh Dh Dh H H H H H",
  5: "H H Dh Dh Dh H H H H H",
  6: "H Dh Dh Dh Dh H H H H H",
  7: "S Ds Ds Ds Ds S S H H H",
  8: "S S S S S S S S S S",
  9: "S S S S S S S S S S"
};
const ORIGINAL_PAIRS: Record<number, string> = {
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
const ORIGINAL_H17_CHANGES: Record<string, string> = {
  "hard:11:11": "Dh",
  "hard:15:11": "Rh",
  "hard:17:11": "Rs",
  "soft:7:2": "Ds",
  "soft:8:6": "Ds",
  "pair:8:11": "Rp"
};
/** The original's raw code (the artifact's rawCode). Hard 8 or less hits, hard 18+ stands (the artifact's own text). */
function originalRaw(cat: Category, row: number, up: Upcard, rules: Rules): string {
  if (cat === "hard" && row < 8) return "H";
  if (cat === "hard" && row > 17) return "S";
  const id = idOf(cat, row, up);
  if (rules.h17 && ORIGINAL_H17_CHANGES[id]) return ORIGINAL_H17_CHANGES[id];
  const table = cat === "hard" ? ORIGINAL_HARD : cat === "soft" ? ORIGINAL_SOFT : ORIGINAL_PAIRS;
  return table[row].split(" ")[UPCARDS.indexOf(up)];
}
/** The original's code specialised to the rules (Ph -> P / H, surrender codes dropped without surrender). */
function originalCode(cat: Category, row: number, up: Upcard, rules: Rules): Code {
  let raw = originalRaw(cat, row, up, rules);
  if (raw === "Ph") raw = rules.das ? "P" : "H";
  if (!rules.surrender && raw[0] === "R") raw = raw === "Rh" ? "H" : raw === "Rs" ? "S" : "P";
  return raw as Code;
}
/** The artifact's own resolveCode (it always allowed doubling the first two cards). */
function originalAction(cat: Category, row: number, up: Upcard, rules: Rules): Action {
  const code = originalRaw(cat, row, up, rules);
  switch (code) {
    case "H": return "hit";
    case "S": return "stand";
    case "Dh":
    case "Ds": return "double";
    case "P": return "split";
    case "Ph": return rules.das ? "split" : "hit";
    case "Rh": return rules.surrender ? "surrender" : "hit";
    case "Rs": return rules.surrender ? "surrender" : "stand";
    case "Rp": return rules.surrender ? "surrender" : "split";
  }
  throw new Error("Unknown code " + code);
}

// --------------------------------------------------------------------------------------------

describe("strategy tables: shape", () => {
  it("give a valid code for every row of every section, every upcard and all 72 rule sets", () => {
    expect(COMBOS).toHaveLength(72);
    for (const rules of COMBOS) {
      for (const cat of CATS) {
        for (const row of rowsOf(cat)) {
          for (const up of UPCARDS) expect(CODES).toContain(strategyCode(cat, row, up, rules));
        }
      }
    }
  });

  it("reject rows and upcards outside the documented ranges", () => {
    const rules = COMBOS[0];
    expect(() => strategyCode("hard", 3, 10, rules)).toThrow(RangeError);
    expect(() => strategyCode("hard", 22, 10, rules)).toThrow(RangeError);
    expect(() => strategyCode("soft", 0, 10, rules)).toThrow(RangeError);
    expect(() => strategyCode("soft", 11, 10, rules)).toThrow(RangeError);
    expect(() => strategyCode("pair", 1, 10, rules)).toThrow(RangeError);
    expect(() => strategyCode("pair", 12, 10, rules)).toThrow(RangeError);
    expect(() => strategyCode("hard", 12.5, 10, rules)).toThrow(RangeError);
    expect(() => strategyCode("hard", 12, 1 as Upcard, rules)).toThrow(RangeError);
  });

  it("describe the chart in a short summary", () => {
    expect(chartSummary({ decks: "4-8", h17: false, das: true, surrender: true, double: "any" })).toBe(
      "4–8 decks · Dealer stands on soft 17 · Double after split · Late surrender · Double any two cards"
    );
    expect(chartSummary({ decks: "1", h17: true, das: false, surrender: false, double: "10-11" })).toBe(
      "1 deck · Dealer hits soft 17 · No double after split · No surrender · Double on hard 10–11 only"
    );
    expect(chartSummary({ decks: "2", h17: false, das: true, surrender: false, double: "9-11" })).toContain("2 decks");
  });
});

describe("strategy tables vs the engine and the original card", () => {
  it("(a) equal derived.json in every derived cell of all 72 rule sets, apart from documented deviations", () => {
    const diffs: string[] = [];
    let compared = 0;
    for (const rules of COMBOS) {
      const key = comboKey(rules);
      for (const cat of CATS) {
        for (const row of ROWS[cat]) {
          for (const up of UPCARDS) {
            const id = idOf(cat, row, up);
            const got = strategyCode(cat, row, up, rules);
            const engine = derivedCode(rules, cat, row, up);
            compared++;
            const dev = findEntry(DEVIATIONS, key, id);
            if (dev) {
              expect(got, `${key} ${id}`).toBe(dev.chosen);
              expect(engine, `${key} ${id}`).toBe(dev.engine);
            } else if (got !== engine) diffs.push(`${key} ${id}: tables ${got}, engine ${engine}`);
          }
        }
      }
    }
    expect(compared).toBe(72 * (15 + 8 + 10) * 10);
    expect(diffs).toEqual([]);
  });

  it("(b) reproduce the original Strategy Drill card for 4-8 decks, double any, every H17 / DAS / surrender setting", () => {
    const diffs: string[] = [];
    let n = 0;
    for (const rules of COMBOS) {
      if (rules.decks !== "4-8" || rules.double !== "any") continue;
      n++;
      for (const cat of CATS) {
        const rows = cat === "soft" ? [2, 3, 4, 5, 6, 7, 8, 9] : rowsOf(cat);
        for (const row of rows) {
          for (const up of UPCARDS) {
            const got = strategyCode(cat, row, up, rules);
            const want = originalCode(cat, row, up, rules);
            if (got !== want) diffs.push(`${comboKey(rules)} ${idOf(cat, row, up)}: ${got} vs original ${want}`);
            // Same play as the artifact for a fresh two-card hand (it always allowed the first-two-card double).
            const action = resolveCode(got, { double: true, surrender: rules.surrender, split: cat === "pair" });
            expect(action, `${comboKey(rules)} ${idOf(cat, row, up)}`).toBe(originalAction(cat, row, up, rules));
          }
        }
      }
    }
    expect(n).toBe(8);
    expect(diffs).toEqual([]);
  });
});

describe("(c) strategy tables obey the basic facts", () => {
  const each = (fn: (rules: Rules, cat: Category, row: number, up: Upcard, code: Code) => void) => {
    for (const rules of COMBOS) for (const cat of CATS) for (const row of rowsOf(cat)) for (const up of UPCARDS) fn(rules, cat, row, up, strategyCode(cat, row, up, rules));
  };
  const at = (rules: Rules, cat: Category, row: number, up: Upcard) => `${comboKey(rules)} ${idOf(cat, row, up)}`;

  it("surrender codes only when surrender is offered, never for soft hands, hard totals below 14 or against 2-8", () => {
    each((rules, cat, row, up, code) => {
      if (code[0] !== "R") return;
      expect(rules.surrender, at(rules, cat, row, up)).toBe(true);
      expect(cat, at(rules, cat, row, up)).not.toBe("soft");
      if (cat === "hard") expect(row, at(rules, cat, row, up)).toBeGreaterThanOrEqual(14);
      expect(up, at(rules, cat, row, up)).toBeGreaterThanOrEqual(9);
    });
  });

  it("split codes only in the pairs section; tens and fives never split; aces and eights always split (or surrender 8s)", () => {
    each((rules, cat, row, up, code) => {
      const where = at(rules, cat, row, up);
      if (code === "P" || code === "Rp") expect(cat, where).toBe("pair");
      if (cat !== "pair") return;
      if (row === 10) expect(code, where).toBe("S");
      if (row === 5) expect(code === "P" || code === "Rp", where).toBe(false);
      if (row === 11) expect(code, where).toBe("P");
      if (row === 8) expect(["P", "Rp"], where).toContain(code);
    });
  });

  it("hard 7 or less hits, hard 17 never hits, hard 18+ and soft 21 stand, soft 19-20 never hit, soft 17 or less never stands", () => {
    each((rules, cat, row, up, code) => {
      const where = at(rules, cat, row, up);
      if (cat === "hard" && row <= 7) expect(code, where).toBe("H");
      if (cat === "hard" && row === 17) expect(["S", "Rs"], where).toContain(code);
      if (cat === "hard" && row >= 18) expect(code, where).toBe("S");
      if (cat === "soft" && row === 10) expect(code, where).toBe("S");
      if (cat === "soft" && (row === 8 || row === 9)) expect(["S", "Ds"], where).toContain(code);
      if (cat === "soft" && row <= 6) expect(["H", "Dh"], where).toContain(code);
    });
  });

  it("doubling codes only where doubling makes sense", () => {
    each((rules, cat, row, up, code) => {
      const where = at(rules, cat, row, up);
      if (code === "Ds") expect(cat, where).toBe("soft");
      if (code === "Dh" && cat === "hard") expect(row >= 8 && row <= 11, where).toBe(true);
      if (code === "Dh" && cat === "pair") expect([4, 5], where).toContain(row);
      if ((code === "Dh" || code === "Ds") && cat === "soft") expect(up, where).toBeLessThanOrEqual(6);
    });
  });

  it("standing is monotone in the hard total: once a total stands against an upcard, every higher total does", () => {
    for (const rules of COMBOS) {
      for (const up of UPCARDS) {
        let stood = false;
        for (let t = 12; t <= 21; t++) {
          const code = strategyCode("hard", t, up, { ...rules, surrender: false });
          if (stood) expect(code, `${comboKey(rules)} hard ${t} v ${up}`).toBe("S");
          if (code === "S") stood = true;
        }
      }
    }
  });

  it("rules only move cells the expected way: surrender only adds R codes, DAS and double-any never remove a split", () => {
    const strip = (c: Code): Code => (c === "Rh" ? "H" : c === "Rs" ? "S" : c === "Rp" ? "P" : c);
    for (const rules of COMBOS) {
      for (const cat of CATS) {
        for (const row of rowsOf(cat)) {
          for (const up of UPCARDS) {
            const where = `${comboKey(rules)} ${idOf(cat, row, up)}`;
            const code = strategyCode(cat, row, up, rules);
            if (rules.surrender) expect(strip(code), where).toBe(strategyCode(cat, row, up, { ...rules, surrender: false }));
            if (code === "P" && !rules.das) expect(strategyCode(cat, row, up, { ...rules, das: true }), where).toBe("P");
            if (code === "P" && rules.double !== "any") expect(strategyCode(cat, row, up, { ...rules, double: "any" }), where).toBe("P");
          }
        }
      }
    }
  });
});

describe("(d) the resolved action is always legal", () => {
  /** Advisor-style lookup: a splittable pair uses the pairs section (falling through to its total), everything else its total. */
  function play(cards: Rank[], up: Upcard, rules: Rules, afterSplit: boolean, hands: number): { action: Action; avail: Availability; code: Code } {
    const hard = cards.reduce((s, r) => s + r, 0);
    const soft = cards.includes(1) && hard + 10 <= 21;
    const pair = cards.length === 2 && cards[0] === cards[1];
    const splittable = pair && (!afterSplit || (cards[0] !== 1 && hands < 4));
    const avail: Availability = {
      double: canDouble(hard, soft, cards.length, rules, afterSplit),
      surrender: canSurrender(cards.length, rules, afterSplit),
      split: splittable
    };
    const lookups: Array<[Category, number]> = [];
    if (splittable) lookups.push(["pair", cards[0] === 1 ? 11 : cards[0]]);
    lookups.push(soft ? ["soft", hard + 10 - 11] : ["hard", hard]);
    for (const [cat, row] of lookups) {
      const code = strategyCode(cat, row, up, rules);
      const action = resolveCode(code, avail);
      if (action) return { action, avail, code };
      expect(cat, `${cards} v ${up}: only a pair code may run out of actions`).toBe("pair");
    }
    throw new Error(`no action for ${cards} v ${up} under ${comboKey(rules)}`);
  }
  const legal = (a: Action, avail: Availability) =>
    (a !== "double" || avail.double) && (a !== "surrender" || avail.surrender) && (a !== "split" || avail.split);

  it("for every two-card hand: first hand, and after a split with 2, 3 or 4 hands in play", () => {
    let n = 0;
    for (const rules of COMBOS) {
      for (const up of UPCARDS) {
        for (let a = 1; a <= 10; a++) {
          for (let b = a; b <= 10; b++) {
            const cards = [a, b] as Rank[];
            if (!(a === 1 && b === 10)) {
              const r = play(cards, up, rules, false, 1);
              expect(legal(r.action, r.avail), `${comboKey(rules)} ${cards} v ${up}: ${r.code} -> ${r.action}`).toBe(true);
              n++;
            }
          }
        }
        // After a split: the first card is the split card (aces excluded: split aces get one card and stand).
        for (let x = 2; x <= 10; x++) {
          for (let r2 = 1; r2 <= 10; r2++) {
            for (const hands of [2, 3, 4]) {
              const r = play([x, r2] as Rank[], up, rules, true, hands);
              expect(legal(r.action, r.avail), `${comboKey(rules)} split ${x},${r2} v ${up} (${hands} hands): ${r.action}`).toBe(true);
              expect(r.action).not.toBe("surrender");
              n++;
            }
          }
        }
      }
    }
    expect(n).toBe(72 * 10 * (54 + 9 * 10 * 3));
  });

  it("for every hand of three or more cards the play is hit or stand", () => {
    for (const rules of COMBOS) {
      for (const up of UPCARDS) {
        const none: Availability = { double: false, surrender: false, split: false };
        for (let t = 5; t <= 21; t++) expect(["hit", "stand"]).toContain(resolveCode(strategyCode("hard", t, up, rules), none));
        for (let s = 2; s <= 10; s++) expect(["hit", "stand"]).toContain(resolveCode(strategyCode("soft", s, up, rules), none));
      }
    }
  });
});

describe("(e) the engine confirms every play", () => {
  const data = new Map<string, UpcardData[]>();
  beforeAll(() => {
    for (const decks of DECK_GROUPS) for (const h17 of [false, true]) data.set(decks + h17, UPCARDS.map((up) => computeUpcard(decks, h17, up)));
  });

  /** Total-dependent EVs for a chart cell, including the off-card rows the derivation doesn't cover. */
  function evs(rules: Rules, cat: Category, row: number, up: Upcard): CellEVs {
    const d = data.get(rules.decks + rules.h17)![UPCARDS.indexOf(up)];
    const only = cat === "hard" && row === 4 ? "2,2" : cat === "hard" && row === 20 ? "10,10" : cat === "soft" && row === 1 ? "1,1" : null;
    if (only) {
      // A single two-card composition, played as a total (not split).
      const h = d.hands.get(only)!;
      return { stand: h.stand / h.noBJ, hit: h.hit / h.noBJ, double: h.double / h.noBJ, split: null, surrender: rules.surrender ? -0.5 : null };
    }
    return cellEVs(d, cat, row, rules);
  }

  /** The chosen play for a fresh two-card hand and its lead over the best other legal play. */
  function lead(rules: Rules, cat: Category, row: number, code: Code, ev: CellEVs) {
    const t = twoCard(cat, row);
    const avail: Availability = { double: canDouble(t.hard, t.soft, 2, rules), surrender: canSurrender(2, rules), split: cat === "pair" };
    const action = resolveCode(code, avail)!;
    const vals: Partial<Record<Action, number>> = { stand: ev.stand, hit: ev.hit };
    if (avail.double) vals.double = ev.double;
    if (avail.split && ev.split !== null) vals.split = ev.split;
    if (avail.surrender) vals.surrender = -0.5;
    const others = (Object.entries(vals) as Array<[Action, number]>).filter(([a]) => a !== action).sort((x, y) => y[1] - x[1]);
    return { action, margin: vals[action]! - others[0][1], runnerUp: others[0][0] };
  }

  const engineRows: Record<Category, number[]> = { hard: [4, ...ROWS.hard, 20], soft: [1, ...ROWS.soft], pair: ROWS.pair };

  it("every resolved first-two-card play is the best legal play under its rules (restricted doubling included)", () => {
    const worse: string[] = [];
    let n = 0;
    for (const rules of COMBOS) {
      const key = comboKey(rules);
      for (const cat of CATS) {
        for (const row of engineRows[cat]) {
          for (const up of UPCARDS) {
            const id = idOf(cat, row, up);
            const r = lead(rules, cat, row, strategyCode(cat, row, up, rules), evs(rules, cat, row, up));
            n++;
            if (r.margin < -1e-12 && !findEntry(DEVIATIONS, key, id)) worse.push(`${key} ${id}: ${r.action} trails ${r.runnerUp} by ${(-r.margin).toFixed(5)}`);
          }
        }
      }
    }
    expect(n).toBe(72 * (17 + 9 + 10) * 10);
    expect(worse).toEqual([]);
  });

  it("the off-card rows (hard 4, hard 20, soft 12) carry the engine's code", () => {
    for (const rules of COMBOS) {
      for (const [cat, row] of [["hard", 4], ["hard", 20], ["soft", 1]] as Array<[Category, number]>) {
        for (const up of UPCARDS) {
          const engine = decideCode(evs(rules, cat, row, up), cat, row, rules).code;
          expect(strategyCode(cat, row, up, rules), `${comboKey(rules)} ${idOf(cat, row, up)}`).toBe(engine);
        }
      }
    }
  });

  it("hands of 21 stand, and hard 18-20 of any size stand", () => {
    const hands: Rank[][] = [[1, 5, 5], [10, 5, 6], [7, 7, 7], [1, 1, 9], [10, 8], [10, 9], [2, 6, 10], [3, 3, 3, 9]];
    for (const decks of DECK_GROUPS) {
      for (const h17 of [false, true]) {
        for (const up of UPCARDS) {
          for (const player of hands) {
            const r = handEVs({ player, up: upToRank(up), rules: { decks, h17, das: true, surrender: true, double: "any" } });
            const best = Math.max(r.hit, r.double ?? -Infinity, r.split ?? -Infinity, r.surrender ?? -Infinity);
            expect(r.stand, `${decks} ${h17 ? "H17" : "S17"} ${player} v ${up}`).toBeGreaterThan(best);
          }
        }
      }
    }
  });

  it("every close-calls.ts entry has the right codes and margin for every rule set it covers", () => {
    for (const [list, deviation] of [[CLOSE_CALLS, false], [DEVIATIONS, true]] as Array<[CloseCall[], boolean]>) {
      for (const e of list) {
        const [cat, rowS, upS] = e.cell.split(":");
        const row = Number(rowS);
        const up = Number(upS) as Upcard;
        const covered = COMBOS.filter((r) => matchesKey(e.keys, comboKey(r)));
        expect(covered.length, `${e.keys} ${e.cell} matches no rule set`).toBeGreaterThan(0);
        expect(e.chosen !== e.engine, `${e.keys} ${e.cell}`).toBe(deviation);
        for (const rules of covered) {
          const where = `${comboKey(rules)} ${e.cell}`;
          const ev = evs(rules, cat as Category, row, up);
          expect(strategyCode(cat as Category, row, up, rules), where).toBe(e.chosen);
          expect(decideCode(ev, cat as Category, row, rules).code, where).toBe(e.engine);
          const r = lead(rules, cat as Category, row, e.chosen, ev);
          expect(r.runnerUp, where).toBe(e.runnerUp);
          expect(Math.abs(r.margin - e.margin), `${where}: margin ${r.margin.toFixed(5)} vs documented ${e.margin}`).toBeLessThan(1.5e-4);
        }
      }
    }
  });
});

describe("(f) spot checks against published charts", () => {
  // [rule-set pattern, cell, code], from cells the published charts agree on (see STRATEGY.md for sources).
  const SPOT: Array<[string, string, Code]> = [
    // 4-8 decks (Wizard of Odds, blackjackinfo, Wikipedia, the original card)
    ["4-8|S17|*|*|*", "hard:11:11", "H"],
    ["4-8|H17|*|*|*", "hard:11:11", "Dh"],
    ["4-8|*|*|LS|*", "hard:16:9", "Rh"],
    ["4-8|S17|*|LS|*", "hard:15:11", "H"],
    ["4-8|H17|*|LS|*", "hard:15:11", "Rh"],
    ["4-8|H17|*|LS|*", "hard:17:11", "Rs"],
    ["4-8|H17|*|LS|*", "pair:8:11", "Rp"],
    ["4-8|*|NDAS|*|*", "pair:6:2", "H"],
    ["4-8|*|DAS|*|*", "pair:4:5", "P"],
    ["4-8|*|*|*|*", "pair:9:7", "S"],
    // 2 decks (Wizard of Odds, blackjackinfo)
    ["2|*|*|*|*", "hard:9:2", "Dh"],
    ["2|S17|*|*|*", "hard:11:11", "Dh"],
    ["2|*|*|LS|*", "hard:16:9", "H"],
    ["2|*|*|LS|*", "hard:15:10", "Rh"],
    ["2|*|DAS|*|*", "pair:6:7", "P"],
    ["2|*|DAS|*|*", "pair:7:8", "P"],
    ["2|*|NDAS|*|*", "pair:6:2", "P"],
    ["2|H17|*|*|*", "soft:3:4", "Dh"],
    ["2|H17|*|*|*", "soft:7:2", "Ds"],
    ["2|*|*|*|*", "pair:7:10", "H"],
    // 1 deck (Wizard of Odds, Hoppe, Nairn, Phrack 1993, Hi-Opt I)
    ["1|*|*|*|*", "hard:8:5", "Dh"],
    ["1|*|*|*|*", "hard:8:6", "Dh"],
    ["1|*|*|*|*", "hard:9:2", "Dh"],
    ["1|*|*|*|*", "hard:11:11", "Dh"],
    ["1|*|*|*|*", "soft:2:4", "Dh"],
    ["1|*|*|*|*", "soft:6:2", "Dh"],
    ["1|S17|*|*|*", "soft:7:11", "S"],
    ["1|H17|*|*|*", "soft:7:11", "H"],
    ["1|H17|*|*|*", "soft:7:2", "S"],
    ["1|*|*|*|*", "soft:8:6", "Ds"],
    ["1|*|*|NS|*", "pair:7:10", "S"],
    ["1|*|*|LS|*", "pair:7:10", "Rs"],
    ["1|H17|*|LS|*", "pair:7:11", "Rh"],
    ["1|*|DAS|*|*", "pair:3:8", "P"],
    ["1|*|NDAS|*|*", "pair:2:3", "P"],
    ["1|*|NDAS|*|*", "pair:4:5", "Dh"],
    ["1|*|*|LS|*", "hard:16:9", "H"],
    ["1|*|*|LS|*", "hard:16:10", "Rh"],
    ["1|H17|*|LS|*", "pair:8:11", "P"],
    // Restricted doubling with DAS (blackjackinfo, 2 and 6/8 decks): splits unchanged
    ["4-8|*|DAS|*|9-11", "pair:4:6", "P"],
    ["4-8|*|DAS|*|10-11", "pair:2:2", "P"],
    ["2|*|DAS|*|10-11", "pair:6:7", "P"]
  ];

  it("match published cells", () => {
    for (const [pattern, cell, code] of SPOT) {
      const [cat, row, up] = cell.split(":");
      const covered = COMBOS.filter((r) => matchesKey(pattern, comboKey(r)));
      expect(covered.length).toBeGreaterThan(0);
      for (const rules of covered) {
        expect(strategyCode(cat as Category, Number(row), Number(up) as Upcard, rules), `${comboKey(rules)} ${cell}`).toBe(code);
      }
    }
  });

  it("4,4 v 6 splits in 1 deck S17 DAS 10-11, where it can't be doubled (falls back to the split, not to hit)", () => {
    const rules: Rules = { decks: "1", h17: false, das: true, surrender: false, double: "10-11" };
    expect(strategyCode("pair", 4, 6, rules)).toBe("P");
    expect(strategyCode("pair", 4, 4, rules)).toBe("H");
    expect(codeChain(strategyCode("pair", 4, 5, rules))).toEqual(["split"]);
  });
});
