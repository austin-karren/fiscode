import {
  documentMimeFor,
  DocumentNotFoundError,
  DocumentTooLargeError,
  MAX_DOCUMENT_BYTES,
  newId,
  validDocumentName,
  VaultIntegrityError,
  VaultNameTakenError,
  VAULT_DOCUMENTS_DIR,
} from "@fiscode/core";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type AtomicQuery } from "../client.ts";
import { document, documentFolder, meta, type DocumentRow } from "../schema/index.ts";
import {
  announceVaultChange,
  isLongVaultOpRunning,
  withVaultLock,
  type LockManagerLike,
} from "../vault/lock.ts";
import { byAdded, documentDate, folderDir, folderSegments, pathContext } from "../vault/paths.ts";
import { getVaultMigrationState } from "../vault/state.ts";
import {
  getVaultStore,
  isTmpName,
  oldBytesPath,
  sha256Hex,
  VaultWrongKindError,
  type VaultStore,
} from "../vault/store.ts";
import { historyQuery, recoverVaultHeld, runTreeChange, runTreeChangeHeld } from "../vault/tree.ts";
import { changeTree, fileDatePrefix, forHistory, type DocumentChange } from "./document-tree.ts";
import { linkedDates } from "./documents.ts";

// The reconcile scan (ADR 0001 § 6, § 11.4): walk `documents/`, compare it to sqlite by path and
// sha256, and report. sqlite wins for metadata, the tree for bytes. The scan acts on its own only
// where nothing can be lost: it records an outside edit as a new version and deletes leftover
// `.*.fiscode-tmp` files. Moves, new files, conflicts and stale dates wait for the user (D6).

/** A row's file was found at another path in `documents/` (same sha256): adopt, or move back. */
export type ScanMoved = {
  documentId: string;
  name: string;
  /** Where sqlite says the file is. */
  path: string;
  /** Where it is now. */
  foundAt: string;
  sha256: string;
  /** The folder adopting gives it: the nearest folder fiscode knows above `foundAt`; null = Unfiled. */
  adoptFolderId: string | null;
};

/** A row whose file is nowhere in `documents/`: the row shows "File not on this device". */
export type ScanMissing = {
  documentId: string;
  name: string;
  path: string | null;
};

/** An outside edit, already recorded as a new version (History has it). */
export type ScanChanged = {
  documentId: string;
  name: string;
  path: string;
  fromSha256: string;
  toSha256: string;
  /** False when this device didn't have the old bytes: that version shows as not available. */
  oldBytesKept: boolean;
};

/** "New in folder": a file with no row, of a type fiscode stores. One click imports it. */
export type ScanNewFile = {
  path: string;
  name: string;
  mime: string;
  sizeBytes: number;
  /** The folder importing puts it in: the nearest folder fiscode knows above it; null = Unfiled. */
  folderId: string | null;
};

/** A sync client's conflict copy, beside the file it conflicts with. Never imported silently. */
export type ScanConflict = {
  path: string;
  originalPath: string;
  /** The document at `originalPath`, when it has one. */
  documentId: string | null;
  kind: "nextcloud" | "drive";
};

/** A file whose date prefix (D2) no longer matches: its linked record's date changed, or the record went. */
export type ScanRedated = {
  documentId: string;
  name: string;
  path: string;
  fileDate: string;
  /** The date D2 gives now: the one linked record's date, else the date the document was added. */
  expectedDate: string;
};

export type ScanTrigger = "boot" | "focus" | "check";

export type ScanReport = {
  status: "done";
  trigger: ScanTrigger;
  scannedAt: string;
  /** Rows whose path holds their sha256. */
  ok: number;
  moved: ScanMoved[];
  missing: ScanMissing[];
  changed: ScanChanged[];
  unknown: ScanNewFile[];
  conflicts: ScanConflict[];
  redated: ScanRedated[];
  /** Leftover temp files of a crashed write, deleted by this scan. */
  tmpRemoved: string[];
};

