import { OperationCancelledError, VaultIntegrityError, VaultNameTakenError } from "@fiscode/core";
import { isNotFound, type VaultDirHandle } from "./dir.ts";
import { withVaultLock, type LockManagerLike } from "./lock.ts";
import { sha256Hex, type VaultStore } from "./store.ts";

/**
 * One file op of a tree change (ADR § 6). Each is idempotent. `replaces` on a copy names the sha
 * the copy overwrites at `to`, so rolling it back can put those bytes back from `_fiscode/`.
 */
export type FileOp =
  | { op: "copy"; from: string; to: string; sha256: string; replaces?: string }
  | { op: "move"; from: string; to: string; sha256: string }
  | { op: "remove"; from: string; sha256: string };

export type Plan = { planId: string; ops: FileOp[] };

/**
 * The sqlite side of the exact check (ADR § 6): whether the plan's rows committed. PR 3 backs it
 * with the `vault_applied` table; until then callers pass their own.
 */
export type PlanLedger = {
  isApplied(planId: string): Promise<boolean>;
  /** Step 5: drop the row once the journal is gone. */
  forget(planId: string): Promise<void>;
};

/** OPFS only, beside the vault and never in it (ADR § 2). */
export const JOURNAL_FILE = "vault-journal.json";

export type Recovery = "none" | "rolled-forward" | "rolled-back";

