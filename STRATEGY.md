# Strategy tables: how they were made and checked

The app's strategy card, drill and hand advisor all read one source: `src/strategy/tables.ts`
(`strategyCode(cat, row, up, rules)` and `chartSummary(rules)`). It covers every rule set the
settings panel can produce, 72 in all: 3 deck groups × dealer H17/S17 × DAS/no DAS × late
surrender/none × three doubling rules.

**Summary.** The tables come from an exact-shoe expected-value engine (`src/engine`). They were
then compared cell by cell with every published chart we could reach: 72 charts from the Wizard of
Odds and blackjackinfo.com, plus several independent references. They agree in every cell except one
cell where the published sources disagree with each other. There, the tables follow the engine.
`tables.ts` makes **no deliberate deviation** from the engine.

## Files

| File | What it is |
|---|---|
| `src/strategy/tables.ts` | The final tables: a base chart per deck group (S17, DAS, late surrender, double any) plus small override maps. |
| `src/strategy/close-calls.ts` | Every disputed or thin cell, with the engine's margin and the sources. Also `DEVIATIONS`, the deliberate departures from the engine, which is empty. |
| `src/strategy/tables.test.ts` | Checks the tables against the engine, the original card, published cells and the rules of the game. |
| `src/strategy/derived.json` | The engine's raw derivation for all 72 rule sets (`npm run derive`). Its `close` list has every cell whose two best *legal* plays are within 0.005, using the same margins as `close-calls.ts`. |
| `src/engine/derive.ts`, `scripts/derive-strategy.ts` | How the derivation is done. |

## Rules assumed

These are fixed; the settings can't change them:

- The dealer peeks for blackjack (US hole-card game). Every play is the best one *given that the dealer
  does not have blackjack*.
- Blackjack pays 3:2.
- Split up to 4 hands. Split aces get one card each and can't be resplit, and a split ace plus a ten
  is 21, not blackjack.
- Double on the first two cards only; no doubling or surrender after hitting.
- Late surrender: first two cards only, after the peek, never after a split.

These rules can be changed in settings:

| Setting | Values |
|---|---|
| Decks | 1, 2, 4–8 (the engine models "4–8" as 6 decks; see below) |
| Dealer soft 17 | stands (S17) / hits (H17) |
| Double after split | yes / no |
| Late surrender | yes / no |
| Doubling | any two cards / hard 9–11 only / hard 10–11 only |

A doubling restriction applies to hard totals; soft hands can't be doubled under it. Doubling after
a split obeys the same restriction.

### Codes

`H` hit, `S` stand, `Dh` double else hit, `Ds` double else stand, `P` split, `Rh` / `Rs` / `Rp`
surrender else hit / stand / split. Surrender codes appear only when surrender is offered.

**Doubling convention.** A first-two-card double keeps its `Dh`/`Ds` code even when the doubling
rule forbids it for that total. The app falls back to the second letter through `canDouble()`, the
same way it does for a three-card hand or a hand after a split without DAS. The engine confirms
that this fallback is the best legal play in every cell of every rule set. A restriction can
change only *split* cells, because doubling after a split is restricted too. It changes exactly one
cell, listed below.

## How the tables were derived

`scripts/derive-strategy.ts` runs the engine for all 72 rule sets in about 6 seconds:

- **Exact shoe.** Cards are drawn without replacement from the exact composition (1, 2 or 6 decks
  minus the upcard and the player's cards). The dealer's hand is played out exactly, H17 or S17.
- **Peek handled exactly.** Every value is conditioned on the dealer not having blackjack,
  including how that conditioning affects the player's own draws. A brute-force test confirms this to 1e-11.
- **Hitting** is solved exactly by composition-dependent recursion. **Doubling** is one card,
  then stand. **Splitting**: up to 4 hands, with one-card split aces. The engine works out the exact
  distribution of resplit outcomes and values every hand with *all* the pair cards in play out of
  the shoe, plus the other hands' second cards. Those second cards are unknown non-pair cards, which
  an exchangeability identity handles exactly. Without resplits the value is exact; with them it
  matches Nairn's exact single-deck splits to about 1e-5 (see [Split accuracy](#split-accuracy)).
- **Total-dependent.** A chart square has one answer for every hand it covers. Hard total *t*
  combines every two-card non-pair hand making *t* (e.g. 10,6 and 9,7 for 16). Each hand is weighted
  by its probability of being dealt, given the upcard and no dealer blackjack. Soft rows are A,x and
  pair rows x,x.
- **Choosing the code.** With surrender offered and −0.5 the best value, the code is `R` plus the
  best other action. Otherwise a pair whose split is best gets `P`. Otherwise a double that beats
  hit/stand gets `Dh`/`Ds`. Otherwise `H`/`S`.
- **Rows the printed card leaves out** are engine-checked for every rule set:
  - hard 4–7 always hit, and hard 18–21 always stand (a 3-card 21 stands by at least 0.48);
  - soft 21 stands;
  - soft 12 (an A,A that can't be split) hits, except double vs 6 in 4–8 decks and vs 5–6 in 1–2
    decks. Wikipedia's footnote row for 4–8 decks matches. Under these rules this row is
    hypothetical: a split ace gets one card and must stand.

### A derivation bug found and fixed

The derivation evaluates a first-two-card double *as if allowed*. For pairs this is wrong when the
pair itself can't be doubled. One case: 1 deck, S17, DAS, double 10–11, 4,4 vs 6. Doubling (as if
allowed) scores +0.19318. The earlier split model put the split at +0.191, below that double, so the
cell came out `Dh`. That falls back to *hit* (+0.17529), but the right play is to split.
`decideCode` in `src/engine/derive.ts` now falls back to the split when a pair can't be doubled.
This changed 2 cells in `derived.json` at the time, and there is a regression test in
`src/engine/derived.test.ts`. With the current split model the split is +0.19413, which is Nairn's
exact value. That beats the as-if double by 0.0010 and hit by 0.0188, so this cell no longer
depends on the fallback. The fallback stays as a guard.

### The split model was improved

The first split model valued every split hand with only the two original pair cards out of the
shoe. Its split values were off, mostly too low, by up to 0.0017 in 6 decks, 0.0043 in 2 decks and
0.0064 in a single deck (the worst case each time is 6,6 vs 5 with DAS). That changed no cell, but
it made several documented margins wrong. For example, 9,9 vs A (1 deck, H17, DAS) showed 0.0002
against the true 0.0022. The current model (see `src/engine/split.ts` and
[Split accuracy](#split-accuracy)) fixes this. Regenerating `derived.json` with it changed **no code
in any rule set**; only the split margins below moved.

## How they were verified

1. **Published charts, cell by cell.** We compared 72 published charts, translated to our code
   convention. Charts that print a forbidden double as H/S were compared after the same fallback.
   - Wizard of Odds, all 24 double-any rule sets (1, 2 and 4+ decks × S17/H17 × DAS × LS).
   - The blackjackinfo.com strategy engine: 48 charts at 2, 6 and 8 decks × S17/H17 × LS/NS, with
     DAS and double any / 9–11 / 10–11, plus no DAS with double any.

   **Result: 1 disagreement in all those cells.** 2 decks, H17, DAS, LS, 8,8 vs A: Wizard of Odds
   says Rp, while blackjackinfo and gsdriver say P. The engine also says P, by 0.0061 (see close calls).

   Further agreement:
   - The original Strategy Drill card, in all 2,640 cells of its 8 rule sets.
   - Hoppe's exact computed tables (1 deck and 6 decks, S17/H17, DAS + LS).
   - Nairn's published 1-deck EVs, for every cell of all 24 one-deck rule sets. Nairn's doubling
     EVs and no-DAS splits apply exactly, and DAS splits use the "10&11" column under 10–11. Under
     9–11, DAS splits fall between Nairn's "Any" and "10&11" columns. Only S17 4,4 vs 4 lies between
     those bounds, and the engine settles it: split +0.1187 against hit +0.0979, so P.
   - Wikipedia's 4–8 deck H17 table.
   - The Phrack 1993 single-deck table.
   - The Hi-Opt I single-deck tables, except 7,7 vs 10. Hi-Opt I has no 7,7 stand exception: its pair
     tables don't split 7,7 vs 10, and its hard 14 row hits against a 10. The app stands (Rs with
     surrender), with the Wizard of Odds, Phrack and Nairn (stand −0.50974 against hit −0.51482).
   - gsdriver/blackjack-strategy dissents once, in a rule set no chart covers: 1 deck S17 DAS
     10–11, 4,4 vs 4, it says split. Its 4,4 split rule checks only `doubleAfterSplit` and ignores the
     10–11 limit on doubling after the split. Nairn's exact values give hit by 0.0005, and the engine
     reproduces both of them to five places (close calls).
2. **4–8 decks modelled as 6.** We re-derived the 4–8 rule sets at 4, 5 and 8 decks. 4 and 5 decks
   match 6 in every cell. 8 decks differs in one cell: 4,4 vs 5 (S17, DAS, double 10–11) hits by
   0.0006, where 6 decks splits by 0.0027. We keep the split, which blackjackinfo's 8-deck chart also shows.
3. **Best legal play everywhere.** Test (e) in `tables.test.ts` checks every rule set and every
   square, including hard 4 / hard 20 / soft 12. For a fresh two-card hand, the play the code
   resolves to is the engine's best *legal* play, so restricted-doubling fallbacks are checked too.
4. **The rest of `tables.test.ts`** checks:
   - the tables equal `derived.json` in all 23,760 derived cells;
   - for 4–8 decks with double-any, the original card is reproduced code for code and action for action;
   - invariants: no surrender codes without surrender; never split tens or fives; always split aces;
     8s always split or surrender; hard ≤ 7 hits; hard ≥ 18 and soft 21 stand; soft 19–20 never hit;
     soft ≤ 17 never stands; standing is monotone in the hard total; DAS and double-any never remove
     a split; surrender only adds R codes (true by construction today, kept as a guard);
   - after a split, for every hand dealt to a pair the chart splits (about 14,000 hands), the chart's
     play is one the engine also allows. It is within 0.04 (1 deck), 0.015 (2 decks) and 0.002
     (4–8 decks) of the engine's best play for those exact cards, with the other split card out;
   - every `close-calls.ts` entry has the right codes and margin, and every cell of every rule set
     with a margin under 0.003 has an entry;
   - spot checks of about 40 published cells.

   Each of four deliberate one-cell mutations to `tables.ts` failed at least three tests.
5. **The engine's own tests** (`src/engine`) compare it with brute-force enumeration and with Monte
   Carlo deals (36 cases at 600k rounds, plus real resplit deals), and check published house edges.
   Split values are checked against 22 cells of Nairn's exact single-deck splitting tables (no
   resplit, and resplit to 3 and 4 hands). For example, 6 decks S17 DAS gives 0.40% and 6 decks H17
   DAS gives 0.62%. Rule effects match published figures: H17 +0.21%, no DAS +0.14%, late surrender
   −0.07%, double 10–11 only +0.19%. Deliberately reintroducing each bug fixed in this round
   (13 mutations to the engine, the derivation and the tables) makes at least one test fail.

### Coverage by rule set

| Rule sets | Published chart for those exact rules |
|---|---|
| All 24 with double any | Wizard of Odds; blackjackinfo for 2 and 4–8 decks |
| 2 and 4–8 decks, DAS, double 9–11 or 10–11 (16) | blackjackinfo |
| 1 deck, double 9–11 or 10–11 (16) | No chart. Checked against Nairn's published 1-deck EVs. Doubling and no-DAS splits apply exactly; DAS splits use the "10&11" column under 10–11 and lie between the "Any" and "10&11" columns under 9–11 |
| 2 / 4–8 decks no-DAS with 9–11 or 10–11 (16) | **None.** Engine only |

The 16 engine-only rule sets equal the published no-DAS double-any charts for the same deck count,
code for code (checked against `derived.json`). Hard and soft rows don't depend on the doubling
rule, since a forbidden double falls back to its second letter. Without DAS, a split's value doesn't
depend on it either.

## Split accuracy

`src/engine/split.ts` values each split hand with every pair card in play out of the shoe. It
evaluates the hands in shoes with 0, 1 and 2 extra pair cards out (beyond the two being split) and
extrapolates deeper levels, which only rare 4-hand deals reach; computing those exactly changes
values by under 3e-6. The other hands' second cards are non-pair cards of unknown rank. Removing *k*
unknown cards at random doesn't change the expected result of a fixed way of playing, so the
hand's value with those cards out follows from the values with extra pair cards out. Hit cards of
the other hands don't matter at all, because a deal's probability depends only on who gets which
cards, not on the order the hands draw in.

Checks:

- **Without resplits** the configuration sum collapses to "two hands with both pair cards out"
  identically (a unit test). That no-resplit value is exact. It equals Nairn's MH=2 column to 2e-5
  in 246 of 480 single-deck cells, and Tom1581's bjcalc for 8,8 vs A in 2 decks.
- **With resplits**, in those 246 cells the engine matches Nairn's MH=3 and MH=4 columns with a mean
  error of 7e-6 (median 4e-7, worst 3.2e-4). The earlier engine model had a mean of 1.9e-3 and a
  worst of 6.3e-3 there. The verifier's independent refined model scored 3.8e-4 mean and 0.0086
  worst against MH=4 on the same cells.
- **In the other 234 cells**, Nairn's values are lower than the engine's by up to 0.009, already
  without resplits. Playing each split hand with the decisions of the *unsplit* hand (the second
  pair card still counted in the shoe) reproduces several of them exactly, e.g. 2,2 vs 6, S17, no
  DAS: 0.118982. A real-deal Monte Carlo of the engine's own play gives 0.1271 ± 0.0006 against the
  engine's 0.1259 (8M rounds, 12 SE above Nairn), so Nairn's values there are for weaker split-hand
  play. The tables use the engine's values. No table cell depends on this: the Nairn-based audit of
  all 24 one-deck rule sets gives the same best play in every cell.
- **Multi-deck:** the engine agrees with the verifier's refined model to a median of 7e-7 in 6
  decks and 4e-5 in 2 decks. A real-deal resplit Monte Carlo (6 decks, 1 deck) agrees within noise.

Remaining approximations: each hand is played knowing the pair cards out, but not the exact ranks
of the other hands' cards, an information effect of order 1e-5. The resplit policy is "always" or
"never", whichever is better.

## Close calls

Margin = the engine's EV for the chosen play minus the best other legal play, in units of the
initial bet. All of these follow the engine. `close-calls.ts` has the full text.

### Sources disagree, or the answer depends on the deck count

| Rules | Cell | Play | Margin | Why |
|---|---|---|---|---|
| 2 decks H17 DAS LS | 8,8 v A | **P** | split +0.0061 over surrender | blackjackinfo and gsdriver say P, Wizard of Odds Rp. Tom1581's bjcalc (no resplit) gives split −0.49952, the engine's no-resplit value exactly; with resplits the split is −0.4939. The Wizard's raw table uses one code for DAS and no DAS. Without DAS, surrender wins (next row), so its Rp probably reflects the no-DAS case. |
| 2 decks H17 no DAS LS | 8,8 v A | Rp | surrender +0.0005 | Effectively a tie: split with resplits −0.50051 vs surrender −0.5 (without resplits −0.50529). All sources agree. |
| 4–8 decks S17 DAS, double 10–11 | 4,4 v 5 | **P** | split +0.0027 (6 decks) | At 8 decks the engine has hit ahead by 0.0006. blackjackinfo's 6- and 8-deck charts split. |
| 1 deck H17 DAS | 9,9 v A | P | split +0.0022 | Split −0.18394 vs stand −0.18613, the same as Nairn's exact values. The Wizard of Odds chart and Hoppe also split; Hoppe notes that the Wizard's hand calculator says stand. |

### Split cells under restricted doubling (no published chart)

| Rules | Cell | Play | Margin | Why |
|---|---|---|---|---|
| 1 deck S17 DAS, double 10–11 | 4,4 v 4 | H | hit +0.0005 over split | The only split cell any restriction changes (P under double-any). Hit +0.09786 vs split +0.09739, exactly Nairn's values. gsdriver says split, but it ignores the 10–11 limit on doubling after the split. |
| 1 deck S17 DAS, double 10–11 | 4,4 v 6 | P | split +0.0188 over hit | The derivation bug above. Split +0.19413, as in Nairn. |

### Thin cells where the published charts agree with the engine

| Rules | Cell | Play | Margin over |
|---|---|---|---|
| 1 deck S17, double any | A,8 v 6 | Ds | stand, 0.0003 |
| 2 decks S17 | A,7 v A | H | stand, 0.0001 |
| 2 decks S17 / H17, double any | A,6 v 2 | H | double, 0.0006 / 0.0002 |
| 2 decks H17, double any | A,3 v 4 | Dh | hit, 0.0005 |
| 2 decks S17, double any | A,3 v 4 | H | double, 0.0013 |
| 2 decks H17, double any | A,7 v 2 | Ds | stand, 0.0006 |
| 4–8 decks S17 | 12 v 4 | S | hit, 0.0027 |
| 4–8 decks S17, double any | A,2 v 5 / A,4 v 4 | Dh | hit, 0.0025 / 0.0030 |
| 1 deck, LS | 15 v 10 | H | surrender, 0.0020 |
| 2 decks, LS | 15 v 10 | Rh | hit, 0.0014 |
| 1 deck H17, LS | 17 v A | Rs | stand, 0.0013 |
| 2 decks S17, no DAS | 6,6 v 2 | P | hit, 0.0035 (0.0013 under the earlier split model) |
| 2 decks, DAS | 7,7 v 8 | P | hit, 0.0025 |

### Soft 12 that can't be split (off the card, hypothetical under these rules)

| Rules | Cell | Play | Margin |
|---|---|---|---|
| 2 decks S17 / H17, double any | A,A v 5 | Dh | double, 0.0014 / 0.0020 |
| 4–8 decks S17, double any | A,A v 6 | Dh | double, 0.0027 (H17: 0.0168; matches Wikipedia's footnote row) |

## Sources consulted

The egress proxy blocked every primary site. Everything cell-level came from copies hosted on
GitHub or npm, gathered by the research pass on 2026-10-05. None of it could be compared against
the live pages.

**Reached (copies):**

- **Wizard of Odds** strategy calculator data, machine-extracted from the page on 2026-09-25:
  github.com/llukehanna/Blackjack-Strategy (`WoOStrategyData.swift`, plus `WoORenderedCharts.swift`,
  which our decoding reproduced with 0 mismatches). It holds raw tables for 1, 2 and 4+ decks × S17/H17.
- **blackjackinfo.com** Basic Strategy Engine (Ken Smith): 48 charts scraped on 2026-09-28, in
  github.com/Tom1581/Blackjack `tool/strategy_check/reference_charts.json`. An independently saved
  6D H17 DAS NS page is in github.com/mcgreentn/Blackjack-Simulator-Scala-.
- **Wikipedia**, "Blackjack", revision 1329937151 (2025-12-28), saved in github.com/ocentra/ocentra-games.
  Used for the 4–8 deck H17 table, the "6 cells that change with S17" text and the soft-12 footnote row.
- **Wizard of Odds** 4–8 deck S17/H17 charts, transcribed in github.com/JackAce/jackace.com.
  The JackAce 1-deck charts agree. Its 2-deck charts are corrupted copy-pastes and were not used.
  `2D_S17.md` repeats the 1-deck S17 cells (Dh for 8 vs 5/6, A,2 and A,3 vs 4, A,6 vs 2; S for A,7 vs
  A). `2D_H17.md` gives the Wizard's *1-deck* page as its source and shows 1-deck cells such as 3,3
  vs 8 Ph, 4,4 vs 4 Ph and 7,7 vs 10 Rs.
- **Hugues Hoppe**, exact probabilistic analysis: github.com/hhoppe/blackjack (`blackjack.py`).
  Computed 1-deck and 6-deck tables, and composition-dependent exceptions.
- **John Nairn**, single-deck EV tables: github.com/nairnj/Blackjack (`webtables/OneDeck.html`),
  including the "EXACT SPLITTING" tables (max hands 2 / 3 / 4, doubling after split No / Any / 10&11).
- **gsdriver/blackjack-strategy** 1.4.0 (npm). Rule logic based on the Wizard of Odds calculator.
- **Tom1581's `bjcalc.py`** (github.com/Tom1581/Blackjack): an independent single-split calculator,
  used for 8,8 vs A in 2 decks H17.
- github.com/0xRowdy/true-count-claude `strategy.reference.ts`: a hand transcription of Wizard of Odds and blackjackinfo.
- *Phrack* 43 file 9 (1993), "Las Vegas Single Deck Basic Strategy Table".
- The "Hi-Opt I" single-deck article (textfiles.com mirror).
- panopset `basic.txt`. Too loosely annotated to use.

**Blocked:** wizardofodds.com (strategy pages and calculator), blackjackinfo.com, en.wikipedia.org,
web.archive.org, blackjackapprenticeship.com, hitorstand.net, bjstrat.net, wizardofvegas.com,
qfit.com, bj21.com, lasvegasadvisor.com (the *Blackjack Attack* sample and the Q&A pages),
casinocitytimes.com, beatblackjack.org, casino.org, lolblackjack.com, blackjackreview.com,
888casino.com, lifesagambol.com, covers.com, dyutam.com, blackjack-strategy.co,
americancasinoguidebook.com, freeblackjack.games, blackjackclassroom.com, pokerlistings.com,
reddit.com, math.stackexchange.com, scribd.com, books.google.com.

## Known limitations

- **Total-dependent strategy.** One answer per chart square. Some exact hands play differently. In
  6 decks, 10,6 and 9,7 vs 10 hit, but a three-card 16 such as 10,4,2 should stand. Other examples
  from Hoppe (H17, DAS, LS): in 1–2 decks, 10,2 vs 4 hits; in 2 decks, 7,8 vs 10 or A hits rather
  than surrenders.
- **Late surrender by composition.** With surrender, some exact two-card hands differ from their
  total's square (engine values; gsdriver 1.4.0 "advanced" and Phrack's single-deck note as noted):
  - 15 vs 10: 8,7 hits while 9,6 and 10,5 surrender, at every deck count; in 4–8 decks 8,7 hits by
    only 0.0002. The square says `Rh` from 2 decks up, so 8,7 is the exception there (gsdriver
    agrees). In 1 deck the square says `H` (by 0.0020), so 9,6 (+0.0098) and 10,5 (+0.0011) are
    the exceptions. Phrack's single-deck note also surrenders 10,5 vs 10; gsdriver hits all three.
  - 16 vs A, 1 deck S17: 9,7 hits while 10,6 surrenders (gsdriver agrees, and Phrack's single-deck
    note doesn't surrender 9,7 vs A).
  - 15 vs A, 1–2 decks H17: 8,7 hits while 9,6 and 10,5 surrender (gsdriver agrees).

  The hand advisor's exact-odds panel shows these differences for the cards entered.
- **Hands of three or more cards** use the chart by total. They can't double or surrender, so the
  code falls back to its second letter. The chart doesn't re-optimise for card removal.
- **After a split** the same chart applies, with doubling allowed only per DAS and the restriction.
  The code set can't express "split, else double". Without DAS, the 1-deck 4,4 vs 5/6 cell shows
  `Dh`, so a 4,4 dealt after a split hits even where resplitting might be slightly better. The other
  split card is out of the shoe too, so in 1–2 decks a few exact hands play differently from the
  chart. The worst case: in 1 deck H17, after splitting 8s, 8,4 vs 3 should stand (by 0.036); the
  chart hits. In 4–8 decks the chart is within 0.0003 of the best play for every such hand.
  The engine's after-split odds (`handEVs` with `afterSplit`) take the other hands' split cards out
  of the shoe itself, one per other hand; `seen` must not repeat them.
- **"4–8 decks" is computed at 6 decks.** 4 and 5 decks give identical tables. 8 decks differs in
  the one thin cell noted above.
- **The split model** is exact without resplits and within about 1e-5 of Nairn's exact values with
  them (see [Split accuracy](#split-accuracy)). The thinnest split cell left is 8,8 vs A in 2 decks
  H17 no DAS LS, surrender by 0.0005, which every source agrees on.
- **No published chart or table exists for 16 of the 72 rule sets** (see coverage). The engine
  decides those, and they equal published no-DAS double-any charts code for code.
- **Not modelled:** European no-hole-card play, original-bets-only, 6:5 blackjack, resplitting
  aces, hitting split aces, early surrender, surrender after splitting, doubling on three or more cards.
- **Soft 12 (row 1)** is only for an A,A that can't be split. Under these rules a split ace must
  stand, so callers must not use this row (or any soft row) for a hand that came from splitting aces.

## Updating the tables

1. Change the engine, then run `npm run derive` to regenerate `src/strategy/derived.json`.
2. Run `npx vitest run src/strategy src/engine`. Test (a) lists every cell where `tables.ts` and the
   new derivation differ.
3. For each difference, either update `tables.ts`, or keep the old code and add an entry to
   `DEVIATIONS` in `close-calls.ts` with the margin and the published source. Test (e) then
   accepts it, and the entry documents why.