/**
 * `migrating`: the vault isn't built yet, so there is nothing to compare. `busy`: a focus scan
 * found a long op running in some tab (§ 11.4: skipped, not queued; the next focus scans again).
 */
export type ScanResult = ScanReport | { status: "skipped"; reason: "migrating" | "busy" };

export const SCAN_REPORT_KEY = "vault_scan_report";

/** The badge count on Documents ("3 to review"). `changed` is done already, so it isn't counted. */
export const scanReviewCount = (r: ScanReport) =>
  r.moved.length + r.missing.length + r.unknown.length + r.conflicts.length + r.redated.length;

/** The last scan's report, less what the actions since have handled. */
export const readLastScanReport = async (): Promise<ScanReport | undefined> => {
  const rows = await getDb().select().from(meta).where(eq(meta.key, SCAN_REPORT_KEY)).limit(1);
  return rows[0] ? (JSON.parse(rows[0].value) as ScanReport) : undefined;
};

const saveReport = (r: ScanReport) => {
  const value = JSON.stringify(r);
  return getDb()
    .insert(meta)
    .values({ key: SCAN_REPORT_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
};

const dropFromLastReport = async (edit: (r: ScanReport) => ScanReport) => {
  const last = await readLastScanReport();
  if (last) await saveReport(edit(last));
};

const dropMoved = (items: readonly ScanMoved[]) => {
  const ids = new Set(items.map((m) => m.documentId));
  return dropFromLastReport((r) => ({
    ...r,
    moved: r.moved.filter((m) => !ids.has(m.documentId)),
  }));
};

const folderIsLive = async (id: string | null): Promise<boolean> => {
  if (id === null) return true;
  const rows = await getDb()
    .select({ id: documentFolder.id })
    .from(documentFolder)
    .where(and(eq(documentFolder.id, id), isNull(documentFolder.deletedAt)));
  return rows.length > 0;
};

/** Case- and accent-insensitive key (§ 4), so a case-insensitive folder still matches its row. */
const key = (path: string) => path.normalize("NFC").toLowerCase();
const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const byPath = <T extends { path: string }>(a: T, b: T) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Every file in the vault, recursively, temp files included. */
const walk = async (store: VaultStore, dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await store.list(dir, { withTmp: true })) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.kind === "directory") out.push(...(await walk(store, path)));
    else out.push(path);
  }
  return out;
};

const readFile = async (store: VaultStore, path: string) => {
  try {
    return await store.read(path);
  } catch (err) {
    if (err instanceof VaultWrongKindError) return undefined;
    throw err;
  }
};

/** Maps a directory in the tree to the nearest live folder at or above it (null = Unfiled). */
const folderLocator = async () => {
  const live = await getDb().select().from(documentFolder).where(isNull(documentFolder.deletedAt));
  const ctx = pathContext(live);
  const byDir = new Map<string, string>();
  for (const f of live) {
    const segments = folderSegments(f.id, ctx.folders, ctx.disk);
    if (segments) byDir.set(key(folderDir(segments)), f.id);
  }
  return (path: string): string | null => {
    for (let d = dirOf(path); d.includes("/"); d = dirOf(d)) {
      const id = byDir.get(key(d));
      if (id) return id;
    }
    return null;
  };
};

/** The name a file gives its document: the file name without its D2 date prefix. */
const nameFromFile = (path: string) =>
  validDocumentName(baseOf(path).replace(/^\d{4}-\d{2}-\d{2} (?=.)/, ""));

const NEXTCLOUD_CONFLICT = /^(.*) \(conflicted copy[^)]*\)(\.[^./]+)?$/;
const DRIVE_CONFLICT = /^(.*) \(1\)(\.[^./]+)$/;

/**
 * Old bytes for an outside edit (§ 6 table): kept under the § 2 copy rule, from `_fiscode/`
 * (already kept) or the pre-migration blob store (D9). False when this device has neither.
 */
