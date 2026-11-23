import { useSyncExternalStore } from "react";
import { VaultMigratingError, VaultMigrationIncompleteError } from "@fiscode/core";
import {
  getVaultMigrationState,
  onVaultMigrationState,
  type VaultMigrationState,
} from "@fiscode/db";

/** The vault migration's state (ADR 0001 § 10), live: the store notifies on every change. */
export const useVaultMigration = (): VaultMigrationState =>
  useSyncExternalStore(onVaultMigrationState, getVaultMigrationState);

/**
 * Why writes are off until the migration is done: the same message the repo's typed error would
 * show, so a disabled control and a refused write say the same thing. Undefined when writes work.
 */
export const vaultReadOnlyReason = (state: VaultMigrationState): string | undefined => {
  if (state.phase === "migrating") return new VaultMigratingError().message;
  if (state.phase === "migration-incomplete") return new VaultMigrationIncompleteError().message;
  return undefined;
};

export const useVaultReadOnly = (): string | undefined => vaultReadOnlyReason(useVaultMigration());
