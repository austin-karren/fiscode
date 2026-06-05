# fiscode — handoff for next chat

## Master plan

Full implementation plan lives at `/Users/austinkarren/.claude/plans/eventual-giggling-star.md`. Read it first — it covers repo layout, package boundaries (`@fiscode/{core,db,tax,csv,ui}`), money/rounding rules (integer cents), DB/SQLocal init, history/versioning, tax engine seam, year config (with `// todo: verify` markers), CSV format + round-trip, PWA setup, React rules (no useEffect for derived state), the 9-step build sequence, and explicit non-goals (no IRS form generation, no filing, no backend/auth/sync in part 1).

Skills registry pinned at `/Users/austinkarren/workspaces/handily/handily-beta` (skills-lock.json + .claude/skills/). The plan calls out which skills to lean on for which steps (shadcn for primitives, agent-browser for viewport sweeps, vercel-react-best-practices for the no-useEffect rule, preflight-checks before commits).

## Where we are

Branch: `first-features` (clean working tree as of last typecheck).
`bun run check-types` passes across all 9 packages.

## Just finished (this session, post-compaction)

- **z.date() refactor** — every form field that used to be an ISO string regex now uses `z.date({ message: ... })`. Form state is `Date | undefined`; `dateToIso()` from `apps/web/src/components/forms/date-picker.tsx` converts at the `onSubmit` boundary. Done for: setup, income, expenses, mileage, time, home-office, profile (both profileForm and spouseForm).
  - Note: `profile.tsx` spouseForm has `validators: { onSubmit: spouseSchema as never }` because zod's `endDate: z.date().optional()` (Date | undefined) doesn't line up with TanStack Form's exactOptional handling. Comment in source explains.
- **Bordered checkbox (Field component)** — added shadcn `field` to `@fiscode/ui`. Used in:
  - `expenses.tsx` §179 candidate
  - `home-office.tsx` regular & exclusive use ack
    Pattern: `<FieldLabel htmlFor=...>` wrapping `<Field orientation="horizontal">` with `<Checkbox>` + `<FieldContent>` (FieldTitle + FieldDescription). FieldLabel auto-adds the border because of `has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border` in its base classes. Selected state highlights via `has-data-checked:border-primary/30 has-data-checked:bg-primary/5`.
- **Enter-to-submit** — `apps/web/src/hooks/use-submit-on-enter.ts` listens to `document` keydown. Ignores INPUT/TEXTAREA/SELECT, contenteditable, role=combobox/listbox/option/menuitem, and submit buttons. Calls `form.requestSubmit()`. Wrapped into a drop-in `<EnterToSubmitForm>` at `apps/web/src/components/forms/enter-to-submit-form.tsx`. All 9 route forms (10 forms total, incl. profile spouse form) now use it instead of `<form>`. Browser default Enter-in-input behavior is unchanged.

## Task list state

- #31–37 ✅ completed
- **Next up — Part 2 (apps/fumadocs)**, fully scoped in the master plan at `/Users/austinkarren/.claude/plans/eventual-giggling-star.md` under "Part 2 — Fumadocs docs app" (framework choice, stack, route shape, content outline, 9-step build sequence). Template: `/Users/austinkarren/workspaces/personal/fiscode-reference/apps/fumadocs`.

## Key conventions to keep in mind

(All saved in `~/.claude/projects/-Users-austinkarren-workspaces-personal-fiscode/memory/`)

- **Form validation timing**: form-level validator → `onSubmit` only; per-field validator → `onBlur` only. NEVER `onChange`.
- **Don't kill the user's dev server**: check the default port first; if I need my own, use a different port. Never `pkill` vite.
- **No useEffect for derived state**: useEffect is only for syncing with external systems (DOM listeners, OPFS boot, SW registration). The Enter-to-submit hook is legit (DOM listener); derived state/prop reset/data fetching is not.
- **oxlint + oxfmt**: CI runs `bun run check` (= `oxlint && oxfmt --write`). Reference repo: fiscode-reference.
- **Use packages, keep app UI-focused**: domain/data/parsers/types live in `packages/{core,db,tax,csv}`; `apps/web` is UI only.

## Known minor things not addressed

- `home-office.tsx` `<form.Subscribe>` chunk truncated in last system-reminder dump; verified file is intact via typecheck.
- `profile.tsx` profileForm onSubmit/validators still use string fields (only spouseForm got the z.date treatment in the spouse block — profileForm fields don't have a date).
- No tests written for the new hook or Field-pattern checkboxes.

## Files touched this session (post-compaction)

```
apps/web/src/routes/profile.tsx         (spouseForm: z.date(), as never cast)
apps/web/src/routes/expenses.tsx        (§179 bordered Field)
apps/web/src/routes/home-office.tsx     (ack bordered Field)
apps/web/src/components/forms/enter-to-submit-form.tsx   (new)
apps/web/src/hooks/use-submit-on-enter.ts                (new)
packages/ui/src/components/field.tsx                     (new, shadcn add)
apps/web/src/routes/{vehicles,time,home-office,mileage,income,clients,expenses,setup,profile}.tsx
  (swap <form> → <EnterToSubmitForm>, add import)
```

## Suggested first prompt for the next chat

> Continue fiscode from `HANDOFF.md` at the repo root. Read the master plan at `/Users/austinkarren/.claude/plans/eventual-giggling-star.md` for full context. Pick up task #37: add `.zed` and `.vscode` settings to this repo using `/Users/austinkarren/workspaces/handily/handily-beta` as the reference. Personal stack is oxlint + oxfmt — make sure format-on-save and lint integrations target those, not eslint/prettier.
