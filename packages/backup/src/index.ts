import {
  BackupBytesMissingError,
  BackupFileCorruptError,
  BackupManifestError,
  BackupNotAZipError,
  BackupTooNewError,
  BackupUnexpectedFileError,
} from "@fiscode/core";
import {
  CSV_SCHEMA_VERSION,
  exportBundle,
  exportFileName,
  planImport,
  readImportFile,
  type Bundle,
  type ImportFile,
  type ImportPlan,
} from "@fiscode/csv";
// Subpaths, not "@fiscode/db": its index loads boot.ts, which needs Vite (import.meta.glob), and
// the headless script runs under plain Bun.
import { getBlobStore, sha256Hex, type BlobStore } from "@fiscode/db/blob-store";
import { buildBundle, importBundle } from "@fiscode/db/repo";
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from "fflate";

// The full backup bundle (contract: d-data drafts/contract-backup.md, with d-data's rulings).
// One zip: manifest.json, the canonical CSV (full scope: deleted rows and history) and every
// document's bytes, each sha256 once. Live documents sit at their folder path for people; every
// other blob a row or a history snapshot references sits at documents/.versions/<sha256>. The
// zip is deterministic: the same state and `createdAt` give the same bytes. Restore checks every
// file before writing anything. No encryption in v1 (d-data ruling).

export const BACKUP_FORMAT = "fiscode-backup";
export const BACKUP_FORMAT_VERSION = 1;

export type BackupManifestFile = {
  path: string;
  sha256: string;
  sizeBytes: number;
  /** Every document (any state) whose bytes these are. */
  documentIds: string[];
};

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  app: { csvSchema: string; build: string };
  csv: { path: string; sha256: string; sizeBytes: number };
  documents: BackupManifestFile[];
  /**
   * Blobs a row or snapshot references that this device didn't have when the backup was made
   * (e.g. after a CSV-only restore). Listed so a restore knows they are expected to be absent.
   */
  missing: { sha256: string; documentIds: string[] }[];
  counts: {
    rows: number;
    deletedRows: number;
    historyEntries: number;
    documents: number;
    blobs: number;
  };
};

export type BackupProgress = {
  phase: "reading" | "checking" | "zipping" | "writing";
  done: number;
  total: number;
};
type ProgressFn = (p: BackupProgress) => void;

/** `fiscode-backup-<YYYY-MM-DD>.zip`. */
export const backupFileName = (date: string): string => `fiscode-backup-${date}.zip`;

// A fixed modification time for every entry (local noon on the zip epoch, so no timezone or DST
// shift moves the DOS date), for byte-identical zips.
const ZIP_MTIME = new Date(1980, 0, 1, 12, 0, 0);

/** Bytes as a Blob part (fflate's arrays are plain ArrayBuffer-backed). */
const part = (bytes: Uint8Array): ArrayBuffer => bytes as unknown as ArrayBuffer;

const ROW_TABLES = [
  "entities",
  "spouses",
  "clients",
  "income",
  "timeEntries",
  "vehicles",
  "mileage",
  "homeOffice",
  "expenses",
  "retirementContributions",
  "w2Jobs",
  "estimatedPayments",
  "documentFolders",
  "documents",
  "documentLinks",
] as const satisfies readonly (keyof Bundle)[];

const countBundle = (b: Bundle) => {
  let rows = b.profile ? 1 : 0;
  let deletedRows = 0;
  for (const t of ROW_TABLES) {
    for (const r of b[t] as { deletedAt: string | null }[]) {
      if (r.deletedAt === null) rows++;
      else deletedRows++;
    }
  }
  return { rows, deletedRows, historyEntries: b.history.length };
};

const parse = (json: string | null): unknown => {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
};

/**
 * Every blob sha256 the bundle references, with the documents that reference it: document rows
 * (any state), document history snapshots (older versions), and import snapshots' documents.
 */
