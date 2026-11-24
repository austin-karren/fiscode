import {
  documentMimeFor,
  DocumentNotFoundError,
  DocumentTooLargeError,
  MAX_DOCUMENT_BYTES,
  MAX_FOLDER_DEPTH,
  newId,
  validFolderName,
  vaultFolderName,
  validDocumentName,
  VaultBusyError,
  VaultIntegrityError,
  VaultNameTakenError,
  VAULT_DOCUMENTS_DIR,
  VAULT_UNFILED_DIR,
} from "@fiscode/core";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type AtomicQuery } from "../client.ts";
import {
  document,
  documentFolder,
  meta,
  type DocumentFolderRow,
  type DocumentRow,
} from "../schema/index.ts";
import { isNotFound, type VaultDirHandle } from "../vault/dir.ts";
import { announceVaultChange, withVaultLock, type LockManagerLike } from "../vault/lock.ts";
import {
  byAdded,
  documentDate,
  folderDir,
  folderSegments,
  pathContext,
  type ShortenedFolder,
} from "../vault/paths.ts";
import { getVaultMigrationState } from "../vault/state.ts";
import {
  getVaultRoot,
  getVaultStore,
  isTmpName,
  oldBytesPath,
  sha256Hex,
  VaultWrongKindError,
  type VaultStore,
} from "../vault/store.ts";
import { historyQuery, recoverVaultHeld, runTreeChange, runTreeChangeHeld } from "../vault/tree.ts";
import {
  changeTree,
  forHistory,
  ownDatePrefix,
  type DocumentChange,
  type FolderChange,
} from "./document-tree.ts";
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
  /**
   * The folder adopting gives it: the deepest folder fiscode knows on `foundAt`'s path; null =
   * Unfiled (or, with `adoptNewFolders`, the top level).
   */
  adoptFolderId: string | null;
  /**
   * The folders made outside the app that adopting creates below `adoptFolderId`, top down
   * (D6 a: the document takes the folder it was moved to). Absent when there are none.
   */
  adoptNewFolders?: string[];
  /** Why adopting files it in Unfiled instead of the folder it was moved to (AdoptFallback). */
  adoptFallback?: AdoptFallback;
  /**
   * Set when `foundAt` is another row's own path (a swap or rotation of names outside the app).
   * Adopt every entry of the swap together ("adopt all"); move back refuses while the other
   * file is there.
   */
  swapped?: true;
};

/**
 * A row whose file is nowhere in `documents/`: the row shows "File not on this device", unless
 * `restorable`.
 */
export type ScanMissing = {
  documentId: string;
  name: string;
  path: string | null;
  /**
   * This device still has the bytes (`_fiscode/` versions or trash, the pre-migration blob store,
   * or another document with the same bytes) and nothing is at `path`: putBack writes it there.
   */
  restorable?: true;
};

/**
 * Why adopt can't create the folder a file was moved into, so it files it in Unfiled:
 * - `year`: a new top-level folder named like a year (year folders are fixed, § 5, D5);
 * - `name`: a folder name the vault would rewrite on disk (§ 3 sanitising) or refuses;
 * - `unfiled`: a folder inside Unfiled, which isn't a folder;
 * - `too-deep`: deeper than MAX_FOLDER_DEPTH.
 */
export type AdoptFallback = "year" | "name" | "unfiled" | "too-deep";

/** What adoptMoved did beyond moving rows: folders it made, shortened, or couldn't make. */
export type AdoptResult = {
  /** The folders it created, top down. */
  folders: DocumentFolderRow[];
  /** New folder names cut to the path budget (§ 3.8). */
  shortened: ShortenedFolder[];
  /** Files it put in Unfiled instead of the folder they were moved to, and why. */
  unfiled: { documentId: string; foundAt: string; reason: AdoptFallback }[];
};

/**
 * An outside edit, already recorded as a new version (History has it). It stays in every later
 * report until acknowledgeChanged; edited again before that, it keeps its first `fromSha256`.
 */
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

/**
 * A displaced row's sha at two or more paths: which one is the move can't be told, so none is
 * offered. The page lists the row and every path; the user imports or deletes by hand.
 */
