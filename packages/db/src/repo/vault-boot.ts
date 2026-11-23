import { withVaultLock } from "../vault/lock.ts";
import {
  isVaultMigrated,
  migrateToVault,
  placeUnplacedDocuments,
  type MigrationProgress,
  type VaultMigrationReport,
} from "../vault/migrate.ts";
import { setVaultMigrationState } from "../vault/state.ts";
import { errorMessage } from "../vault/paths.ts";
import { getVaultStore } from "../vault/store.ts";
import { recoverVault } from "../vault/tree.ts";
import { linkedDates } from "./documents.ts";

// The vault's part of app start (ADR 0001 § 6, § 10). `prepareVault` is quick and runs before the
// first render, so Documents is read-only from its first paint when the migration is still to do.
// `runVaultStartup` runs after: journal recovery, then the migration or the backstop.

/**
 * Reads whether the migration is done and sets the state. No lock, no file access. Never throws:
 * the app must render even when the vault can't start (the state says `failed`).
 */
export const prepareVault = async (): Promise<void> => {
  try {
    setVaultMigrationState(
      (await isVaultMigrated()) ? { phase: "done" } : { phase: "migrating", done: 0, total: 0 },
    );
  } catch (err) {
    setVaultMigrationState({
      phase: "failed",
      message: errorMessage(err),
    });
    console.error("vault prepare", err);
  }
};

/**
 * Background start: recover a journal a crash left (roll forward or back), then run the migration
 * when it isn't done, else the every-boot backstop for live rows without a vault_path. Errors are
 * in the state (`failed`), not thrown: the app keeps working on the old store.
 */
export const runVaultStartup = async (
  options: { onProgress?: (p: MigrationProgress) => void; signal?: AbortSignal } = {},
): Promise<VaultMigrationReport | undefined> => {
  try {
    await recoverVault();
    if (!(await isVaultMigrated())) {
      return await migrateToVault({ datesFor: linkedDates, ...options });
    }
    await withVaultLock(() => placeUnplacedDocuments(getVaultStore(), linkedDates), {
      wait: true,
    });
    setVaultMigrationState({ phase: "done" });
    return undefined;
  } catch (err) {
    if (!options.signal?.aborted) {
      setVaultMigrationState({
        phase: "failed",
        message: errorMessage(err),
      });
    }
    console.error("vault start", err);
    return undefined;
  }
};