export const referencedBlobs = (bundle: Bundle): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  const add = (sha: unknown, docId: unknown) => {
    if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) return;
    const ids = out.get(sha) ?? new Set<string>();
    if (typeof docId === "string") ids.add(docId);
    out.set(sha, ids);
  };
  for (const d of bundle.documents) add(d.sha256, d.id);
  for (const h of bundle.history) {
    if (h.entity === "document") {
      for (const snap of [parse(h.beforeJson), parse(h.afterJson)] as {
        sha256?: unknown;
        id?: unknown;
      }[]) {
        if (snap) add(snap.sha256, snap.id);
      }
    } else if (h.entity === "__import_snapshot") {
      for (const snap of [parse(h.beforeJson), parse(h.afterJson)] as { documents?: unknown }[]) {
        if (snap && Array.isArray(snap.documents)) {
          for (const d of snap.documents as { sha256?: unknown; id?: unknown }[])
            add(d.sha256, d.id);
        }
      }
    }
  }
  return out;
};

/** A path segment safe in a zip: no separators, no "..", no control characters. */
const safeSegment = (name: string): string => {
  const cleaned = [...name]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch !== "/" && ch !== "\\")
    .join("")
    .trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "_" : cleaned;
};

/** "name (2).pdf": the number before the extension. */
const numbered = (name: string, n: number): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
};

/** Where each live document's bytes go for people: documents/<folder path>/<name>. */
const humanPaths = (bundle: Bundle): Map<string, string> => {
  const folders = new Map(
    bundle.documentFolders.filter((f) => f.deletedAt === null).map((f) => [f.id, f]),
  );
  const folderPath = (id: string | null): string | undefined => {
    if (id === null) return "Unfiled";
    const parts: string[] = [];
    for (let at: string | null = id; at !== null;) {
      const f = folders.get(at);
      if (!f) return undefined; // a folder in the chain is gone: not a live place
      parts.unshift(safeSegment(f.name));
      at = f.parentId;
    }
    return parts.join("/");
  };
  const used = new Set<string>();
  const out = new Map<string, string>();
  const live = bundle.documents
    .filter((d) => d.deletedAt === null)
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const d of live) {
    const dir = folderPath(d.folderId);
    if (dir === undefined) continue;
    const name = safeSegment(d.name);
    let path = `documents/${dir}/${name}`;
    for (let n = 2; used.has(path.toLowerCase()); n++)
      path = `documents/${dir}/${numbered(name, n)}`;
    used.add(path.toLowerCase());
    out.set(d.id, path);
  }
  return out;
};

/**
 * The backup zip for `bundle` (the whole state: deleted rows and history) with bytes from
 * `store`. Pure apart from reading the store: the app and the headless script both use it.
 */
export const buildBackupZip = async (
  bundle: Bundle,
  store: BlobStore,
  options: { createdAt: string; build?: string; onProgress?: ProgressFn },
): Promise<{ bytes: Uint8Array; manifest: BackupManifest; fileName: string }> => {
  const date = options.createdAt.slice(0, 10);
  const csvText = exportBundle(bundle, { scope: "full" });
  const csvBytes = strToU8(csvText);
  const csvPath = exportFileName({ scope: "full" }, date);
  const refs = referencedBlobs(bundle);
  const paths = humanPaths(bundle);

  // Each sha once: at the first live document's path (by id) that has it, else under .versions.
  const shaPath = new Map<string, string>();
  for (const [docId, path] of [...paths].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const sha = bundle.documents.find((d) => d.id === docId)!.sha256;
    if (!shaPath.has(sha)) shaPath.set(sha, path);
  }
  const files: Zippable = {};
  const documents: BackupManifestFile[] = [];
  const missing: BackupManifest["missing"] = [];
  const shas = [...refs.keys()].toSorted();
  let done = 0;
  for (const sha of shas) {
    options.onProgress?.({ phase: "zipping", done: done++, total: shas.length });
    const blob = await store.get(sha);
    const documentIds = [...refs.get(sha)!].toSorted();
    if (!blob) {
      missing.push({ sha256: sha, documentIds });
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const path = shaPath.get(sha) ?? `documents/.versions/${sha}`;
    documents.push({ path, sha256: sha, sizeBytes: bytes.length, documentIds });
    files[path] = [bytes, { level: 0, mtime: ZIP_MTIME }];
  }
  documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  options.onProgress?.({ phase: "zipping", done: shas.length, total: shas.length });

  const counts = countBundle(bundle);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: options.createdAt,
    app: { csvSchema: CSV_SCHEMA_VERSION, build: options.build ?? "dev" },
    csv: {
      path: csvPath,
      sha256: await sha256Hex(new Blob([part(csvBytes)])),
      sizeBytes: csvBytes.length,
    },
    documents,
    missing,
    counts: {
      ...counts,
      documents: bundle.documents.length,
      blobs: documents.length,
    },
  };
  // Entry order is the object's key order: manifest, CSV, then documents by path.
  const zip: Zippable = {
    "manifest.json": [
      strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
      { level: 6, mtime: ZIP_MTIME },
    ],
    [csvPath]: [csvBytes, { level: 6, mtime: ZIP_MTIME }],
  };
  for (const d of documents) zip[d.path] = files[d.path]!;
  return { bytes: zipSync(zip), manifest, fileName: backupFileName(date) };
};

