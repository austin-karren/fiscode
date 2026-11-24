import { isoFromDate } from "@fiscode/core";
import { CSV_SCHEMA_VERSION, exportBundle, exportFileName, type Bundle } from "@fiscode/csv";
import { buildBundle } from "@fiscode/db/repo";
import { getVaultStore, sha256Hex, type ShaStore } from "@fiscode/db/vault";
import { strToU8, zipSync, type Zippable } from "fflate";
import {
  backupFileName,
  BACKUP_FORMAT,
  encryptBackup,
  humanPaths,
  referencedBlobs,
  type BackupManifest,
  type BackupManifestFile,
} from "./index.ts";

// Test-only: the format-1 writer exactly as it shipped before format 2 (main at e0af863), so the
// tests can prove format-1 backups still restore. Bytes come from the by-sha store, as they did.

const ZIP_MTIME = new Date(1980, 0, 1, 12, 0, 0);
const part = (bytes: Uint8Array): ArrayBuffer => bytes as unknown as ArrayBuffer;
const BACKUP_FORMAT_VERSION = 1;
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
type ProgressFn = (p: { phase: "zipping"; done: number; total: number }) => void;

export const buildBackupZipV1 = async (
  bundle: Bundle,
  store: ShaStore,
  options: {
    createdAt: string;
    build?: string;
    /**
     * The date in the file names (YYYY-MM-DD). Default: `createdAt`'s LOCAL date, as the CSV
     * export names its file (`todayIso`). check-roundtrip passes the original backup's date, so
     * a rebuild in another timezone gives the same zip.
     */
    date?: string;
    onProgress?: ProgressFn;
  },
): Promise<{ bytes: Uint8Array; manifest: BackupManifest; fileName: string }> => {
  const date = options.date ?? isoFromDate(new Date(options.createdAt));
  const csvText = exportBundle(bundle, { scope: "full" });
  const csvBytes = strToU8(csvText);
  const csvPath = exportFileName({ scope: "full" }, date);
  const refs = referencedBlobs(bundle);
  const paths = humanPaths(bundle);

  // Each sha once: at the first (by path, so ids never decide) live document's path that has
  // it, else under .versions.
  const shaPath = new Map<string, string>();
  for (const [docId, path] of [...paths].toSorted(([, a], [, b]) => (a < b ? -1 : 1))) {
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

/** A format-1 backup of the test database, encrypted as createBackup encrypted it. */
export const createBackupV1 = async (options: {
  passphrase: string;
  createdAt: string;
  scryptWorkFactor?: number;
}): Promise<{ blob: Blob; fileName: string; manifest: BackupManifest; zip: Uint8Array }> => {
  const bundle = await buildBundle({ includeDeleted: true, includeHistory: true });
  const { bytes, manifest, fileName } = await buildBackupZipV1(bundle, getVaultStore(), options);
  const encrypted = await encryptBackup(bytes, options.passphrase, options.scryptWorkFactor);
  return { blob: new Blob([part(encrypted)]), fileName, manifest, zip: bytes };
};