export type ScanAmbiguous = {
  documentId: string;
  name: string;
  path: string;
  sha256: string;
  foundAt: string[];
};

/** An outside edit over the 25 MB cap: not recorded, the row keeps its old bytes' sha. */
export type ScanTooLarge = {
  documentId: string;
  name: string;
  path: string;
  sizeBytes: number;
};

export type ScanTrigger = "boot" | "focus" | "check";

export type ScanReport = {
  status: "done";
  trigger: ScanTrigger;
  scannedAt: string;
  /** Rows whose path holds their sha256. */
  ok: number;
  moved: ScanMoved[];
  ambiguous: ScanAmbiguous[];
  missing: ScanMissing[];
  changed: ScanChanged[];
  tooLarge: ScanTooLarge[];
  unknown: ScanNewFile[];
  conflicts: ScanConflict[];
  redated: ScanRedated[];
  /** Leftover temp files of a crashed write, deleted by this scan. */
  tmpRemoved: string[];
};

/**
 * `migrating`: the vault isn't built yet, so there is nothing to compare. `busy`: a focus scan
 * found the vault held in some tab (§ 11.4: skipped, not queued; the next focus scans again).
 */
export type ScanResult = ScanReport | { status: "skipped"; reason: "migrating" | "busy" };

export const SCAN_REPORT_KEY = "vault_scan_report";

/**
 * The badge count on Documents ("3 to review"). Every edit and move counts, `changed` included:
 * it is recorded already, but the user should see it until they dismiss it (acknowledgeChanged).
 */
export const scanReviewCount = (r: ScanReport) =>
  r.moved.length +
  r.changed.length +
  r.ambiguous.length +
  r.tooLarge.length +
  r.missing.length +
  r.unknown.length +
  r.conflicts.length +
  r.redated.length;

/** The last scan's report, less what the actions since have handled. */
export const readLastScanReport = async (): Promise<ScanReport | undefined> => {
  const rows = await getDb().select().from(meta).where(eq(meta.key, SCAN_REPORT_KEY)).limit(1);
  if (!rows[0]) return undefined;
  // A report saved before `ambiguous` and `tooLarge` existed has neither.
  const saved = JSON.parse(rows[0].value) as Partial<ScanReport> &
    Omit<ScanReport, "ambiguous" | "tooLarge">;
  return { ...saved, ambiguous: saved.ambiguous ?? [], tooLarge: saved.tooLarge ?? [] };
};