/** "Back up everything": the whole state of this app as one zip. */
export const createBackup = async (
  options: { createdAt?: string; build?: string; onProgress?: ProgressFn } = {},
): Promise<{ blob: Blob; fileName: string; manifest: BackupManifest }> => {
  options.onProgress?.({ phase: "reading", done: 0, total: 1 });
  const bundle = await buildBundle({ includeDeleted: true, includeHistory: true });
  options.onProgress?.({ phase: "reading", done: 1, total: 1 });
  const { bytes, manifest, fileName } = await buildBackupZip(bundle, getBlobStore(), {
    createdAt: options.createdAt ?? new Date().toISOString(),
    build: options.build,
    onProgress: options.onProgress,
  });
  return { blob: new Blob([part(bytes)], { type: "application/zip" }), fileName, manifest };
};

export type BackupFile =
  | {
      ok: true;
      manifest: BackupManifest;
      bundle: Bundle;
      /** The CSV as read (the import's view of it). */
      file: Extract<ImportFile, { ok: true }>;
      /** The bytes to write, by sha256. */
      blobs: Map<string, Uint8Array>;
      documents: { files: number; bytes: number };
      /**
       * Files the backup lists as missing (the device that made it didn't have them), with the
       * names of the documents that use them, for the dialog. Their rows restore without bytes.
       */
      missing: { sha256: string; documentIds: string[]; names: string[] }[];
    }
  | Extract<ImportFile, { ok: false }>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFileEntry = (v: unknown): boolean =>
  isRecord(v) &&
  typeof v.path === "string" &&
  typeof v.sha256 === "string" &&
  typeof v.sizeBytes === "number" &&
  Array.isArray(v.documentIds);

/** The manifest's shape, or a BackupManifestError saying what is wrong with it. */
const validManifest = (raw: unknown): BackupManifest => {
  const bad = (reason: string): never => {
    throw new BackupManifestError(reason);
  };
  if (!isRecord(raw)) return bad("manifest.json isn't an object");
  if (raw.format !== BACKUP_FORMAT) bad("manifest.json isn't a fiscode backup's");
  const v = raw.formatVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    bad("its format version isn't a whole number of 1 or more");
  }
  if ((v as number) > BACKUP_FORMAT_VERSION) throw new BackupTooNewError(v as number);
  if (typeof raw.createdAt !== "string") bad("it has no creation time");
  const csv = raw.csv;
  if (
    !isRecord(csv) ||
    typeof csv.path !== "string" ||
    typeof csv.sha256 !== "string" ||
    typeof csv.sizeBytes !== "number"
  ) {
    bad("it doesn't say which file is the CSV");
  }
  if (!Array.isArray(raw.documents) || !raw.documents.every(isFileEntry)) {
    bad("its list of files is damaged");
  }
  const missing = raw.missing ?? [];
  if (
    !Array.isArray(missing) ||
    !missing.every(
      (m) => isRecord(m) && typeof m.sha256 === "string" && Array.isArray(m.documentIds),
    )
  ) {
    bad("its list of missing files is damaged");
  }
  const counts = raw.counts;
  if (!isRecord(counts) || counts.blobs !== (raw.documents as unknown[]).length) {
    bad("its file count doesn't match its list of files");
  }
  if (!isRecord(raw.app)) bad("it doesn't say which app made it");
  return { ...(raw as BackupManifest), missing: missing as BackupManifest["missing"] };
};

/**
 * Read and check a backup. Throws a BackupError when it isn't a backup, is from a newer app, has
 * a damaged manifest or file, a file the manifest doesn't list, or lacks bytes it doesn't declare
 * missing. A CSV the importer refuses comes back as `ok: false`, as for an import. Writes nothing.
 */
