// Monte Carlo cross-check: physically deal from a shuffled finite shoe (seeded RNG), in the real
// order (hole card first, then the player's card, then the dealer's draws), discard rounds where the
// dealer has blackjack (the peek), and compare the average results with the engine.
import { describe, expect, it } from "vitest";
import type { Rank, Rules } from "../strategy/types";
import { handEVs } from "./index";

/** mulberry32: small, fast, well-distributed 32-bit PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dealerFinal(up: number, hole: number, next: () => number, h17: boolean): number {
  let hard = up + hole;
  let ace = up === 1 || hole === 1;
  for (;;) {
    const soft = ace && hard + 10 <= 21;
    const total = soft ? hard + 10 : hard;
    if (hard > 21) return 22;
    if (total > 17 || (total === 17 && !(soft && h17))) return total;
    const r = next();
    hard += r;
    if (r === 1) ace = true;
  }
}

const result = (p: number, d: number) => (p > 21 ? -1 : d > 21 ? 1 : p > d ? 1 : p < d ? -1 : 0);
const totalOf = (cards: number[]) => {
  const hard = cards.reduce((a, b) => a + b, 0);
  return cards.includes(1) && hard + 10 <= 21 ? hard + 10 : hard;
};

interface Stat { n: number; sum: number; sq: number }
const stat = (): Stat => ({ n: 0, sum: 0, sq: 0 });
const add = (s: Stat, x: number) => { s.n++; s.sum += x; s.sq += x * x; };
const mean = (s: Stat) => s.sum / s.n;
const se = (s: Stat) => Math.sqrt((s.sq / s.n - mean(s) ** 2) / s.n);

function simulate(decks: number, player: Rank[], up: Rank, h17: boolean, rounds: number, seed: number) {
  const deck: number[] = [];
  for (let r = 1; r <= 10; r++) for (let i = 0; i < (r === 10 ? 16 : 4) * decks; i++) deck.push(r);
  for (const c of [...player, up]) deck.splice(deck.indexOf(c), 1);
  const rand = rng(seed);
  const m = deck.length;
  let pos = 0;
  // Lazy Fisher-Yates: each round draws a fresh uniformly random sequence without replacement.
  const draw = () => {
    const j = pos + Math.floor(rand() * (m - pos));
    const t = deck[pos]; deck[pos] = deck[j]; deck[j] = t;
    return deck[pos++];
  };
  const stand = stat(), dbl = stat(), splitAces = stat();
  const pTotal = totalOf(player);
  const isAces = player[0] === 1 && player[1] === 1;
  for (let i = 0; i < rounds; i++) {
    pos = 0;
    const hole = draw();
    if ((up === 1 && hole === 10) || (up === 10 && hole === 1)) continue; // dealer blackjack: peeked
    const seq: number[] = [];
    const at = (k: number) => { while (seq.length <= k) seq.push(draw()); return seq[k]; };
    // Stand: the dealer draws seq[0], seq[1], ...
    let k = 0;
    add(stand, result(pTotal, dealerFinal(up, hole, () => at(k++), h17)));
    // Double: the player takes seq[0], the dealer draws seq[1], ...
    const pd = totalOf([...player, at(0)]);
    k = 1;
    add(dbl, 2 * result(pd, dealerFinal(up, hole, () => at(k++), h17)));
    if (isAces) {
      // Split aces: one card each (seq[0], seq[1]), then the dealer draws seq[2], ...
      const a = totalOf([1, at(0)]), b = totalOf([1, at(1)]);
      k = 2;
      const d = dealerFinal(up, hole, () => at(k++), h17);
      add(splitAces, result(a, d) + result(b, d));
    }
  }
  return { stand, dbl, splitAces };
}

const rulesFor = (decks: number, h17: boolean): Rules => ({
  decks: decks === 1 ? "1" : decks === 2 ? "2" : "4-8", h17, das: true, surrender: false, double: "any"
});

const Z = 3.5; // tolerance in standard errors (fixed seeds, so the test is deterministic)

describe("Monte Carlo (shuffled finite shoe) vs engine", () => {
  const cases: Array<[Rank[], Rank, boolean]> = [
    [[10, 6], 10, false],
    [[9, 7], 10, true],
    [[5, 6], 1, false],
    [[10, 7], 1, true],
    [[1, 7], 9, false],
    [[10, 2], 4, true],
    [[1, 6], 4, false],
    [[6, 4], 10, false],
    [[8, 3], 6, true]
  ];
  for (const decks of [1, 6]) {
    it(`${decks} deck(s): stand and double EVs agree within ${Z} sigma`, () => {
      const rounds = 600_000;
      cases.forEach(([player, up, h17], i) => {
        const mc = simulate(decks, player, up, h17, rounds, 1000 * decks + i);
        const ev = handEVs({ player, up, rules: rulesFor(decks, h17) });
        const zs = Math.abs(mean(mc.stand) - ev.stand) / se(mc.stand);
        const zd = Math.abs(mean(mc.dbl) - (ev.double as number)) / se(mc.dbl);
        expect(zs, `${decks}D ${player} vs ${up} stand: mc ${mean(mc.stand)} engine ${ev.stand}`).toBeLessThan(Z);
        expect(zd, `${decks}D ${player} vs ${up} double: mc ${mean(mc.dbl)} engine ${ev.double}`).toBeLessThan(Z);
      });
    });
  }

  it("hard 16 vs 10: the hit EV (every card ends the hand) matches 'one card then stand' in 1 and 6 decks", () => {
    for (const decks of [1, 6]) {
      for (const player of [[10, 6], [9, 7]] as Rank[][]) {
        const mc = simulate(decks, player, 10, false, 2_000_000, 77 + decks + player[0]);
        const ev = handEVs({ player, up: 10, rules: rulesFor(decks, false) });
        // Hitting hard 16 always ends on 17+ or bust, so hit = half the double result.
        const hitMean = mean(mc.dbl) / 2, hitSe = se(mc.dbl) / 2;
        expect(Math.abs(hitMean - ev.hit) / hitSe, `${decks}D ${player} hit`).toBeLessThan(Z);
        expect(Math.abs(mean(mc.stand) - ev.stand) / se(mc.stand), `${decks}D ${player} stand`).toBeLessThan(Z);
      }
    }
  });

  it("split aces: the independent-hands approximation is within a few thousandths of a real deal", () => {
    // The engine treats the two ace hands as drawing independently (each from the shoe with only
    // both aces removed); the simulation deals them for real. Allow statistical noise + 0.004.
    for (const decks of [1, 6]) {
      for (const up of [6, 10] as Rank[]) {
        const mc = simulate(decks, [1, 1], up, false, 1_000_000, 500 + decks * 11 + up);
        const ev = handEVs({ player: [1, 1], up, rules: rulesFor(decks, false) });
        const diff = Math.abs(mean(mc.splitAces) - (ev.split as number));
        expect(diff, `${decks}D A,A vs ${up}: mc ${mean(mc.splitAces)} engine ${ev.split}`).toBeLessThan(Z * se(mc.splitAces) + 0.004);
      }
    }
  });
});
