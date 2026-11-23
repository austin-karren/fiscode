import { VaultIntegrityError } from "@fiscode/core";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, runAtomic, type AtomicQuery } from "../client.ts";
import {
  document,
  documentFolder,
  meta,
  type DocumentFolderRow,
  type DocumentRow,
} from "../schema/index.ts";
import { withVaultLock } from "./lock.ts";
import { referencedOldShas, writeManifest } from "./manifest.ts";
import {
  byAdded,
  errorMessage,
  withoutSuffix,
  documentFileName,
  documentVaultPath,
  fitFolders,
  folderDir,
  folderSegments,
  pathContext,
  type PathContext,
  type ShortenedFolder,
} from "./paths.ts";
import { setVaultMigrationState } from "./state.ts";
import {
  getVaultStore,
  oldBytesPath,
  sha256Hex,
  VaultWrongKindError,
  type VaultStore,
} from "./store.ts";
import { historyQuery } from "./tree.ts";

// The one-off move from by-sha blobs to the readable tree (ADR 0001 § 10), and the every-boot
// backstop for live rows without a vault_path. Resumable: a document is done once its vault_path
// is set and the file there has its sha256; a crash or a cancel restarts at the first not done.
// The old store is only read, so a cancel leaves both stores readable.

export const MIGRATION_DONE_KEY = "vault_migration";
export const MIGRATION_REPORT_KEY = "vault_migration_report";

/**
 * What the migration changed or couldn't do (§ 10). Persisted in `meta` so the scan page
 * (`/documents/check`) can show it whenever it ships.
 */
export type VaultMigrationReport = {
  finishedAt: string;
  /** Live documents at the end. */
  documents: number;
  /** Files this run wrote into the tree (a resumed run counts only its own). */
  placed: number;
  /** Old bytes copied into `_fiscode/versions` or `trash`. */
  oldBytesKept: number;
  /** Folder names shortened to fit the 240 budget (§ 3.8): "3 folder names shortened". */
  foldersShortened: ShortenedFolder[];
  /** Titles `vaultPath` had to cut so the path fits. */
  titlesShortened: { documentId: string; name: string; path: string }[];
  /** Still over budget even at the shortest title: kept, never stops the job. */
  overBudget: { documentId: string; path: string; overBy: number }[];
  /** Referenced bytes this device doesn't have, or whose bytes don't match their sha256. */
  missing: { documentId: string | null; sha256: string; reason: "missing" | "damaged" }[];
};

export type MigrationProgress = { phase: "migrating"; done: number; total: number };

export type MigrationOptions = {
  datesFor: (documentIds: readonly string[]) => Promise<Map<string, string[]>>;
  onProgress?: (p: MigrationProgress) => void;
  signal?: AbortSignal;
  store?: VaultStore;
};

const emptyReport = (): VaultMigrationReport => ({
  finishedAt: "",
  documents: 0,
  placed: 0,
  oldBytesKept: 0,
  foldersShortened: [],
  titlesShortened: [],
  overBudget: [],
  missing: [],
});

const readMeta = async (key: string): Promise<string | undefined> => {
  const rows = await getDb().select().from(meta).where(eq(meta.key, key)).limit(1);
  return rows[0]?.value;
};

const metaWrite = (key: string, value: string) =>
  getDb()
    .insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });

export const isVaultMigrated = async () => (await readMeta(MIGRATION_DONE_KEY)) === "done";

/** The last migration's report, or undefined before it has finished. */
export const readVaultMigrationReport = async (): Promise<VaultMigrationReport | undefined> => {
  const raw = await readMeta(MIGRATION_REPORT_KEY);
  return raw ? (JSON.parse(raw) as VaultMigrationReport) : undefined;
};

/** Reads a path; a folder there counts as taken by something else. */
const readPath = async (store: VaultStore, path: string): Promise<Blob | "folder" | undefined> => {
  try {
    return await store.read(path);
  } catch (err) {
    if (err instanceof VaultWrongKindError) return "folder";
    throw err;
  }
};

/**
 * Step 3's folder half (§ 3.8): every live folder whose path is over budget is shortened, top
 * down, with " (n)" when the shorter name is taken. Rows change with History, like a restore.
 */
