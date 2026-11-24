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
import type { RunHooks, TreeProgress } from "./document-tree.ts";
import { repathDocuments } from "./vault-repath.ts";

// The vault's part of app start (ADR 0001 § 6, § 10). `prepareVault` is quick and runs before the
// first render, so Documents is read-only from its first paint when the migration is still to do.
// `runVaultStartup` runs after: journal recovery, then the migration or the backstop.

const incomplete = (err: unknown, signal?: AbortSignal) =>
  setVaultMigrationState({
    phase: "migration-incomplete",
    reason: signal?.aborted ? "cancelled" : "failed",
    message: errorMessage(err),
  });

type StartupOptions = {
  onProgress?: (p: MigrationProgress) => void;
  /** The one-time re-path after the double-date fix: { phase: "repathing" | "done", done, total }. */
  onRepathProgress?: (p: TreeProgress) => void;
  signal?: AbortSignal;
};

/** The re-path job, once, after the migration. A failure is logged; the next boot resumes it. */
const repathOnce = async (options: Pick<StartupOptions, "onRepathProgress" | "signal">) => {
  try {
    const hooks: RunHooks = {};
    if (options.onRepathProgress) hooks.onProgress = options.onRepathProgress;
    if (options.signal) hooks.signal = options.signal;
    await repathDocuments(hooks);
  } catch (err) {
    console.error("vault re-path", err);
  }
};

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
  options: StartupOptions = {},
): Promise<VaultMigrationReport | undefined> => {
  let migrated = false;
  try {
    migrated = await isVaultMigrated();
    await recoverVault();
    if (!migrated) {
      const { onRepathProgress, ...rest } = options;
      const report = await migrateToVault({ datesFor: linkedDates, ...rest });
      if (await isVaultMigrated()) await repathOnce({ onRepathProgress, signal: rest.signal });
      return report;
    }
    await withVaultLock(() => placeUnplacedDocuments(getVaultStore(), linkedDates), {
      wait: true,
    });
    setVaultMigrationState({ phase: "done" });
    await repathOnce(options);
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
  options: StartupOptions = {},
): Promise<VaultMigrationReport | undefined> => {
  setVaultMigrationState({ phase: "migrating", done: 0, total: 0 });
  return runVaultStartup(options);
};
