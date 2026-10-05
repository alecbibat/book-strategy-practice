# Strategy Drill

A blackjack basic-strategy trainer for your phone, built from the *Blackjack Strategy Drill* artifact.

- **Drill**: you get a two-card hand against a dealer upcard and choose hit, stand, double, split or surrender. Each answer comes with the rule behind it. Hands you miss come back more often until you get them right twice in a row, and the Misses filter drills only those.
- **Strategy card**: the **Strategy card** button (or the <kbd>C</kbd> key) opens the full chart for your table's rules. Tap a square to see why that play is right, open it in the advisor, or drill it. *My results* colours the card by how well you know each square. The print button prints only the card.
- **Table rules**: decks (1, 2 or 4–8), whether the dealer hits soft 17, double after split, late surrender, and which totals you can double (any two cards, 9–11, or 10–11). Change them from the rules button in the header or inside the strategy card. The card, the drill answers and the advisor all update right away.
- **Hand advisor**: tap in the dealer's upcard and your cards, as many as you hold, and you get the basic-strategy play with the reason. You can mark the hand as coming from a split, and you can add other cards you've seen on the table. The advisor also works out the **exact odds** of every option for those cards. When the exact cards favour a different play than the card's total-based rule, it shows you how big the difference is.

Progress and settings are saved in the browser. Once you've visited the site, it also works offline.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (strategy tables, engine, advisor, explanations)
npm run typecheck
npm run build        # static site in dist/ (relative paths, works from any folder)
npm run build:single # everything inlined into dist-single/index.html
npm start            # serve dist/ with the production server (PORT, default 3000)
```

### Deploy to Heroku

The repo is ready for Heroku's Node.js buildpack. You don't need any config vars.

- **From GitHub**: in the Heroku dashboard, create an app, then go to **Deploy → GitHub**, connect this repository, and turn on **Automatic deploys** for `main`. Tick **Wait for CI to pass before deploy** so `ci.yml` (typecheck, tests, build) has to pass before Heroku deploys.
- **From the CLI**: `heroku create`, then `git push heroku main`.

On deploy, Heroku runs `npm install` and then `heroku-postbuild` (`vite build`). It then starts `web: node server.mjs` (see `Procfile`). `server.mjs` is a small server with no dependencies. It serves `dist/` on `$PORT` and:

- caches hashed assets for a year and revalidates the page, the manifest and the service worker;
- compresses text with brotli or gzip, and answers conditional requests with 304;
- sends a strict Content-Security-Policy and other security headers;
- redirects plain-HTTP visitors to HTTPS (using Heroku's `X-Forwarded-Proto` header), which offline support needs.

To try the production server locally, run `npm run build && npm start` and open http://localhost:3000.

## How the strategy is checked

The strategy tables in `src/strategy/tables.ts` cover all 72 combinations of the rule settings. They are checked by a blackjack expected-value engine (`src/engine/`) that recomputes basic strategy from scratch, and against published charts. See [STRATEGY.md](STRATEGY.md) for the assumptions, the sources, and every close call.

Always assumed: the dealer checks for blackjack (US hole-card rules), blackjack pays 3 to 2, you can split up to four hands, and split aces get one card each.

## Layout

```
index.html            page shell: drill, advisor, strategy-card and rules sheets
src/main.ts           wiring: tabs, sheets, keyboard, theme, offline support
src/ui/               drill, advisor, strategy card, rules form, saved state, cards
src/strategy/         rules types, chart tables, resolution, explanations, advisor logic
src/engine/           exact-odds engine (runs in a Web Worker in the app)
scripts/              derive-strategy.ts: recompute every chart from the engine
public/               icons, web manifest, service worker
server.mjs            production server (Heroku: Procfile → web: node server.mjs)
```