const keepOverwrittenBytes = async (store: VaultStore, sha256: string): Promise<boolean> => {
  if (await store.resolveOldBytes(sha256)) return true;
  const blob = await store.get(sha256);
  if (!blob || (await sha256Hex(blob)) !== sha256) return false;
  await store.write(oldBytesPath("versions", sha256), blob);
  return true;
};

export type ScanProgress = { phase: "scanning"; done: number; total: number };

type ScanOptions = { onProgress?: (p: ScanProgress) => void; signal?: AbortSignal };

const scan = async (
  store: VaultStore,
  trigger: ScanTrigger,
  { onProgress, signal }: ScanOptions,
): Promise<ScanReport> => {
  await recoverVaultHeld();
  const files = await walk(store, "");
  const tmpRemoved: string[] = [];
  for (const f of files) {
    if (!isTmpName(baseOf(f))) continue;
    await store.remove(f);
    tmpRemoved.push(f);
  }
  const docFiles = files.filter(
    (f) => f.startsWith(`${VAULT_DOCUMENTS_DIR}/`) && !isTmpName(baseOf(f)),
  );

  const rows = (
    (await getDb().select().from(document).where(isNull(document.deletedAt))) as DocumentRow[]
  ).toSorted(byAdded);
  const rowAtPath = new Map(
    rows.filter((r) => r.vaultPath).map((r) => [key(r.vaultPath!), r] as const),
  );

  const claimed = new Set<string>();
  const shaOf = new Map<string, string>();
  const okRows: DocumentRow[] = [];
  const missing: ScanMissing[] = [];
  const displaced: {
    row: DocumentRow & { vaultPath: string };
    atPath?: Blob;
  }[] = [];
  // Cancel stops between files, before anything is recorded: nothing changed but temp files.
  const total = rows.length + docFiles.length;
  let done = 0;
  const step = () => {
    signal?.throwIfAborted();
    onProgress?.({ phase: "scanning", done: ++done, total });
  };
  signal?.throwIfAborted();
  for (const row of rows) {
    step();
    if (!row.vaultPath) {
      missing.push({ documentId: row.id, name: row.name, path: null });
      continue;
    }
    const blob = await readFile(store, row.vaultPath);
    const sha = blob ? await sha256Hex(blob) : undefined;
    if (sha) shaOf.set(key(row.vaultPath), sha);
    if (sha === row.sha256) {
      claimed.add(key(row.vaultPath));
      okRows.push(row);
    } else {
      displaced.push({
        row: row as DocumentRow & { vaultPath: string },
        ...(blob ? { atPath: blob } : {}),
      });
    }
  }

  // Hash only the files that could be a displaced row's: those of a size one of them has.
  const sizes = new Set(displaced.map((d) => d.row.sizeBytes));
  const candidates: { path: string; sha?: string }[] = [];
  for (const path of docFiles) {
    step();
    if (claimed.has(key(path))) continue;
    let sha = shaOf.get(key(path));
    if (!sha && sizes.size > 0) {
      const blob = await readFile(store, path);
      if (blob && sizes.has(blob.size)) sha = await sha256Hex(blob);
    }
    candidates.push({ path, ...(sha ? { sha } : {}) });
  }

  // Moves first, so a swap of two names reads as two moves, not two edits.
  const locate = await folderLocator();
  const moved: ScanMoved[] = [];
  const stillDisplaced: typeof displaced = [];
  for (const d of displaced) {
    const found = candidates.find(
      (c) =>
        c.sha === d.row.sha256 && !claimed.has(key(c.path)) && key(c.path) !== key(d.row.vaultPath),
    );
    if (!found) {
      stillDisplaced.push(d);
      continue;
    }
    claimed.add(key(found.path));
    moved.push({
      documentId: d.row.id,
      name: d.row.name,
      path: d.row.vaultPath,
      foundAt: found.path,
      sha256: d.row.sha256,
      adoptFolderId: locate(found.path),
    });
  }

  const edits: { row: DocumentRow; bytes: Blob; sha: string }[] = [];
  for (const d of stillDisplaced) {
    if (d.atPath && !claimed.has(key(d.row.vaultPath))) {
      claimed.add(key(d.row.vaultPath));
      edits.push({
        row: d.row,
        bytes: d.atPath,
        sha: shaOf.get(key(d.row.vaultPath))!,
      });
    } else {
      missing.push({
        documentId: d.row.id,
        name: d.row.name,
        path: d.row.vaultPath,
      });
    }
  }
  const changed = await recordEdits(store, edits);

  const onDisk = new Set(docFiles.map(key));
  const conflicts: ScanConflict[] = [];
  const unknown: ScanNewFile[] = [];
  for (const c of candidates) {
    if (claimed.has(key(c.path))) continue;
    const name = baseOf(c.path);
    const nc = NEXTCLOUD_CONFLICT.exec(name);
    const drive = DRIVE_CONFLICT.exec(name);
    if (nc) {
      const originalPath = `${dirOf(c.path)}/${nc[1]}${nc[2] ?? ""}`;
      const row = rowAtPath.get(key(originalPath));
      conflicts.push({
        path: c.path,
        originalPath: row?.vaultPath ?? originalPath,
        documentId: row?.id ?? null,
        kind: "nextcloud",
      });
      continue;
    }
    if (drive) {
      const originalPath = `${dirOf(c.path)}/${drive[1]}${drive[2]}`;
      const row = rowAtPath.get(key(originalPath));
      if (row && onDisk.has(key(originalPath))) {
        conflicts.push({
          path: c.path,
          originalPath: row.vaultPath!,
          documentId: row.id,
          kind: "drive",
        });
        continue;
      }
    }
    // Hidden files and types fiscode doesn't store (.docx, .DS_Store, Thumbs.db) are never listed.
    const mime = name.startsWith(".") ? undefined : documentMimeFor(name, "");
    if (!mime) continue;
    const blob = await readFile(store, c.path);
    if (!blob) continue;
    unknown.push({
      path: c.path,
      name,
      mime,
      sizeBytes: blob.size,
      folderId: locate(c.path),
    });
  }

  const dates = await linkedDates(okRows.map((r) => r.id));
  const redated: ScanRedated[] = [];
  for (const row of okRows) {
    const fileDate = fileDatePrefix(row.vaultPath);
    const expectedDate = documentDate(row.addedAt, dates.get(row.id) ?? []);
    if (fileDate && fileDate !== expectedDate) {
      redated.push({
        documentId: row.id,
        name: row.name,
        path: row.vaultPath!,
        fileDate,
        expectedDate,
      });
    }
  }

  return {
    status: "done",
    trigger,
    scannedAt: new Date().toISOString(),
    ok: okRows.length,
    moved: moved.toSorted(byPath),
    missing: missing.toSorted((a, b) => ((a.path ?? "") < (b.path ?? "") ? -1 : 1)),
    changed,
    unknown: unknown.toSorted(byPath),
    conflicts: conflicts.toSorted(byPath),
    redated: redated.toSorted(byPath),
    tmpRemoved: tmpRemoved.sort(),
  };
};

