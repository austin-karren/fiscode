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

/** What a screen holds back until the migration is done: documents, or an import or backup. */
export type VaultBlocked = "documents" | "import" | "backup";

const WAITS: Record<Exclude<VaultBlocked, "documents">, string> = {
  import: "Import waits",
  backup: "Backup and restore wait",
};

/**
 * Why writes are off until the migration is done, or undefined when they work. For documents it
 * is the repo's typed error message, so a disabled control and a refused write say the same
 * thing; an import or backup card names what it holds back.
 */
export const vaultReadOnlyReason = (
  state: VaultMigrationState,
  what: VaultBlocked = "documents",
): string | undefined => {
  if (state.phase !== "migrating" && state.phase !== "migration-incomplete") return undefined;
  if (what === "documents") {
    return state.phase === "migrating"
      ? new VaultMigratingError().message
      : new VaultMigrationIncompleteError().message;
  }
  return state.phase === "migrating"
    ? `${WAITS[what]} until your files are moved into the vault.`
    : `${WAITS[what]} until moving your files into the vault finishes. Resume it above.`;
};

export const useVaultReadOnly = (what: VaultBlocked = "documents"): string | undefined =>
  vaultReadOnlyReason(useVaultMigration(), what);
