import { describe, expect, it } from "vitest";
import { advise, describeHand, handValue } from "../strategy/advisor";
import type { Rules } from "../strategy/types";
import { DEFAULT_RULES } from "../strategy/types";

const R = (patch: Partial<Rules> = {}): Rules => ({ ...DEFAULT_RULES, ...patch });

describe("handValue", () => {
  it("counts one ace as 11 when it fits", () => {
    expect(handValue([1, 6])).toMatchObject({ hard: 7, total: 17, soft: true, pair: false });
    expect(handValue([1, 1])).toMatchObject({ hard: 2, total: 12, soft: true, pair: true });
    expect(handValue([1, 5, 10])).toMatchObject({ hard: 16, total: 16, soft: false });
    expect(handValue([1, 1, 9])).toMatchObject({ hard: 11, total: 21, soft: true });
    expect(handValue([10, 6])).toMatchObject({ total: 16, soft: false, pair: false });
  });
});

describe("advise", () => {
  it("asks for missing cards", () => {
    expect(advise([10, 6], null, R()).kind).toBe("need-upcard");
    expect(advise([10], 10, R())).toEqual({ kind: "need-cards", have: 1 });
  });

  it("spots blackjack, 21 and busts", () => {
    expect(advise([1, 10], 6, R()).kind).toBe("blackjack");
    expect(advise([1, 10], 6, R(), { afterSplit: true }).kind).toBe("twenty-one");
    expect(advise([7, 4, 10], 6, R()).kind).toBe("twenty-one");
    expect(advise([10, 6, 9], 6, R()).kind).toBe("bust");
  });

  it("looks pairs up in the pairs section", () => {
    const a = advise([8, 8], 10, R());
    expect(a.kind === "play" && a.action).toBe("split");
    expect(a.kind === "play" && a.cellId).toBe("pair:8:10");
  });

  it("plays a pair by its total when it can't be split", () => {
    const capped = advise([8, 8], 10, R(), { afterSplit: true, hands: 4 });
    expect(capped.kind === "play" && capped.cellId).toBe("hard:16:10");
    // No surrender after a split, so the hard 16 square's surrender falls back to hit.
    expect(capped.kind === "play" && capped.action).toBe("hit");
    expect(capped.kind === "play" && capped.notes.join(" ")).toMatch(/4-hand limit/);

    const aces = advise([1, 1], 6, R(), { afterSplit: true });
    expect(aces.kind === "play" && aces.cellId).toBe("soft:1:6");
    expect(aces.kind === "play" && aces.notes.join(" ")).toMatch(/can’t be resplit/);
  });

  it("only doubles and surrenders on the first two cards", () => {
    const threeCard11 = advise([2, 3, 6], 6, R());
    expect(threeCard11.kind === "play" && threeCard11.action).toBe("hit");
    expect(threeCard11.kind === "play" && threeCard11.notes[0]).toMatch(/first two cards/);

    const threeCard16 = advise([4, 2, 10], 10, R());
    expect(threeCard16.kind === "play" && threeCard16.action).toBe("hit");
    expect(threeCard16.kind === "play" && threeCard16.notes[0]).toMatch(/surrender your first two cards/);
  });

  it("follows the doubling restriction", () => {
    const softAny = advise([1, 7], 4, R());
    expect(softAny.kind === "play" && softAny.action).toBe("double");
    const soft1011 = advise([1, 7], 4, R({ double: "10-11" }));
    expect(soft1011.kind === "play" && soft1011.action).toBe("stand");
    expect(soft1011.kind === "play" && soft1011.notes[0]).toMatch(/hard 10 and 11/);
    const nine = advise([5, 4], 4, R({ double: "10-11" }));
    expect(nine.kind === "play" && nine.action).toBe("hit");
    const nine911 = advise([5, 4], 4, R({ double: "9-11" }));
    expect(nine911.kind === "play" && nine911.action).toBe("double");
  });

  it("only doubles after a split when DAS is allowed", () => {
    expect((advise([7, 4], 6, R(), { afterSplit: true }) as { action: string }).action).toBe("double");
    const noDas = advise([7, 4], 6, R({ das: false }), { afterSplit: true });
    expect(noDas.kind === "play" && noDas.action).toBe("hit");
    expect(noDas.kind === "play" && noDas.notes[0]).toMatch(/after a split/);
  });

  it("drops surrender when it isn't offered", () => {
    expect((advise([10, 6], 10, R()) as { action: string }).action).toBe("surrender");
    expect((advise([10, 6], 10, R({ surrender: false })) as { action: string }).action).toBe("hit");
  });

  it("flags squares that aren't on the printed card", () => {
    const low = advise([2, 3], 6, R());
    expect(low.kind === "play" && low.offChart).toBe(true);
    expect(low.kind === "play" && low.action).toBe("hit");
    const high = advise([10, 9], 10, R());
    expect(high.kind === "play" && high.action).toBe("stand");
  });

  it("gives an answer for every reachable hand under every rule set", () => {
    const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
    for (const decks of ["1", "2", "4-8"] as const)
      for (const h17 of [false, true])
        for (const das of [false, true])
          for (const surrender of [false, true])
            for (const double of ["any", "9-11", "10-11"] as const) {
              const rules: Rules = { decks, h17, das, surrender, double };
              for (const up of ranks)
                for (const a of ranks)
                  for (const b of ranks)
                    for (const afterSplit of [false, true]) {
                      const adv = advise([a, b], up, rules, { afterSplit });
                      if (adv.kind !== "play") continue;
                      if (adv.action === "double") expect(adv.avail.double).toBe(true);
                      if (adv.action === "surrender") expect(adv.avail.surrender).toBe(true);
                      if (adv.action === "split") expect(adv.avail.split).toBe(true);
                    }
            }
  });
});

describe("describeHand", () => {
  it("names hands", () => {
    expect(describeHand([1, 7])).toBe("Soft 18");
    expect(describeHand([10, 6])).toBe("Hard 16");
    expect(describeHand([8, 8])).toBe("Pair of 8s");
    expect(describeHand([1, 1])).toBe("Pair of aces");
    expect(describeHand([1, 10])).toBe("Blackjack");
    expect(describeHand([1, 10], true)).toBe("Soft 21");
    expect(describeHand([10, 6, 8])).toBe("Bust · 24");
  });
});