export const readBackup = async (
  file: Blob,
  options: { onProgress?: ProgressFn } = {},
): Promise<BackupFile> => {
  const raw = new Uint8Array(await file.arrayBuffer());
  if (raw.length < 4 || raw[0] !== 0x50 || raw[1] !== 0x4b) throw new BackupNotAZipError();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(raw);
  } catch {
    throw new BackupNotAZipError();
  }
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new BackupManifestError("it has no manifest.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new BackupManifestError("manifest.json isn't valid JSON");
  }
  const manifest = validManifest(parsed);

  // Every file in the zip is one the manifest lists (directory entries aside).
  const listed = new Set([
    "manifest.json",
    manifest.csv.path,
    ...manifest.documents.map((d) => d.path),
  ]);
  for (const path of Object.keys(entries)) {
    if (!path.endsWith("/") && !listed.has(path)) throw new BackupUnexpectedFileError(path);
  }

  const check = async (path: string, sha: string, size: number): Promise<Uint8Array> => {
    const bytes = entries[path];
    if (!bytes || bytes.length !== size || (await sha256Hex(new Blob([part(bytes)]))) !== sha) {
      throw new BackupFileCorruptError(path);
    }
    return bytes;
  };
  const total = 1 + manifest.documents.length;
  options.onProgress?.({ phase: "checking", done: 0, total });
  const csvBytes = await check(manifest.csv.path, manifest.csv.sha256, manifest.csv.sizeBytes);
  const blobs = new Map<string, Uint8Array>();
  let done = 1;
  for (const d of manifest.documents) {
    options.onProgress?.({ phase: "checking", done: done++, total });
    blobs.set(d.sha256, await check(d.path, d.sha256, d.sizeBytes));
  }
  options.onProgress?.({ phase: "checking", done: total, total });

  const read = readImportFile(strFromU8(csvBytes));
  if (!read.ok) return read;
  // Every blob the data references (rows, document history, import snapshots) is in the zip or
  // declared missing (review #85 r1).
  const declared = new Set(manifest.missing.map((m) => m.sha256));
  const names = new Map(read.bundle.documents.map((d) => [d.id, d.name]));
  for (const [sha, ids] of referencedBlobs(read.bundle)) {
    if (blobs.has(sha) || declared.has(sha)) continue;
    const name = [...ids].map((id) => names.get(id)).find(Boolean);
    throw new BackupBytesMissingError(name ?? `an older version (${sha.slice(0, 12)})`);
  }
  return {
    ok: true,
    manifest,
    bundle: read.bundle,
    file: read,
    blobs,
    documents: { files: blobs.size, bytes: [...blobs.values()].reduce((s, b) => s + b.length, 0) },
    missing: manifest.missing.map((m) => ({
      ...m,
      names: [...new Set(m.documentIds.map((id) => names.get(id)).filter((n): n is string => !!n))],
    })),
  };
};

/** What restoring would do here: the CSV Restore plan, plus the files. For the confirm dialog. */
export const planBackupRestore = (
  file: Extract<BackupFile, { ok: true }>,
  existing: Bundle,
): ImportPlan & { documents: { files: number; bytes: number } } => ({
  ...planImport(existing, file.bundle, "restore", file.file),
  documents: file.documents,
});

/** Write the bytes, then the rows in one transaction (replacing everything, as Restore does). */
export const restoreBackupInto = async (
  file: Extract<BackupFile, { ok: true }>,
  store: BlobStore,
  options: { onProgress?: ProgressFn } = {},
): Promise<void> => {
  const blobs = [...file.blobs];
  let done = 0;
  for (const [sha, bytes] of blobs) {
    options.onProgress?.({ phase: "writing", done: done++, total: blobs.length + 1 });
    await store.put(sha, new Blob([part(bytes)]));
  }
  options.onProgress?.({ phase: "writing", done: blobs.length, total: blobs.length + 1 });
  await importBundle(file.bundle as never, "import-restore");
  options.onProgress?.({ phase: "writing", done: blobs.length + 1, total: blobs.length + 1 });
};

/** "Restore from backup", in the app (OPFS). The caller confirms first when there is data here. */
export const restoreBackup = (
  file: Extract<BackupFile, { ok: true }>,
  options: { onProgress?: ProgressFn } = {},
): Promise<void> => restoreBackupInto(file, getBlobStore(), options);
