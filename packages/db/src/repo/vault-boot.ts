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

const incomplete = (err: unknown, signal?: AbortSignal) =>
  setVaultMigrationState({
    phase: "migration-incomplete",
    reason: signal?.aborted ? "cancelled" : "failed",
    message: errorMessage(err),
  });

/**
 * Reads whether the migration is done and sets the state. No lock, no file access. Never throws:
 * the app must render even when the vault can't start (Documents is then read-only,
 * `migration-incomplete`).
 */
export const prepareVault = async (): Promise<void> => {
  try {
    setVaultMigrationState(
      (await isVaultMigrated()) ? { phase: "done" } : { phase: "migrating", done: 0, total: 0 },
    );
  } catch (err) {
    incomplete(err);
    console.error("vault prepare", err);
  }
};

/**
 * Background start: recover a journal a crash left (roll forward or back), then run the migration
 * when it isn't done, else the every-boot backstop for live rows without a vault_path. Never
 * throws. A migration that stops part way leaves `migration-incomplete` (read-only); an error
 * after it is done (recovery, the backstop) is logged and leaves `done`: the scan reports it.
 */
export const runVaultStartup = async (
  options: { onProgress?: (p: MigrationProgress) => void; signal?: AbortSignal } = {},
): Promise<VaultMigrationReport | undefined> => {
  let migrated = false;
  try {
    migrated = await isVaultMigrated();
    await recoverVault();
    if (!migrated) return await migrateToVault({ datesFor: linkedDates, ...options });
    await withVaultLock(() => placeUnplacedDocuments(getVaultStore(), linkedDates), {
      wait: true,
    });
    setVaultMigrationState({ phase: "done" });
    return undefined;
  } catch (err) {
    if (migrated) setVaultMigrationState({ phase: "done" });
    else incomplete(err, options.signal);
    console.error("vault start", err);
    return undefined;
  }
};

/** The banner's Resume action after `migration-incomplete`: runs the job again from where it stopped. */
export const resumeVaultMigration = (
  options: { onProgress?: (p: MigrationProgress) => void; signal?: AbortSignal } = {},
): Promise<VaultMigrationReport | undefined> => {
  setVaultMigrationState({ phase: "migrating", done: 0, total: 0 });
  return runVaultStartup(options);
};
