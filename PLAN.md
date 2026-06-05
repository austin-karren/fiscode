# PLAN

Future work, intentionally lightweight notes — not a roadmap.

- **Auth + sync.** Add account-based auth and Brave-style end-to-end-encrypted
  sync of the SQLite/CSV state across devices. Until then, fiscode is strictly
  local-only and the CSV file is the only way state leaves the device.
- **Fumadocs (part 2).** Populate `apps/fumadocs` with how-to-use-the-app
  documentation.
- **Electrobun desktop (part 3).** Wrap the built `apps/web` SPA in Electrobun
  for a native macOS app.
- **S-corp tax strategy.** A typed seam exists at
  `packages/tax/src/strategy/s-corp.ts`; implement when the user actually
  elects S-corp status.