const saveReport = (r: ScanReport) => {
  const value = JSON.stringify(r);
  return getDb()
    .insert(meta)
    .values({ key: SCAN_REPORT_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
};

/**
 * Under the vault lock, which a scan holds from reading the last report's `changed` to saving
 * its own: unlocked, a scan in another tab would save back an edit acknowledged meanwhile.
 * Waits its turn: it is short, and the action before it has finished.
 */
const dropFromLastReport = (
  edit: (r: ScanReport) => ScanReport,
  options: { locks?: LockManagerLike } = {},
) =>
  withVaultLock(
    async () => {
      const last = await readLastScanReport();
      if (last) await saveReport(edit(last));
    },
    { wait: true, ...(options.locks ? { locks: options.locks } : {}) },
  );

const dropMoved = (items: readonly ScanMoved[]) => {
  const ids = new Set(items.map((m) => m.documentId));
  return dropFromLastReport((r) => ({
    ...r,
    moved: r.moved.filter((m) => !ids.has(m.documentId)),
  }));
};

/** Carry the last report's unacknowledged edits into this one, for documents still live. */
const carryChanged = (
  before: readonly ScanChanged[],
  now: readonly ScanChanged[],
  live: ReadonlySet<string>,
): ScanChanged[] => {
  const out = new Map(before.filter((c) => live.has(c.documentId)).map((c) => [c.documentId, c]));
  for (const c of now) {
    const prev = out.get(c.documentId);
    out.set(
      c.documentId,
      prev
        ? { ...c, fromSha256: prev.fromSha256, oldBytesKept: prev.oldBytesKept && c.oldBytesKept }
        : c,
    );
  }
  return [...out.values()].toSorted(byPath);
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

type AdoptPlace = {
  folderId: string | null;
  newFolders?: string[];
  fallback?: AdoptFallback;
};

/**
 * Where adopt files a document found at a path (D6 a): the folder of that place. Known folders
 * are matched by disk name, then by name without case or accents (§ 4: one folder, not a
 * sibling); the rest are folders to create, unless a rule forbids it (AdoptFallback).
 */
const adoptPlacer = (live: readonly DocumentFolderRow[]) => {
  const ctx = pathContext(live);
  const depthOf = (id: string | null) => {
    let n = 0;
    for (let at = id; at !== null; at = ctx.folders.get(at)?.parentId ?? null) n++;
    return n;
  };
  const child = (parentId: string | null, segment: string) => {
    const siblings = live.filter((f) => (f.parentId ?? null) === parentId);
    return (
      siblings.find((f) => key(ctx.disk.get(f.id) ?? "") === key(segment)) ??
      siblings.find((f) => f.name.localeCompare(segment, "en", { sensitivity: "base" }) === 0)
    );
  };
  const validSegment = (s: string) => {
    try {
      return validFolderName(s) === s && vaultFolderName(s) === s;
    } catch {
      return false;
    }
  };
  return (foundAt: string): AdoptPlace => {
    const segments = dirOf(foundAt).split("/").slice(1);
    if (segments.length === 0) return { folderId: null };
    if (key(segments[0]!) === key(VAULT_UNFILED_DIR)) {
      return segments.length === 1 ? { folderId: null } : { folderId: null, fallback: "unfiled" };
    }
    let parentId: string | null = null;
    let i = 0;
    for (; i < segments.length; i++) {
      const f = child(parentId, segments[i]!);
      if (!f) break;
      parentId = f.id;
    }
    const rest = segments.slice(i);
    if (rest.length === 0) return { folderId: parentId };
    const fallback: AdoptFallback | undefined =
      parentId === null && /^\d{4}$/.test(rest[0]!)
        ? "year"
        : !rest.every(validSegment)
          ? "name"
          : depthOf(parentId) + rest.length > MAX_FOLDER_DEPTH
            ? "too-deep"
            : undefined;
    return fallback ? { folderId: null, fallback } : { folderId: parentId, newFolders: rest };
  };
};

const liveFolderRows = async () =>
  (await getDb()
    .select()
    .from(documentFolder)
    .where(isNull(documentFolder.deletedAt))) as DocumentFolderRow[];

const adoptFields = (p: AdoptPlace) => ({
  adoptFolderId: p.folderId,
  ...(p.newFolders ? { adoptNewFolders: p.newFolders } : {}),
  ...(p.fallback ? { adoptFallback: p.fallback } : {}),
});

/** The name a file gives its document: the file name without its D2 date prefix. */
const nameFromFile = (path: string) =>
  validDocumentName(baseOf(path).replace(/^\d{4}-\d{2}-\d{2} (?=.)/, ""));

// ─── Hash cache (S1) ───────────────────────────────────────────────────────────
// The last scan's {size, lastModified, sha256} per path, in OPFS beside the journal (never in
// the vault, never in sqlite). A focus scan trusts it only to confirm a row is ok: a cached sha
// that differs from the row's is hashed again, so a stale entry can't fake an outside edit.

export const SCAN_CACHE_FILE = "vault-scan-cache.json";

type CacheEntry = { size: number; mtime: number; sha: string };
type HashCache = Record<string, CacheEntry>;

const readCache = async (root: VaultDirHandle): Promise<HashCache> => {
  try {
    const f = await (await root.getFileHandle(SCAN_CACHE_FILE)).getFile();
    return JSON.parse(await f.text()) as HashCache;
  } catch (err) {
    if (isNotFound(err) || err instanceof SyntaxError) return {};
    throw err;
  }
};

const writeCache = async (root: VaultDirHandle, cache: HashCache) => {
  const w = await (await root.getFileHandle(SCAN_CACHE_FILE, { create: true })).createWritable();
  await w.write(new Blob([JSON.stringify(cache)], { type: "application/json" }));
  await w.close();
};

const mtimeOf = (blob: Blob): number | undefined =>
  "lastModified" in blob && typeof blob.lastModified === "number" ? blob.lastModified : undefined;

const NEXTCLOUD_CONFLICT = /^(.*) \(conflicted copy[^)]*\)(\.[^./]+)?$/;
const DRIVE_CONFLICT = /^(.*) \(1\)(\.[^./]+)$/;

/** A sync client's conflict copy is never a move target, even when it holds the row's sha (B1). */
const looksLikeConflict = (path: string) => {
  const name = baseOf(path);
  return NEXTCLOUD_CONFLICT.test(name) || DRIVE_CONFLICT.test(name) || isTmpName(name);
};

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

/** Whether this device has `sha256`'s bytes anywhere a put back can copy them from. */
const hasBytes = async (store: VaultStore, sha256: string, okRows: readonly DocumentRow[]) => {
  if (okRows.some((r) => r.sha256 === sha256)) return true;
  if (await store.resolveOldBytes(sha256)) return true;
  // Not hashed here (every scan, every missing row): putBack verifies the bytes it copies.
  return store.has(sha256);
};

export type ScanProgress = { phase: "scanning"; done: number; total: number };

type ScanOptions = { onProgress?: (p: ScanProgress) => void; signal?: AbortSignal };

const scan = async (
  store: VaultStore,
  trigger: ScanTrigger,
  { onProgress, signal }: ScanOptions,
): Promise<ScanReport> => {
  await recoverVaultHeld();
  const root = getVaultRoot();
  const prev = await readCache(root);
  const cache: HashCache = {};
  // "Check folder" and boot hash every byte; focus hashes only what changed size or mtime.
  const trustCache = trigger === "focus";
  const hash = async (path: string, blob: Blob, rowSha?: string) => {
    const mtime = mtimeOf(blob);
    const hit = prev[key(path)];
    const sha =
      trustCache &&
      hit &&
      mtime !== undefined &&
      hit.size === blob.size &&
      hit.mtime === mtime &&
      (rowSha === undefined || hit.sha === rowSha)
        ? hit.sha
        : await sha256Hex(blob);
    if (mtime !== undefined) cache[key(path)] = { size: blob.size, mtime, sha };
    return sha;
  };
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
    const sha = blob ? await hash(row.vaultPath, blob, row.sha256) : undefined;
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
      if (blob && sizes.has(blob.size)) sha = await hash(path, blob);
    }
    candidates.push({ path, ...(sha ? { sha } : {}) });
  }

  // B1: the row's own path first. A file there with another sha is an outside edit, never a
  // move, even when its old bytes turn up elsewhere (a conflict copy usually holds them).
  const locate = await folderLocator();
  const place = adoptPlacer(await liveFolderRows());
  const moved: ScanMoved[] = [];
  const ambiguous: ScanAmbiguous[] = [];

  // S2: swaps first. A row's own path holding the sha of another displaced row whose own path
  // still has a file is that row moved there (a swap or rotation of names), never an outside
  // edit: recording it would silently link each document to the other's bytes.
  const withFile = displaced.filter((d) => d.atPath);
  const swapIn = new Map<string, string[]>(); // row id → the displaced own paths holding its sha
  const taken = new Set<string>(); // row ids whose own path holds another row's file
  for (const d of withFile) {
    const sha = shaOf.get(key(d.row.vaultPath));
    const from = withFile.filter((q) => q !== d && q.row.sha256 === sha);
    if (from.length !== 1) continue;
    const q = from[0]!;
    swapIn.set(q.row.id, [...(swapIn.get(q.row.id) ?? []), d.row.vaultPath]);
    taken.add(d.row.id);
  }
  for (const d of withFile) {
    const found = swapIn.get(d.row.id);
    if (!found) continue;
    if (found.length > 1) {
      ambiguous.push({
        documentId: d.row.id,
        name: d.row.name,
        path: d.row.vaultPath,
        sha256: d.row.sha256,
        foundAt: found.toSorted(),
      });
      continue;
    }
    moved.push({
      documentId: d.row.id,
      name: d.row.name,
      path: d.row.vaultPath,
      foundAt: found[0]!,
      sha256: d.row.sha256,
      ...adoptFields(place(found[0]!)),
      swapped: true,
    });
  }

  const edits: { row: DocumentRow; bytes: Blob; sha: string }[] = [];
  const tooLarge: ScanTooLarge[] = [];
  const gone: typeof displaced = [];
  for (const d of displaced) {
    const isTaken = taken.has(d.row.id);
    const isSwapped = swapIn.has(d.row.id);
    // A row moved by a swap whose own path holds unknown bytes (an edit after the swap): that
    // file stays unclaimed, so it shows as new in folder rather than as anyone's version.
    if (d.atPath && (isTaken || !isSwapped)) claimed.add(key(d.row.vaultPath));
    if (isSwapped) continue;
    // No file at its path, or another row's file there: its own bytes may be elsewhere.
    if (!d.atPath || isTaken) {
      gone.push(d);
      continue;
    }
    if (d.atPath.size > MAX_DOCUMENT_BYTES) {
      tooLarge.push({
        documentId: d.row.id,
        name: d.row.name,
        path: d.row.vaultPath,
        sizeBytes: d.atPath.size,
      });
      continue;
    }
    edits.push({ row: d.row, bytes: d.atPath, sha: shaOf.get(key(d.row.vaultPath))! });
  }

  // Then moves: the row's sha at exactly one other path that isn't a conflict copy.
  for (const d of gone) {
    const found = candidates.filter(
      (c) => c.sha === d.row.sha256 && !claimed.has(key(c.path)) && !looksLikeConflict(c.path),
    );
    if (found.length === 0) {
      const restorable =
        !d.atPath && (await hasBytes(store, d.row.sha256, okRows))
          ? { restorable: true as const }
          : {};
      missing.push({
        documentId: d.row.id,
        name: d.row.name,
        path: d.row.vaultPath,
        ...restorable,
      });
      continue;
    }
    for (const f of found) claimed.add(key(f.path));
    if (found.length > 1) {
      ambiguous.push({
        documentId: d.row.id,
        name: d.row.name,
        path: d.row.vaultPath,
        sha256: d.row.sha256,
        foundAt: found.map((f) => f.path).sort(),
      });
      continue;
    }
    moved.push({
      documentId: d.row.id,
      name: d.row.name,
      path: d.row.vaultPath,
      foundAt: found[0]!.path,
      sha256: d.row.sha256,
      ...adoptFields(place(found[0]!.path)),
    });
  }
  const changed = carryChanged(
    (await readLastScanReport())?.changed ?? [],
    await recordEdits(store, edits),
    new Set(rows.map((r) => r.id)),
  );
  signal?.throwIfAborted();

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
    const fileDate = ownDatePrefix(row);
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

  await writeCache(root, cache);
  return {
    status: "done",
    trigger,
    scannedAt: new Date().toISOString(),
    ok: okRows.length,
    moved: moved.toSorted(byPath),
    ambiguous: ambiguous.toSorted(byPath),
    missing: missing.toSorted((a, b) => ((a.path ?? "") < (b.path ?? "") ? -1 : 1)),
    changed,
    tooLarge: tooLarge.toSorted(byPath),
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
 * - `focus` takes the lock with ifAvailable and is skipped when any tab holds it (never queued
 *   behind a long op); it hashes only files whose size or mtime changed. The UI debounces it.
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
  const store = getVaultStore();
  let report: ScanReport;
  try {
    report = await withVaultLock(
      async () => {
        const r = await scan(store, trigger, options);
        await saveReport(r);
        return r;
      },
      {
        wait: trigger === "boot",
        ...(options.locks ? { locks: options.locks } : {}),
      },
    );
  } catch (err) {
    if (trigger === "focus" && err instanceof VaultBusyError) {
      return { status: "skipped", reason: "busy" };
    }
    throw err;
  }
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
export const adoptMoved = async (items: readonly ScanMoved[]): Promise<AdoptResult> => {
  const out: AdoptResult = { folders: [], shortened: [], unfiled: [] };
  if (items.length === 0) return out;
  const store = getVaultStore();
  const live = await liveFolderRows();
  const place = adoptPlacer(live);
  const changes: DocumentChange[] = [];
  const folders: FolderChange[] = [];
  // Each new folder once, by parent and name: "adopt all" of two files in one new folder makes one.
  const made = new Map<string, DocumentFolderRow>();
  const at = new Date().toISOString();
  for (const m of items) {
    const row = await liveRow(m.documentId);
    if (row.sha256 !== m.sha256) throw new VaultIntegrityError(m.foundAt);
    await assertHolds(store, m.foundAt, m.sha256);
    const p = place(m.foundAt);
    if (p.fallback)
      out.unfiled.push({ documentId: m.documentId, foundAt: m.foundAt, reason: p.fallback });
    let folderId = p.folderId;
    for (const name of p.newFolders ?? []) {
      const slot = `${folderId}/${key(name)}`;
      let f = made.get(slot);
      if (!f) {
        const parent = [...live, ...made.values()].find((x) => x.id === folderId);
        f = {
          id: newId(),
          name,
          parentId: folderId,
          taxYear: parent?.taxYear ?? null,
          sortOrder: 0,
          defaultKey: null,
          deletedAt: null,
          createdAt: at,
          updatedAt: at,
        };
        made.set(slot, f);
        folders.push({ next: f, insert: true, op: "insert" });
      }
      folderId = f.id;
    }
    changes.push({
      next: { ...row, folderId, name: nameFromFile(m.foundAt), updatedAt: at },
      from: m.foundAt,
      op: "update",
    });
  }
  const result = await changeTree({ folders, documents: changes }, lenient);
  await dropMoved(items);
  out.folders = folders.map((c) => result.folders.get(c.next.id) ?? c.next);
  out.shortened = result.shortened;
  return out;
};

/**
 * Put back (a restorable `missing` entry): copy the bytes this device still has to the row's
 * path, journaled; no row changes. Throws VaultNameTakenError when something is there now,
 * VaultIntegrityError for a stale entry or when the bytes are gone.
 */
export const putBack = async (items: readonly ScanMissing[]): Promise<void> => {
  if (items.length === 0) return;
  const store = getVaultStore();
  await runTreeChange(async (plan) => {
    for (const m of items) {
      const row = await liveRow(m.documentId);
      if (!m.path || row.vaultPath !== m.path) throw new VaultIntegrityError(m.path ?? m.name);
      if ((await readFile(store, m.path)) !== undefined) throw new VaultNameTakenError(m.path);
      let from = await plan.source(row.sha256);
      if (!from) {
        // The pre-migration blob store (D9) isn't a vault path: stage its bytes for the copy.
        const blob = await store.get(row.sha256);
        if (!blob || (await sha256Hex(blob)) !== row.sha256) throw new VaultIntegrityError(m.path);
        from = await plan.stage(blob);
      }
      plan.ops.push({ op: "copy", from, to: m.path, sha256: row.sha256 });
    }
    return { queries: [], result: undefined };
  });
  const ids = new Set(items.map((m) => m.documentId));
  await dropFromLastReport((r) => ({
    ...r,
    missing: r.missing.filter((m) => !ids.has(m.documentId)),
  }));
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
 * Dismiss outside edits from the badge: they are recorded already (History has them). Until
 * then each stays in every later report. Pass the entries to dismiss, or "all".
 */
export const acknowledgeChanged = (
  items: readonly ScanChanged[] | "all",
  options: { locks?: LockManagerLike } = {},
): Promise<void> => {
  const ids = items === "all" ? undefined : new Set(items.map((c) => c.documentId));
  return dropFromLastReport(
    (r) => ({
      ...r,
      changed: ids ? r.changed.filter((c) => !ids.has(c.documentId)) : [],
    }),
    options,
  );
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
