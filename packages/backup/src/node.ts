import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  __resetDbForTests,
  __setBlobStoreForTests,
  __setDbForTests,
  buildBundle,
  tables,
  type BlobStore,
} from "@fiscode/db";
import { buildBackupZip, readBackup, restoreBackupInto, type BackupManifest } from "./index.ts";

// The headless side of backups (contract: drafts/contract-backup.md), for d-dogfood's private
// repo of backups. A "profile directory" holds what the browser keeps in OPFS, on disk:
//   <dir>/fiscode.sqlite                         the database (the app's migrations applied)
//   <dir>/documents/blobs/<sha[0:2]>/<sha256>    document bytes, the same layout as OPFS
// It can't read a browser's OPFS: a backup always starts in the app; this works on the zips.

const MIGRATIONS = fileURLToPath(new URL("../../db/src/migrations", import.meta.url));
const DB_FILE = "fiscode.sqlite";

/** Document bytes in a directory, laid out as OPFS lays them out. */
export const fsBlobStore = (dir: string): BlobStore => {
  const at = (sha: string) => join(dir, "documents", "blobs", sha.slice(0, 2), sha);
  return {
    async has(sha) {
      return existsSync(at(sha));
    },
    async put(sha, bytes) {
      if (existsSync(at(sha))) return;
      mkdirSync(dirname(at(sha)), { recursive: true });
      writeFileSync(at(sha), new Uint8Array(await bytes.arrayBuffer()));
    },
    async get(sha) {
      return existsSync(at(sha)) ? new Blob([readFileSync(at(sha))]) : undefined;
    },
  };
};

/**
 * Point the @fiscode/db repos at a profile directory: its SQLite file (created with every
 * migration when new) and its blob directory. Returns a close function.
 */
export const openProfileDir = (dir: string): (() => void) => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, DB_FILE);
  const isNew = !existsSync(file);
  const sqlite = new Database(file);
  if (isNew) {
    for (const f of readdirSync(MIGRATIONS)
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      sqlite.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    }
  }
  const db = drizzle(sqlite, { schema: tables, casing: "snake_case" });
  // One BEGIN ... COMMIT on the single connection: all or nothing, as runAtomic is in the app.
  __setDbForTests(db as never, async (queries) => {
    sqlite.exec("BEGIN");
    try {
      for (const query of queries) await query;
      sqlite.exec("COMMIT");
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  });
  __setBlobStoreForTests(fsBlobStore(dir));
  return () => {
    __resetDbForTests();
    __setBlobStoreForTests(undefined);
    sqlite.close();
  };
};

const zipFile = (path: string) => new Blob([readFileSync(path)]);

/** Every check a restore makes, without writing. Throws a BackupError, or returns the manifest. */
export const verifyBackup = async (path: string): Promise<BackupManifest> => {
  const file = await readBackup(zipFile(path));
  if (!file.ok) {
    throw new Error(
      `${file.headline}${file.detail ? ` ${file.detail}` : ""} ${file.errors.map((e) => `Row ${e.line}: ${e.message}`).join("; ")}`.trim(),
    );
  }
  return file.manifest;
};

/** Restore a backup into a new, empty profile directory. Refuses a directory with files in it. */
export const restoreBackupToDir = async (path: string, dir: string): Promise<BackupManifest> => {
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    throw new Error(`${dir} isn't empty. Restore into a new directory.`);
  }
  const file = await readBackup(zipFile(path));
  if (!file.ok) throw new Error(file.headline);
  const close = openProfileDir(dir);
  try {
    await restoreBackupInto(file, fsBlobStore(dir));
  } finally {
    close();
  }
  return file.manifest;
};

/** A backup zip of a profile directory. */
export const backupDir = async (
  dir: string,
  options: { createdAt: string; build?: string },
): Promise<{ bytes: Uint8Array; fileName: string; manifest: BackupManifest }> => {
  if (!existsSync(join(dir, DB_FILE))) throw new Error(`${dir} has no ${DB_FILE}.`);
  const close = openProfileDir(dir);
  try {
    const bundle = await buildBundle({ includeDeleted: true, includeHistory: true });
    return await buildBackupZip(bundle, fsBlobStore(dir), options);
  } finally {
    close();
  }
};

/**
 * Restore a backup into a temporary directory, back it up again with the same `createdAt` and
 * build, and compare the bytes. True when identical.
 */
export const checkRoundtrip = async (
  path: string,
): Promise<{ identical: boolean; manifest: BackupManifest }> => {
  const dir = await mkdtemp(join(tmpdir(), "fiscode-backup-"));
  try {
    const manifest = await restoreBackupToDir(path, join(dir, "profile"));
    const again = await backupDir(join(dir, "profile"), {
      createdAt: manifest.createdAt,
      build: manifest.app.build,
    });
    const original = readFileSync(path);
    const identical =
      original.length === again.bytes.length && original.every((b, i) => b === again.bytes[i]);
    return { identical, manifest };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/** Counts, dates, schema and the folder tree, for a README or a CI log. */
export const summarizeBackup = async (path: string) => {
  const file = await readBackup(zipFile(path));
  if (!file.ok) throw new Error(file.headline);
  const m = file.manifest;
  return {
    createdAt: m.createdAt,
    formatVersion: m.formatVersion,
    csvSchema: m.app.csvSchema,
    build: m.app.build,
    counts: m.counts,
    missingBlobs: m.missing.length,
    documents: m.documents
      .filter((d) => !d.path.startsWith("documents/.versions/"))
      .map((d) => d.path),
  };
};