/**
 * Outside edits (§ 6 table): the bytes in the tree win. Old bytes go to `versions/` under the
 * copy rule, the new ones also to the by-sha store (the format 1 backup still reads by sha),
 * and the rows change with History in one transaction.
 */
const recordEdits = async (
  store: VaultStore,
  edits: { row: DocumentRow; bytes: Blob; sha: string }[],
): Promise<ScanChanged[]> => {
  if (edits.length === 0) return [];
  const out: ScanChanged[] = [];
  const queries: AtomicQuery[] = [];
  const at = new Date().toISOString();
  for (const { row, bytes, sha } of edits) {
    const oldBytesKept = await keepOverwrittenBytes(store, row.sha256);
    await store.put(sha, bytes);
    const next = { ...row, sha256: sha, sizeBytes: bytes.size, updatedAt: at };
    queries.push(
      getDb()
        .update(document)
        .set({ sha256: sha, sizeBytes: bytes.size, updatedAt: at })
        .where(eq(document.id, row.id)),
      historyQuery("document", row.id, "update", forHistory(row), forHistory(next)),
    );
    out.push({
      documentId: row.id,
      name: row.name,
      path: row.vaultPath!,
      fromSha256: row.sha256,
      toSha256: sha,
      oldBytesKept,
    });
  }
  await runTreeChangeHeld(async () => ({ queries, result: undefined }));
  return out.toSorted(byPath);
};