const fitAllFolders = async (report: VaultMigrationReport) => {
  const rows = (await getDb()
    .select()
    .from(documentFolder)
    .where(isNull(documentFolder.deletedAt))) as DocumentFolderRow[];
  const folders = new Map(rows.map((f) => [f.id, f]));
  // fitFolders works out each folder's path afresh, so earlier cuts count for later folders.
  const shortened = fitFolders(
    folders,
    rows.map((f) => f.id),
  );
  if (shortened.length === 0) return;
  const at = new Date().toISOString();
  const queries: AtomicQuery[] = [];
  for (const id of new Set(shortened.map((s) => s.folderId))) {
    const prev = rows.find((f) => f.id === id)!;
    const next = { ...folders.get(id)!, updatedAt: at };
    queries.push(getDb().update(documentFolder).set(next).where(eq(documentFolder.id, id)));
    queries.push(historyQuery("document_folder", id, "update", prev, next));
  }
  await runAtomic(queries);
  report.foldersShortened.push(...shortened);
};

/**
 * Step 2 for the given live documents, oldest first: copy the blob to its path via a temp name,
 * check its sha256, then set vault_path. A file already at the path with the right bytes is
 * adopted (a crash after the write); a file there with other bytes is never overwritten: the
 * document takes the next " (n)".
 */
const placeDocuments = async (
  store: VaultStore,
  docs: readonly DocumentRow[],
  ctx: PathContext,
  taken: string[],
  options: MigrationOptions,
  report: VaultMigrationReport,
  step: () => void,
) => {
  const dates = await options.datesFor(docs.map((d) => d.id));
  for (const d of docs.toSorted(byAdded)) {
    options.signal?.throwIfAborted();
    if (d.vaultPath && (await store.holds(d.vaultPath, d.sha256))) {
      if (!taken.includes(d.vaultPath)) taken.push(d.vaultPath);
      step();
      continue;
    }
    // A path the row had but whose file isn't right is not reused for another document.
    const own = d.vaultPath ? taken.indexOf(d.vaultPath) : -1;
    if (own >= 0) taken.splice(own, 1);
    const linked = dates.get(d.id) ?? [];
    const avoid = [...taken];
    let placed = documentVaultPath(d, ctx, linked, avoid);
    let adopt = false;
    for (;;) {
      const there = await readPath(store, placed.path);
      if (there === undefined) break;
      if (there !== "folder" && (await sha256Hex(there)) === d.sha256) {
        adopt = true;
        break;
      }
      avoid.push(placed.path);
      placed = documentVaultPath(d, ctx, linked, avoid);
    }
    if (!adopt) {
      const bytes = (await store.get(d.sha256)) ?? (await store.resolveOldBytes(d.sha256))?.bytes;
      if (!bytes) {
        report.missing.push({ documentId: d.id, sha256: d.sha256, reason: "missing" });
        step();
        continue;
      }
      if ((await sha256Hex(bytes)) !== d.sha256) {
        report.missing.push({ documentId: d.id, sha256: d.sha256, reason: "damaged" });
        step();
        continue;
      }
      await store.write(placed.path, bytes);
      if (!(await store.holds(placed.path, d.sha256))) throw new VaultIntegrityError(placed.path);
      report.placed++;
    }
    await getDb().update(document).set({ vaultPath: placed.path }).where(eq(document.id, d.id));
    taken.push(placed.path);
    const name = placed.path.slice(placed.path.lastIndexOf("/") + 1);
    if (!placed.fits) {
      report.overBudget.push({ documentId: d.id, path: placed.path, overBy: placed.overBy });
    } else if (withoutSuffix(name) !== documentFileName(d, linked)) {
      report.titlesShortened.push({ documentId: d.id, name: d.name, path: placed.path });
    }
    step();
  }
};

/** The rest of step 2: every other referenced sha into `_fiscode/` under the copy rule (§ 2). */
const keepOldBytes = async (
  store: VaultStore,
  shas: { versions: string[]; trash: string[] },
  options: MigrationOptions,
  report: VaultMigrationReport,
  step: () => void,
) => {
  const all = [
    ...shas.versions.map((sha) => ["versions", sha] as const),
    ...shas.trash.map((sha) => ["trash", sha] as const),
  ];
  for (const [folder, sha] of all) {
    options.signal?.throwIfAborted();
    if (await store.resolveOldBytes(sha)) {
      step();
      continue;
    }
    const bytes = await store.get(sha);
    if (!bytes || (await sha256Hex(bytes)) !== sha) {
      report.missing.push({ documentId: null, sha256: sha, reason: bytes ? "damaged" : "missing" });
      step();
      continue;
    }
    await store.write(oldBytesPath(folder, sha), bytes);
    report.oldBytesKept++;
    step();
  }
};