export const readJournal = async (root: VaultDirHandle): Promise<Plan | undefined> => {
  try {
    const file = await (await root.getFileHandle(JOURNAL_FILE)).getFile();
    return JSON.parse(await file.text()) as Plan;
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
};

/** Step 2. A writable commits only on close(), so a crash leaves the old journal or the new one. */
export const writeJournal = async (root: VaultDirHandle, plan: Plan) => {
  const writable = await (
    await root.getFileHandle(JOURNAL_FILE, { create: true })
  ).createWritable();
  await writable.write(new Blob([JSON.stringify(plan)], { type: "application/json" }));
  await writable.close();
};

const deleteJournal = async (root: VaultDirHandle) => {
  try {
    await root.removeEntry(JOURNAL_FILE);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
};

export const applyOp = async (store: VaultStore, op: FileOp) => {
  if (op.op === "copy") return store.copy(op.from, op.to, op.sha256);
  if (op.op === "move") return store.move(op.from, op.to, op.sha256);
  return store.remove(op.from);
};

/** The inverse of `op`, also idempotent, so it is safe on an op that never ran. */
export const undoOp = async (store: VaultStore, op: FileOp) => {
  if (op.op === "move") {
    // Not yet moved: `from` still holds it, and `to` was free when planned (checkPlan).
    if (await store.holds(op.from, op.sha256)) return store.remove(op.to);
    return store.move(op.to, op.from, op.sha256);
  }
  if (op.op === "copy") {
    // Old bytes are never removed (ADR § 2): another document may share the sha.
    if (isOldBytes(op.to)) return;
    if (!op.replaces) return store.remove(op.to);
    return restoreOld(store, op.to, op.replaces);
  }
  return restoreOld(store, op.from, op.sha256);
};

/** Puts `sha256`'s bytes back at `path` from `_fiscode/` (resolveOldBytes), unless already there. */
const restoreOld = async (store: VaultStore, path: string, sha256: string) => {
  if (await store.holds(path, sha256)) return;
  const old = await store.resolveOldBytes(sha256);
  if (!old || (await sha256Hex(old.bytes)) !== sha256) throw new VaultIntegrityError(path);
  await store.write(path, old.bytes);
};

const isOldBytes = (path: string) => path.startsWith("_fiscode/");

/**
 * Removes must keep their bytes first. A move, or a copy that doesn't replace, must land on a free path, so undoing it can remove
 * `to` without losing a file that was there before. PR 3 turns this into the name check.
 */
const checkPlan = async (store: VaultStore, plan: Plan) => {
  // Undoing a remove, or a copy that replaces, restores from _fiscode/, so those bytes must be
  // kept there first: by an earlier copy in this plan (the copy rule) or already (ADR § 6).
  const requireKept = async (i: number, sha256: string, path: string) => {
    const keptHere = plan.ops
      .slice(0, i)
      .some((o) => o.op === "copy" && isOldBytes(o.to) && o.sha256 === sha256);
    if (!keptHere && !(await store.resolveOldBytes(sha256))) {
      throw new Error(
        `Plan ${plan.planId} overwrites or removes "${path}" before keeping its bytes`,
      );
    }
  };
  for (const [i, op] of plan.ops.entries()) {
    if (op.op === "remove") {
      await requireKept(i, op.sha256, op.from);
      continue;
    }
    if (op.op === "copy" && op.replaces) {
      await requireKept(i, op.replaces, op.to);
      continue;
    }
    if (op.op === "copy" && isOldBytes(op.to)) continue;
    if (await store.read(op.to)) throw new VaultNameTakenError(op.to);
  }
};

const rollForward = async (store: VaultStore, plan: Plan, hooks: RunHooks = {}) => {
  const total = plan.ops.length;
  for (const [i, op] of plan.ops.entries()) {
    if (hooks.signal?.aborted) throw new OperationCancelledError();
    hooks.onProgress?.({ phase: "moving", done: i, total });
    await applyOp(store, op);
  }
  if (hooks.signal?.aborted) throw new OperationCancelledError();
  hooks.onProgress?.({ phase: "moving", done: total, total });
};

/** Where a tree change is (§ 11.3): file ops done of total, then the commit, then done. */
export type TreeProgress = {
  phase: "moving" | "saving" | "repathing" | "done";
  done: number;
  total: number;
};

/**
 * A cancel is checked before each file op and before the commit, and rolls the files back. Once
 * the commit starts it is ignored: roll-forward owns the change from there.
 */
export type RunHooks = { onProgress?: (p: TreeProgress) => void; signal?: AbortSignal };
const rollBack = async (store: VaultStore, plan: Plan) => {
  for (const op of [...plan.ops].reverse()) await undoOp(store, op);
};

export type VaultJournal = {
  /**
   * Run a tree change: recover any earlier plan, write the journal, do the file ops, then
   * `commit` (the caller's runAtomic with the rows and the ledger row), then clear the journal.
   * A failure before the commit lands rolls the files back and rethrows.
   */
  run(plan: Plan, commit: () => Promise<void>, hooks?: RunHooks): Promise<void>;
  /** On boot and before any change: finish or undo a plan a crash left behind (ADR § 6). */
  recover(): Promise<Recovery>;
};

export const vaultJournal = (
  root: VaultDirHandle,
  store: VaultStore,
  ledger: PlanLedger,
  locks?: LockManagerLike,
): VaultJournal => {
  const finish = async (plan: Plan, applied: boolean) => {
    await deleteJournal(root);
    if (applied) await ledger.forget(plan.planId);
  };
  const recover = async (): Promise<Recovery> => {
    const plan = await readJournal(root);
    if (!plan) return "none";
    const applied = await ledger.isApplied(plan.planId);
    await (applied ? rollForward(store, plan) : rollBack(store, plan));
    await finish(plan, applied);
    return applied ? "rolled-forward" : "rolled-back";
  };
  // Both run under the fiscode-vault lock (ADR § 11.9): a change is a user action, so a busy
  // lock throws VaultBusyError; recovery is background work, so it waits.
  return {
    recover: () => withVaultLock(recover, { wait: true, locks }),
    run: (plan, commit, hooks = {}) =>
      withVaultLock(
        async () => {
          await recover();
          await checkPlan(store, plan);
          await writeJournal(root, plan);
          try {
            await rollForward(store, plan, hooks);
            hooks.onProgress?.({ phase: "saving", done: plan.ops.length, total: plan.ops.length });
            await commit();
          } catch (err) {
            // The commit may have landed before the error (e.g. a lost reply): the ledger decides.
            if (await ledger.isApplied(plan.planId)) {
              await finish(plan, true);
              return;
            }
            try {
              await rollBack(store, plan);
            } catch (rollbackErr) {
              // The journal stays, so the next recover() tries again. The caller sees the real cause.
              throw new Error(`Rolling back after "${String(err)}" failed`, { cause: rollbackErr });
            }
            await finish(plan, false);
            throw err;
          }
          await finish(plan, true);
        },
        { locks },
      ),
  };
};