/**
 * Compare `documents/` with sqlite and return what differs (ADR § 6, § 11.4). Runs under the
 * fiscode-vault lock (§ 11.9):
 * - `check` (the "Check folder" button, the default) is a user action: VaultBusyError when
 *   another tab holds the vault;
 * - `boot` waits for the lock;
 * - `focus` is skipped while a long op runs in any tab, and otherwise waits. The UI debounces it.
 * Skipped until the migration is done. The report is kept for the badge (readLastScanReport).
 * `onProgress` and `signal` as for other long ops (§ 11.3): a cancel throws before anything is
 * recorded, so only leftover temp files may be gone.
 */
export const scanVault = async (
  options: { trigger?: ScanTrigger; locks?: LockManagerLike } & ScanOptions = {},
): Promise<ScanResult> => {
  const trigger = options.trigger ?? "check";
  const phase = getVaultMigrationState().phase;
  if (phase === "migrating" || phase === "migration-incomplete") {
    return { status: "skipped", reason: "migrating" };
  }
  if (trigger === "focus" && (await isLongVaultOpRunning(options.locks))) {
    return { status: "skipped", reason: "busy" };
  }
  const store = getVaultStore();
  const report = await withVaultLock(
    async () => {
      const r = await scan(store, trigger, options);
      await saveReport(r);
      return r;
    },
    {
      wait: trigger !== "check",
      ...(options.locks ? { locks: options.locks } : {}),
    },
  );
  if (report.changed.length > 0 || report.tmpRemoved.length > 0) announceVaultChange();
  return report;
};

// ─── Actions on a report (D6: ask each time, with "adopt all") ─────────────────

const liveRow = async (id: string): Promise<DocumentRow> => {
  const rows = (await getDb()
    .select()
    .from(document)
    .where(and(eq(document.id, id), isNull(document.deletedAt)))) as DocumentRow[];
  if (!rows[0]) throw new DocumentNotFoundError();
  return rows[0];
};

/** Throws VaultIntegrityError when the report is stale: `path` no longer holds `sha256`. */
const assertHolds = async (store: VaultStore, path: string, sha256: string) => {
  if (!(await store.holds(path, sha256))) throw new VaultIntegrityError(path);
};

const lenient = { strict: false, datesFor: linkedDates };

/**
 * Adopt (D6 a): each document takes the folder and name of the place it was moved to; the date
 * prefix and extension stay derived (§ 3), so the file may get its canonical name there. Pass
 * every `moved` entry for "adopt all": one tree change. Never refuses for length (§ 3.8): a file
 * that wouldn't fit stays where it was found. Throws VaultIntegrityError for a stale entry.
 */
export const adoptMoved = async (items: readonly ScanMoved[]): Promise<void> => {
  if (items.length === 0) return;
  const store = getVaultStore();
  const locate = await folderLocator();
  const changes: DocumentChange[] = [];
  const at = new Date().toISOString();
  for (const m of items) {
    const row = await liveRow(m.documentId);
    if (row.sha256 !== m.sha256) throw new VaultIntegrityError(m.foundAt);
    await assertHolds(store, m.foundAt, m.sha256);
    changes.push({
      next: {
        ...row,
        folderId: locate(m.foundAt),
        name: nameFromFile(m.foundAt),
        updatedAt: at,
      },
      from: m.foundAt,
      op: "update",
    });
  }
  await changeTree({ documents: changes }, lenient);
  await dropMoved(items);
};

