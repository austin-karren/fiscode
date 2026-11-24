import { newId, OperationCancelledError } from "@fiscode/core";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, runAtomic, type AtomicQuery } from "../client.ts";
import { document, history as historyTable, vaultApplied } from "../schema/index.ts";
import {
  vaultJournal,
  type FileOp,
  type PlanLedger,
  type Recovery,
  type RunHooks,
} from "./journal.ts";
import { announceVaultChange, withVaultLock, type LockManagerLike } from "./lock.ts";
import { writeManifest } from "./manifest.ts";
import { assertVaultWritable } from "./state.ts";
import {
  getVaultRoot,
  getVaultStore,
  oldBytesPath,
  TMP_SUFFIX,
  type OldBytesFolder,
  type VaultStore,
} from "./store.ts";

// Every repo tree change (upload, rename, move, replace, soft delete, restore, History revert)
// runs here: plan the file ops, journal them, do them, commit the rows with the plan's
// vault_applied row, then rewrite fiscode.json (ADR 0001 § 6).

/** The sqlite side of the journal's exact check: the vault_applied table (§ 6). */
export const sqliteLedger: PlanLedger = {
  async isApplied(planId) {
    const rows = await getDb()
      .select()
      .from(vaultApplied)
      .where(eq(vaultApplied.planId, planId))
      .limit(1);
    return rows.length > 0;
  },
  async forget(planId) {
    await getDb().delete(vaultApplied).where(eq(vaultApplied.planId, planId));
  },
};

// The journal runs inside our own hold of the fiscode-vault lock (planning reads the tree too),
// so its own lock calls must not ask again: a second request from the same tab would be refused.
const heldLock: LockManagerLike = { request: (_n, _o, cb) => cb({}) };

const journal = () => vaultJournal(getVaultRoot(), getVaultStore(), sqliteLedger, heldLock);

/**
 * Finish or undo a plan a crash left behind (§ 6): rolled forward when its vault_applied row is
 * there, back when not. Background work, so it waits for the lock. Run on boot.
 */
export const recoverVault = (): Promise<Recovery> =>
  withVaultLock(() => recoverVaultHeld(), { wait: true });

/** `recoverVault` for a caller that already holds the lock (the scan). */
export const recoverVaultHeld = async (): Promise<Recovery> => {
  const outcome = await journal().recover();
  // The plan's own step 5 may not have run: the manifest follows sqlite again.
  if (outcome !== "none") await writeManifest(getVaultStore());
  return outcome;
};

/** Bytes waiting to become a document, hidden like a crashed write (the scan deletes leftovers). */
const stagingPath = (planId: string) => `_fiscode/.${planId}${TMP_SUFFIX}`;

/**
 * Builds one plan's file ops. Every op cites the § 2 rules: `keep` is the copy rule, `source`
 * reads old bytes with resolveOldBytes.
 */
export class PlanBuilder {
  readonly planId = newId();
  readonly ops: FileOp[] = [];
  private readonly kept = new Map<string, string>();
  private readonly staged: string[] = [];

  constructor(readonly store: VaultStore) {}

  /** Puts new bytes (an upload or a replace) where the plan can copy them from. */
  async stage(bytes: Blob): Promise<string> {
    const path = stagingPath(`${this.planId}-${this.staged.length}`);
    this.staged.push(path);
    await this.store.write(path, bytes);
    return path;
  }

  /** Removes the staged bytes: copied into place by now, or not wanted after a rollback. */
  async cleanUp() {
    for (const path of this.staged) await this.store.remove(path).catch(() => {});
  }

  /** The copy rule: copy `from` into `_fiscode/<folder>/` only when neither folder holds it. */
  async keep(folder: OldBytesFolder, from: string, sha256: string) {
    if (this.kept.has(sha256)) return;
    const old = await this.store.resolveOldBytes(sha256);
    if (old) {
      this.kept.set(sha256, old.path);
      return;
    }
    const to = oldBytesPath(folder, sha256);
    this.ops.push({ op: "copy", from, to, sha256 });
    this.kept.set(sha256, to);
  }

  /**
   * A vault path holding `sha256`'s bytes: kept old bytes (resolveOldBytes), or else a live
   * document that has the same bytes (D12 duplicates). Undefined when this device has none.
   */
  async source(sha256: string): Promise<string | undefined> {
    const planned = this.kept.get(sha256);
    if (planned) return planned;
    const old = await this.store.resolveOldBytes(sha256);
    if (old) return old.path;
    const rows = await getDb()
      .select({ path: document.vaultPath })
      .from(document)
      .where(
        and(eq(document.sha256, sha256), isNull(document.deletedAt), isNotNull(document.vaultPath)),
      );
    for (const r of rows) if (r.path && (await this.store.holds(r.path, sha256))) return r.path;
    return undefined;
  }

