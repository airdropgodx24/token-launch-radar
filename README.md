# Token Launch Radar

A radar for protocols that have not launched a token yet. It reads one sealed DefiLlama snapshot
(758 protocols, fetched 2026-11-14), sets aside the 416 that already record a token, and ranks the
342 that record none by an implied launch value, each with a concrete farm plan. The board covers
all 40 protocols on the snapshot's watchlist and every pre-token protocol below that floor as well.

## The value model

Implied value = TVL × category multiple × momentum × seasoning, rounded to whole dollars.

- **Category multiple** prices what a launch usually captures against TVL for that kind of
  protocol: Dexs 1.60, Derivatives 1.50, Launchpad 1.45, Chain 1.40, Lending 1.35, bridges 0.70,
  default 0.90. It is keyed by category, never by a protocol's name.
- **Momentum** reads the 7-day TVL change, clamped to −50%..+100% and answered with a square-root
  response onto 0.75..1.50, so ordinary growth moves the factor most of the way and a freak week
  saturates. An unreported change is neutral.
- **Seasoning** rises from 0.75 to 1.25 over four years between the protocol's listing date and
  the snapshot date; an unrecorded listing date takes the middling 1.00.

Farm plans are generated per category family (DEX, lending, derivatives, bridge, yield, staking,
launchpad, other) from the protocol's main chain, size and age: five steps each, every one with a
cost estimate and a timeframe.

## The dashboard

A static page with no framework and no network: a summary strip, a sortable board (rank, protocol,
category, chains, TVL, 7-day change, implied value, implied/TVL, watchlist badge), text, category
and chain filters plus a watchlist-only toggle, and a detail view per protocol showing its stats,
its model breakdown and its full farm plan. Deep links work: `#p=<slug>` opens a protocol's
detail, `#cat=<category>` applies a category filter.

## Run it

Needs Node.js 22.18 or later; nothing is installed.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`--input` also accepts a directory holding `snapshot.json`; without `MAKEFUN_OUTPUT_DIR` (or
`--output`) the program writes to `/output`. It writes `board.json` (the ranked board), the
dashboard with its `data.js` under `dashboard/`, the `screenshots/`, and `dossier.json` built with
the vendored `vendor/makefun-board.ts`. The program is deterministic: the same snapshot always
writes the same bytes.

## Layout

- `main.ts` — the entrypoint: snapshot in, board, dashboard, screenshots and dossier out.
- `lib/model.ts` — the value model, the board builder and the farm-plan generator.
- `dashboard/` — `index.html`, `app.css`, `app.js`; renders from the generated `data.js`.
- `screenshots/` — the board, a protocol detail view and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the bounty kit.

MIT licensed; see `LICENSE`.

Built for make.fun's token launch radar bounty — https://make.fun/bounty/token-radar-01 (referral code ty7xpzdw)
