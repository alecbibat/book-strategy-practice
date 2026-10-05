// Derive total-dependent basic strategy for all 72 rule combinations from the EV engine and write
// src/strategy/derived.json. Run with `npx tsx scripts/derive-strategy.ts` (or `npm run derive`).
//
// Also compares the "4-8" / double-any combos with the original Strategy Drill chart
// (src/engine/reference-chart.ts) and prints every mismatch with its EVs and margin.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Action, Category, Code, Upcard } from "../src/strategy/types";
import { DECK_GROUPS } from "../src/strategy/types";
import { codeChain } from "../src/strategy/resolve";
import { deriveDecksH17, legalRanking, type CellReport, type DerivedCombo } from "../src/engine/derive";
import { referenceCode } from "../src/engine/reference-chart";

const CLOSE = 0.005;
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

const t0 = performance.now();
const combos: Record<string, DerivedCombo> = {};
const close: Array<{ key: string; cell: string; code: string; best: Action; second: Action; margin: number }> = [];
const anomalies: string[] = [];
const reports: CellReport[] = [];

for (const decks of DECK_GROUPS) {
  for (const h17 of [false, true]) {
    const t = performance.now();
    Object.assign(
      combos,
      deriveDecksH17(decks, h17, (r) => {
        // Legal margins: a first-two-card double the rules forbid is not a candidate.
        const [[best, bv], [second, sv]] = legalRanking(r.ev, r.cat, r.row, r.rules);
        if (bv - sv < CLOSE) close.push({ key: r.key, cell: r.cell, code: r.decision.code, best, second, margin: r5(bv - sv) });
        if (r.decision.anomaly) anomalies.push(`${r.key} ${r.cell} ${r.decision.code}: ${r.decision.anomaly}`);
        if (decks === "4-8" && r.rules.double === "any") reports.push(r);
      })
    );
    console.log(`derived ${decks} decks ${h17 ? "H17" : "S17"} in ${((performance.now() - t) / 1000).toFixed(2)} s`);
  }
}

const out = {
  meta: {
    generatedBy: "scripts/derive-strategy.ts (EV engine in src/engine)",
    assumptions: [
      "Total-dependent basic strategy: each hard total combines every 2-card non-pair composition (ten-values as one rank) weighted by its probability of being dealt given the upcard and no dealer blackjack.",
      "Decks: '1' = 1, '2' = 2, '4-8' modelled as 6 decks. Cards drawn without replacement from the exact composition.",
      "Dealer peeks: all EVs are conditional on no dealer blackjack (exact, including the effect on the player's draws). Blackjack pays 3:2.",
      "Hitting: exact composition-dependent recursion; doubling: one card then stand.",
      "Splitting: up to 4 hands, split aces one card each and no resplit, split ace + ten = 21. Exact distribution of resplit configurations; every hand valued with all pair cards in play and the other hands' second cards out of the shoe (exchangeability; matches Nairn's exact single-deck splits to ~1e-5). Resplit always or never, whichever is better.",
      "Doubling the first two cards is evaluated as if allowed even under a 9-11 / 10-11 restriction (Dh/Ds then fall back to the second letter); doubling after a split obeys the restriction.",
      "Surrender: late, first two cards only, never after a split. Rx = surrender, else x.",
      "close: cells whose two best LEGAL actions for a fresh two-card hand are within 0.005 of a unit (margin in units of the initial bet). A first-two-card double the rule set forbids is not counted, so this matches the margins in src/strategy/close-calls.ts."
    ]
  },
  combos,
  close
};

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, "../src/strategy/derived.json");
const json = JSON.stringify(out);
writeFileSync(file, json + "\n");
console.log(`wrote ${file} (${(json.length / 1024).toFixed(1)} KB, ${Object.keys(combos).length} combos, ${close.length} close cells)`);

// ---------- comparison with the original artifact's 4-8 deck chart ----------
function chainValue(r: CellReport, a: Action): number {
  const v = r.ev[a];
  return v === null ? NaN : v;
}
const fmt = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(4);
let mismatches = 0;
for (const r of reports) {
  const [cat, rowS, upS] = r.cell.split(":");
  const ref = referenceCode(cat as Category, +rowS, +upS as Upcard, r.rules);
  const got = r.decision.code;
  if (ref === got) continue;
  mismatches++;
  // Margin: EV difference at the first point where the two codes' action chains differ.
  const cg = codeChain(got as Code), cr = codeChain(ref);
  let i = 0;
  while (i < Math.min(cg.length, cr.length) && cg[i] === cr[i]) i++;
  const ag = cg[Math.min(i, cg.length - 1)], ar = cr[Math.min(i, cr.length - 1)];
  const margin = chainValue(r, ag) - chainValue(r, ar);
  const evs = r.decision.ranking.map(([a, v]) => `${a} ${fmt(v)}`).join(", ");
  console.log(`MISMATCH ${r.key} ${r.cell}: derived ${got} vs chart ${ref}; ${ag} beats ${ar} by ${margin.toFixed(5)}  [${evs}]`);
}
console.log(`${mismatches} mismatches against the original 4-8 deck chart (${reports.length} cells compared)`);
if (anomalies.length) {
  console.log(`${anomalies.length} anomalies:`);
  anomalies.forEach((a) => console.log("  " + a));
} else console.log("0 anomalies");
console.log(`total runtime ${((performance.now() - t0) / 1000).toFixed(2)} s`);