  /** The row's path when its file is there with the row's bytes; else null (left to the scan). */
  async heldPath(row: { vaultPath: string | null; sha256: string }): Promise<string | null> {
    if (!row.vaultPath) return null;
    return (await this.store.holds(row.vaultPath, row.sha256)) ? row.vaultPath : null;
  }

  /**
   * The ops for one document going from `cur` to `next`, and the vault_path its row gets.
   * - deleted: keep its bytes in trash/, then remove the live file;
   * - same bytes, new path: move;
   * - new bytes: keep the current ones in versions/, copy the new ones (from `next.source`, or
   *   resolveOldBytes) into place, and remove the old path when the path changed too.
   * Bytes this device doesn't have leave the row's path null: it shows "File not on this device".
   */
  async document(
    cur: { path: string | null; sha256: string },
    next: { live: boolean; path: string; sha256: string; source?: string },
  ): Promise<string | null> {
    if (!next.live) {
      if (cur.path) {
        await this.keep("trash", cur.path, cur.sha256);
        this.ops.push({ op: "remove", from: cur.path, sha256: cur.sha256 });
      }
      return cur.path;
    }
    if (cur.path && cur.sha256 === next.sha256) {
      if (cur.path !== next.path) {
        this.ops.push({ op: "move", from: cur.path, to: next.path, sha256: next.sha256 });
      }
      return next.path;
    }
    if (cur.path) await this.keep("versions", cur.path, cur.sha256);
    const from = next.source ?? (await this.source(next.sha256));
    const samePath = cur.path === next.path;
    if (from) {
      this.ops.push({
        op: "copy",
        from,
        to: next.path,
        sha256: next.sha256,
        ...(cur.path && samePath ? { replaces: cur.sha256 } : {}),
      });
    }
    if (cur.path && (!samePath || !from)) {
      this.ops.push({ op: "remove", from: cur.path, sha256: cur.sha256 });
    }
    return from ? next.path : null;
  }
}

/** The history row for a document or folder write, as a query for runAtomic. */
export const historyQuery = (
  entity: string,
  entityId: string,
  op: "insert" | "update" | "delete" | "revert",
  before: unknown,
  after: unknown,
) =>
  getDb()
    .insert(historyTable)
    .values({
      id: newId(),
      entity,
      entityId,
      op,
      beforeJson: before === undefined ? null : JSON.stringify(before),
      afterJson: JSON.stringify(after),
      at: new Date().toISOString(),
    });

/**
 * Runs one tree change. `build` plans it with the builder and returns the row queries; they commit
 * in one transaction with the plan's vault_applied row, after the file ops. A failure before the
 * commit rolls the files back. Throws VaultMigratingError while the migration runs, and
 * VaultBusyError when another tab holds the vault. `long` marks a long op (a folder rename or
 * move, § 11.3), which a focus scan skips rather than waits for.
 */
export const runTreeChange = async <T>(
  build: (plan: PlanBuilder) => Promise<{ queries: AtomicQuery[]; result: T }>,
  hooks: RunHooks = {},
  options: { long?: boolean } = {},
): Promise<T> => {
  assertVaultWritable();
  const out = await withVaultLock(() => runTreeChangeHeld(build, hooks), options);
  announceVaultChange();
  return out;
};

/**
 * `runTreeChange` for a caller that already holds the fiscode-vault lock (the scan). It neither
 * takes the lock nor announces the change: the caller does both.
 */
export const runTreeChangeHeld = async <T>(
  build: (plan: PlanBuilder) => Promise<{ queries: AtomicQuery[]; result: T }>,
  hooks: RunHooks = {},
): Promise<T> => {
  assertVaultWritable();
  const store = getVaultStore();
  const j = journal();
  await j.recover();
  const plan = new PlanBuilder(store);
  try {
    const { queries, result } = await build(plan);
    const total = plan.ops.length;
    if (total === 0) {
      if (hooks.signal?.aborted) throw new OperationCancelledError();
      hooks.onProgress?.({ phase: "saving", done: 0, total });
      await runAtomic(queries);
      await writeManifest(store);
    } else {
      const applied = getDb().insert(vaultApplied).values({ planId: plan.planId });
      // Step 5 order: the manifest is rewritten before the journal and ledger row go, so a
      // crash after the commit still has a journal to roll forward and then rewrite it.
      await j.run(
        { planId: plan.planId, ops: plan.ops },
        async () => {
          await runAtomic([...queries, applied]);
          await writeManifest(store);
        },
        hooks,
      );
    }
    hooks.onProgress?.({ phase: "done", done: total, total });
    return result;
  } finally {
    await plan.cleanUp();
  }
};
