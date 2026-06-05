# fiscode

A fast, **local-only** tax estimator and time tracker for 1099 /
self-employed work. Hosted at <https://fiscode.austink.dev> and installable as
a PWA.

**fiscode is not a tax filing tool.** It is an estimator and organizer that
gets you most of the way to a quarterly estimate and a year-end packet. A tax
accountant (or you) finishes from there.

## Core principles

- **Local only.** All data lives on device (SQLite via OPFS). No backend, no
  network calls for app data.
- **CSV is the source of truth.** State round-trips losslessly through a
  single CSV file. Hand the yearly CSV to your accountant; reload it later to
  reconstruct full state.
- **Instant.** No spinners. Reads and writes are local and should feel
  synchronous.
- **Non-destructive.** Every mutation appends to an on-device version
  history. Deletes are soft and confirmed.
- **Self-healing.** Only the minimum profile is required (filing status,
  state, SE start date, entity type). Everything else degrades gracefully when
  missing.

See [`PLAN.md`](./PLAN.md) for what's intentionally future work (auth, E2EE
sync, docs site, native desktop).

## Stack

- **bun** + **turborepo** monorepo
- **TanStack Router SPA** on **Vite**
- **shadcn/ui** + **Tailwind v4**
- **Drizzle** + **SQLocal** (sqlite-wasm over OPFS)
- **Papaparse** for CSV
- **vite-plugin-pwa**
- **vitest**, **oxlint + oxfmt**

## Layout

```
fiscode/
├── apps/
│   ├── web/         # the PWA (UI only)
│   ├── fumadocs/    # stub: docs site (part 2)
│   └── desktop/     # stub: Electrobun wrapper (part 3)
└── packages/
    ├── core/        # money, dates, ids, shared types
    ├── tax/         # year configs + strategies + engine (pure)
    ├── csv/         # parse / build / round-trip (pure)
    ├── db/          # SQLocal + Drizzle schema + repos + history
    ├── ui/          # shared shadcn primitives
    └── config/      # shared tsconfig bases
```

## Scripts

```bash
bun install
bun run dev:web        # vite dev server on http://localhost:3001
bun run build          # turbo build across all apps + packages
bun run test           # vitest run, all packages
bun run check-types    # tsc --noEmit, all packages
bun run check          # oxlint + oxfmt --write
```

> If your editor's `oxlint` / `oxfmt` LSP errors with `Cannot find module
'.../node_modules/oxfmt/bin/oxfmt'` after a fresh `bun install`, restart the
> editor's language server. Bun's isolated linker creates the symlinks
> correctly, but some LSPs cache file-not-found from before install finished.

## CSV-as-source-of-truth model

- Export the **yearly CSV** at year end. Hand that file to your accountant.
- Import a CSV in a fresh browser (or after clearing OPFS) to fully
  reconstruct state. Edit history does not carry over — that's a SQLite
  concept, not a CSV one.
- The CSV begins with `#`-prefixed provenance lines. Excel will not strip
  them; the fiscode importer does.

## Tax engine notes

- Every annually-changing tax figure (brackets, standard deduction, SS wage
  base, mileage rate, state rate, quarterly due dates, safe-harbor thresholds)
  lives in `packages/tax/src/config/<year>.ts`.
- Each figure is marked `// todo: verify` for the year it was seeded. Treat
  the engine as **giving you a working estimate**, not a tax return.
- Sole-prop strategy is implemented today. S-corp seam exists as a
  `NotImplemented` stub at the same interface.

## Development

TanStack Router file-based routes live in `apps/web/src/routes/`. Run
`bun run dev:web` to generate `routeTree.gen.ts` and start the dev server.

Tests for the tax engine and CSV round-trip live next to their source. SQLocal
(in-browser SQLite) cannot run headlessly under Node, so DB code is exercised
through the app itself.

See `PLAN.md` for future work.
