import { VaultMigratingError, VaultMigrationIncompleteError } from "@fiscode/core";

/**
 * The vault migration's state, for the banner and the read-only Documents screen (ADR § 10,
 * § 11.3). Until it is `done`, every document write, import, restore and backup is refused
 * (`migrating`: VaultMigratingError; `migration-incomplete`: VaultMigrationIncompleteError).
 * Reads still work from either store. `idle` is only the state before the app's start code runs
 * (and in tests).
 */
export type VaultMigrationState =
  | { phase: "idle" }
  | { phase: "migrating"; done: number; total: number }
  | { phase: "done" }
  /**
   * The job stopped part way: it failed or was cancelled. Both stores are still readable.
   * Resume with `resumeVaultMigration()` (or the next boot).
   */
  | { phase: "migration-incomplete"; reason: "failed" | "cancelled"; message: string };

let state: VaultMigrationState = { phase: "idle" };
const listeners = new Set<(s: VaultMigrationState) => void>();

export const getVaultMigrationState = (): VaultMigrationState => state;

/** Calls `listener` on every change (e.g. from useSyncExternalStore). Returns the unsubscribe. */
export const onVaultMigrationState = (listener: (s: VaultMigrationState) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setVaultMigrationState = (next: VaultMigrationState) => {
  state = next;
  for (const l of listeners) l(next);
};

/**
 * Documents is read-only until the migration is done: throws VaultMigratingError while it runs,
 * VaultMigrationIncompleteError after it stopped part way. Import, restore and backup ask too.
 */
export const assertVaultWritable = () => {
  if (state.phase === "migrating") throw new VaultMigratingError();
  if (state.phase === "migration-incomplete") throw new VaultMigrationIncompleteError();
};

export const __resetVaultMigrationStateForTests = () => {
  state = { phase: "idle" };
  listeners.clear();
};