/** Step 3's check: every placed file and every kept sha reads back with its sha256. */
const verify = async (store: VaultStore, report: VaultMigrationReport) => {
  const live = (await getDb()
    .select()
    .from(document)
    .where(isNull(document.deletedAt))) as DocumentRow[];
  for (const d of live) {
    if (d.vaultPath && !(await store.holds(d.vaultPath, d.sha256))) {
      throw new VaultIntegrityError(d.vaultPath);
    }
  }
  const missing = new Set(report.missing.map((m) => m.sha256));
  const { versions, trash } = await referencedOldShas();
  for (const sha of [...versions, ...trash]) {
    if (missing.has(sha)) continue;
    const old = await store.resolveOldBytes(sha);
    if (!old || (await sha256Hex(old.bytes)) !== sha) {
      throw new VaultIntegrityError(old?.path ?? oldBytesPath("versions", sha));
    }
  }
  return live.length;
};

const liveDocuments = async () =>
  (await getDb().select().from(document).where(isNull(document.deletedAt))) as DocumentRow[];

const liveContext = async () => {
  const folders = (await getDb()
    .select()
    .from(documentFolder)
    .where(isNull(documentFolder.deletedAt))) as DocumentFolderRow[];
  const ctx = pathContext(folders);
  const dirs = folders.map((f) => folderDir(folderSegments(f.id, ctx.folders, ctx.disk) ?? null));
  return { ctx, dirs };
};

/** The job's body, under the lock. */
const migrate = async (store: VaultStore, options: MigrationOptions) => {
  const report = emptyReport();
  await fitAllFolders(report);
  const docs = await liveDocuments();
  const shas = await referencedOldShas();
  const total = docs.length + shas.versions.length + shas.trash.length;
  let done = 0;
  const step = () => {
    done++;
    const p = { phase: "migrating", done, total } as const;
    setVaultMigrationState(p);
    options.onProgress?.(p);
  };
  setVaultMigrationState({ phase: "migrating", done, total });
  const { ctx, dirs } = await liveContext();
  // Rows placed earlier (a resumed run, or written by a tree change) keep their paths: they are
  // taken from the start, and each is checked in its turn like the rest.
  const placed = docs.flatMap((d) => (d.vaultPath ? [d.vaultPath] : []));
  await placeDocuments(store, docs, ctx, [...dirs, ...placed], options, report, step);
  await keepOldBytes(store, shas, options, report, step);
  await writeManifest(store);
  report.documents = await verify(store, report);
  report.finishedAt = new Date().toISOString();
  await runAtomic([
    metaWrite(MIGRATION_REPORT_KEY, JSON.stringify(report)),
    metaWrite(MIGRATION_DONE_KEY, "done"),
  ]);
  return report;
};

/**
 * The migration job (§ 10). Waits for the vault lock (another tab may be running it), and returns
 * the persisted report when it is already done. While it runs, document writes throw
 * VaultMigratingError. Cancel (the signal) stops between files and leaves both stores readable;
 * the state is `migration-incomplete` (still read-only) until it is resumed.
 */
export const migrateToVault = async (options: MigrationOptions): Promise<VaultMigrationReport> => {
  const store = options.store ?? getVaultStore();
  return withVaultLock(
    async () => {
      if (await isVaultMigrated()) {
        setVaultMigrationState({ phase: "done" });
        return (await readVaultMigrationReport()) ?? emptyReport();
      }
      try {
        const report = await migrate(store, options);
        setVaultMigrationState({ phase: "done" });
        return report;
      } catch (err) {
        setVaultMigrationState({
          phase: "migration-incomplete",
          reason: options.signal?.aborted ? "cancelled" : "failed",
          message: errorMessage(err),
        });
        throw err;
      }
    },
    { wait: true },
  );
};

/**
 * The every-boot backstop (§ 10 step 5): step 2 again, but only for live rows whose vault_path
 * is null (e.g. after a CSV import). A row with a path whose file is missing or changed is the
 * reconcile scan's, so this never overwrites an outside edit. The caller holds the lock.
 * Returns how many rows it placed.
 */
export const placeUnplacedDocuments = async (
  store: VaultStore,
  datesFor: MigrationOptions["datesFor"],
  options: { oldBytes: boolean } = { oldBytes: true },
): Promise<number> => {
  const unplaced = (await getDb()
    .select()
    .from(document)
    .where(and(isNull(document.deletedAt), isNull(document.vaultPath)))) as DocumentRow[];
  if (unplaced.length === 0) return 0;
  const report = emptyReport();
  const { ctx, dirs } = await liveContext();
  const taken = [...dirs];
  for (const d of await liveDocuments()) if (d.vaultPath) taken.push(d.vaultPath);
  await placeDocuments(store, unplaced, ctx, taken, { datesFor }, report, () => {});
  if (options.oldBytes) {
    await keepOldBytes(store, await referencedOldShas(), { datesFor }, report, () => {});
  }
  return report.placed;
};
