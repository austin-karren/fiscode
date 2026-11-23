import { VaultMigratingError } from "@fiscode/core";

/**
 * The vault migration's state, for the banner and the read-only Documents screen (ADR § 10,
 * § 11.3). `migrating` blocks every document write with VaultMigratingError; reads still work.
 */
export type VaultMigrationState =
  | { phase: "idle" }
  | { phase: "migrating"; done: number; total: number }
  | { phase: "done" }
  /** The job stopped on an error. Both stores are still readable; the next boot tries again. */
  | { phase: "failed"; message: string };

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

/** Throws VaultMigratingError while the migration runs: Documents is read-only then. */
export const assertVaultWritable = () => {
  if (state.phase === "migrating") throw new VaultMigratingError();
};

export const __resetVaultMigrationStateForTests = () => {
  state = { phase: "idle" };
  listeners.clear();
};