/**
 * Move back (D6 b): each file goes back to the path sqlite has; no row changes. Throws
 * VaultNameTakenError when something else is there now, VaultIntegrityError for a stale entry.
 */
export const moveBack = async (items: readonly ScanMoved[]): Promise<void> => {
  if (items.length === 0) return;
  const store = getVaultStore();
  await runTreeChange(async (plan) => {
    for (const m of items) {
      const row = await liveRow(m.documentId);
      if (row.vaultPath !== m.path || row.sha256 !== m.sha256)
        throw new VaultIntegrityError(m.path);
      await assertHolds(store, m.foundAt, m.sha256);
      // Something else at the row's path now: never overwrite it.
      if ((await readFile(store, m.path)) !== undefined) throw new VaultNameTakenError(m.path);
      plan.ops.push({
        op: "move",
        from: m.foundAt,
        to: m.path,
        sha256: m.sha256,
      });
    }
    return { queries: [], result: undefined };
  });
  await dropMoved(items);
};

/**
 * Import "New in folder" files as documents, in the folder the report names. The file stays
 * where it is and takes its § 3 name there (moved, never copied). Throws DocumentTooLargeError,
 * DocumentNameInvalidError, VaultIntegrityError when the file is gone.
 */
export const importNewFiles = async (items: readonly ScanNewFile[]): Promise<DocumentRow[]> => {
  if (items.length === 0) return [];
  const store = getVaultStore();
  const locate = await folderLocator();
  const changes: DocumentChange[] = [];
  const at = new Date().toISOString();
  for (const u of items) {
    const bytes = await readFile(store, u.path);
    if (!bytes) throw new VaultIntegrityError(u.path);
    if (bytes.size > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError(u.name);
    const sha256 = await sha256Hex(bytes);
    // The format 1 backup still reads by sha, as for an upload.
    await store.put(sha256, bytes);
    changes.push({
      next: {
        id: newId(),
        folderId: (await folderIsLive(u.folderId)) ? u.folderId : locate(u.path),
        name: nameFromFile(u.path),
        mime: u.mime,
        sizeBytes: bytes.size,
        sha256,
        addedAt: at,
        notes: null,
        vaultPath: null,
        deletedAt: null,
        createdAt: at,
        updatedAt: at,
      },
      insert: true,
      from: u.path,
      op: "insert",
    });
  }
  const { documents } = await changeTree({ documents: changes }, lenient);
  const paths = new Set(items.map((u) => key(u.path)));
  await dropFromLastReport((r) => ({
    ...r,
    unknown: r.unknown.filter((u) => !paths.has(key(u.path))),
  }));
  return changes.map((c) => documents.get(c.next.id)!);
};

/**
 * Rename each file to the date D2 gives now (its linked record's date). Only the place changes:
 * no History row, as when a link changes. Throws VaultIntegrityError for a stale entry.
 */
export const applyRecordDates = async (items: readonly ScanRedated[]): Promise<void> => {
  if (items.length === 0) return;
  const rows = await Promise.all(items.map((r) => liveRow(r.documentId)));
  for (const [i, row] of rows.entries()) {
    if (row.vaultPath !== items[i]!.path) throw new VaultIntegrityError(items[i]!.path);
  }
  const dates = await linkedDates(rows.map((r) => r.id));
  await changeTree(
    {
      documents: rows.map((row) => ({
        next: row,
        placeOnly: true,
        dates: dates.get(row.id) ?? [],
        op: "update" as const,
      })),
    },
    lenient,
  );
  const ids = new Set(items.map((r) => r.documentId));
  await dropFromLastReport((r) => ({
    ...r,
    redated: r.redated.filter((x) => !ids.has(x.documentId)),
  }));
};
