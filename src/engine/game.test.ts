// Full-game sanity check: the expected return of a whole round, summed over every upcard and every
// initial two-card hand (naturals paying 3:2, dealer blackjack before the player acts, and optimal
// play using the engine's EVs), compared with well-known house edges.
//
// Reference values (total-dependent basic strategy; the engine plays composition-dependent, which
// is worth a few hundredths of a percent more in 1-2 decks and almost nothing in 6):
//   6 decks S17 DAS, no surrender: ~0.40-0.43%      6 decks H17 DAS: ~0.62%
//   1 deck S17 no DAS: ~0.00%                        2 decks S17 DAS: ~0.19%
//   Rule effects (Wizard of Odds rule-variation table, as quoted by e.g. lasvegasadvisor.com):
//   H17 +0.22%, no DAS +0.14%, late surrender -0.08% (multi-deck), double 10-11 only ~+0.18%,
//   double 9-11 only ~+0.09%.
// Engine results at the time of writing: 0.4035%, 0.6160%, -0.0409%, 0.1800%;
// effects H17 +0.2125, no DAS +0.1413, LS -0.0726, 10-11 +0.1919, 9-11 +0.0960.
// The lower bounds below sit a little under the TD figures because composition-dependent play is
// slightly better than total-dependent basic strategy.
import { describe, expect, it } from "vitest";
import type { Rank, Rules } from "../strategy/types";
import { engineDecks } from "../strategy/types";
import { clearEngineCache, freshShoe, handEVs } from "./index";

function houseEdge(rules: Rules): number {
  clearEngineCache();
  const c = Array.from(freshShoe(engineDecks(rules.decks)));
  const n = c.reduce((a, b) => a + b, 0);
  let total = 0;
  for (let u = 1; u <= 10; u++) {
    const pu = c[u - 1] / n;
    c[u - 1]--;
    const best = new Map<string, number>();
    for (let a = 1; a <= 10; a++) {
      const pa = c[a - 1] / (n - 1);
      c[a - 1]--;
      for (let b = 1; b <= 10; b++) {
        const pb = c[b - 1] / (n - 2);
        if (pb === 0) continue;
        c[b - 1]--;
        const left = n - 3;
        const pBJ = u === 1 ? c[9] / left : u === 10 ? c[0] / left : 0;
        const natural = a + b === 11 && (a === 1 || b === 1);
        let ev: number;
        if (natural) ev = (1 - pBJ) * 1.5; // dealer blackjack pushes a natural
        else {
          const k = Math.min(a, b) + "," + Math.max(a, b);
          let v = best.get(k);
          if (v === undefined) {
            const r = handEVs({ player: [a, b] as Rank[], up: u as Rank, rules });
            v = Math.max(...[r.stand, r.hit, r.double, r.split, r.surrender].filter((x): x is number => x !== null));
            expect(r[r.best]).toBe(v);
            best.set(k, v);
          }
          ev = -pBJ + (1 - pBJ) * v;
        }
        total += pu * pa * pb * ev;
        c[b - 1]++;
      }
      c[a - 1]++;
    }
    c[u - 1]++;
  }
  return -100 * total; // house edge in percent
}

const R = (decks: Rules["decks"], h17: boolean, das: boolean, surrender = false, double: Rules["double"] = "any"): Rules =>
  ({ decks, h17, das, surrender, double });

describe("house edge of a full round", () => {
  const he: Record<string, number> = {};
  const get = (name: string, rules: Rules) => (he[name] ??= houseEdge(rules));

  it("6 decks S17 DAS no surrender ~ 0.40-0.45%", () => {
    const x = get("6s", R("4-8", false, true));
    expect(x).toBeGreaterThan(0.38);
    expect(x).toBeLessThan(0.45);
  });
  it("6 decks H17 DAS ~ 0.60-0.67%", () => {
    const x = get("6h", R("4-8", true, true));
    expect(x).toBeGreaterThan(0.58);
    expect(x).toBeLessThan(0.67);
  });
  it("1 deck S17 no DAS ~ 0.00% (-0.05..+0.05)", () => {
    const x = get("1s", R("1", false, false));
    expect(x).toBeGreaterThan(-0.07);
    expect(x).toBeLessThan(0.05);
  });
  it("2 decks S17 DAS ~ 0.15-0.25%", () => {
    const x = get("2s", R("2", false, true));
    expect(x).toBeGreaterThan(0.15);
    expect(x).toBeLessThan(0.25);
  });
  it("rule effects in 6 decks have the published sizes", () => {
    const base = get("6s", R("4-8", false, true));
    expect(get("6h", R("4-8", true, true)) - base).toBeGreaterThan(0.18); // H17 ~ +0.22
    expect(get("6h", R("4-8", true, true)) - base).toBeLessThan(0.25);
    const ndas = get("6s-ndas", R("4-8", false, false)) - base; // no DAS ~ +0.14
    expect(ndas).toBeGreaterThan(0.11);
    expect(ndas).toBeLessThan(0.17);
    const ls = base - get("6s-ls", R("4-8", false, true, true)); // late surrender ~ -0.08
    expect(ls).toBeGreaterThan(0.05);
    expect(ls).toBeLessThan(0.10);
    const d1011 = get("6s-1011", R("4-8", false, true, false, "10-11")) - base; // ~ +0.18
    expect(d1011).toBeGreaterThan(0.14);
    expect(d1011).toBeLessThan(0.24);
    const d911 = get("6s-911", R("4-8", false, true, false, "9-11")) - base; // ~ +0.09..0.12
    expect(d911).toBeGreaterThan(0.05);
    expect(d911).toBeLessThan(d1011);
  });
  it("fewer decks are better for the player", () => {
    expect(get("1s-das", R("1", false, true))).toBeLessThan(get("2s", R("2", false, true)));
    expect(get("2s", R("2", false, true))).toBeLessThan(get("6s", R("4-8", false, true)));
  });
});
