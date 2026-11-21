import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Subpaths only: "@fiscode/db" loads boot.ts, which needs Vite's import.meta.glob.
import { __setBlobStoreForTests, type BlobStore } from "@fiscode/db/blob-store";
import { __resetDbForTests, __setDbForTests } from "@fiscode/db/client";
import { buildBundle } from "@fiscode/db/repo";
import { tables } from "@fiscode/db/schema";
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
export const openProfileDir = async (dir: string): Promise<() => void> => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, DB_FILE);
  const isNew = !existsSync(file);
  const { sqlite, db } = await openSqlite(file);
  if (isNew) {
    for (const f of readdirSync(MIGRATIONS)
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      sqlite.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    }
  }
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

type Sqlite = { exec(sql: string): unknown; close(): void };

/**
 * The SQLite driver for where this runs: Bun's built-in bun:sqlite under Bun (the repo's pinned
 * Bun 1.3 can't load better-sqlite3's native addon: it crashes), better-sqlite3 under Node (the
 * tests). The module names are variables so neither runtime's bundler or type checker needs the
 * other's driver.
 */
const openSqlite = async (file: string): Promise<{ sqlite: Sqlite; db: unknown }> => {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    const bunSqlite = "bun:sqlite";
    const bunDrizzle = "drizzle-orm/bun-sqlite";
    const { Database: BunDatabase } = (await import(/* @vite-ignore */ bunSqlite)) as {
      Database: new (path: string) => Sqlite;
    };
    const { drizzle: bunDrizzleFn } = (await import(/* @vite-ignore */ bunDrizzle)) as {
      drizzle: (client: Sqlite, config: object) => unknown;
    };
    const sqlite = new BunDatabase(file);
    return { sqlite, db: bunDrizzleFn(sqlite, { schema: tables, casing: "snake_case" }) };
  }
  const sqlite = new Database(file);
  return { sqlite, db: drizzle(sqlite, { schema: tables, casing: "snake_case" }) };
};

const zipFile = (path: string) => new Blob([readFileSync(path)]);

/** A refused CSV as one message: the headline, then each row and why. */
const refusal = (file: {
  headline: string;
  detail?: string;
  errors: { line: number; message: string }[];
}) =>
  [file.headline, file.detail, ...file.errors.map((e) => `Row ${e.line}: ${e.message}`)]
    .filter(Boolean)
    .join("\n");

export type MissingFile = { sha256: string; documentIds: string[]; names: string[] };

/** "N files listed as missing (the device that made the backup didn't have them): a, b". */
export const describeMissing = (missing: readonly MissingFile[]): string | undefined => {
  if (missing.length === 0) return undefined;
  const names = [
    ...new Set(
      missing.flatMap((m) =>
        m.names.length ? m.names : [`an older version (${m.sha256.slice(0, 12)})`],
      ),
    ),
  ];
  return `${missing.length} ${missing.length === 1 ? "file" : "files"} listed as missing (the device that made the backup didn't have ${missing.length === 1 ? "it" : "them"}): ${names.join(", ")}`;
};

/** Every check a restore makes, without writing. Throws a BackupError or the CSV's refusal. */
export const verifyBackup = async (
  path: string,
): Promise<{ manifest: BackupManifest; missing: MissingFile[] }> => {
  const file = await readBackup(zipFile(path));
  if (!file.ok) throw new Error(refusal(file));
  return { manifest: file.manifest, missing: file.missing };
};

/** Restore a backup into a new, empty profile directory. Refuses a directory with files in it. */
export const restoreBackupToDir = async (
  path: string,
  dir: string,
): Promise<{ manifest: BackupManifest; missing: MissingFile[] }> => {
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    throw new Error(`${dir} isn't empty. Restore into a new directory.`);
  }
  const file = await readBackup(zipFile(path));
  if (!file.ok) throw new Error(refusal(file));
  const close = await openProfileDir(dir);
  try {
    await restoreBackupInto(file, fsBlobStore(dir));
  } finally {
    close();
  }
  return { manifest: file.manifest, missing: file.missing };
};

/** A backup zip of a profile directory. */
export const backupDir = async (
  dir: string,
  options: { createdAt: string; build?: string },
): Promise<{ bytes: Uint8Array; fileName: string; manifest: BackupManifest }> => {
  if (!existsSync(join(dir, DB_FILE))) throw new Error(`${dir} has no ${DB_FILE}.`);
  const close = await openProfileDir(dir);
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
    const { manifest } = await restoreBackupToDir(path, join(dir, "profile"));
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

/**
 * Counts, dates, schema and the live documents' paths, for a README or a CI log. Which files are
 * live is read from the manifest and the rows (a live document's current bytes), not from the
 * path (review #85 r1).
 */
export const summarizeBackup = async (path: string) => {
  const file = await readBackup(zipFile(path));
  if (!file.ok) throw new Error(refusal(file));
  const m = file.manifest;
  const liveShas = new Set(
    file.bundle.documents.filter((d) => d.deletedAt === null).map((d) => d.sha256),
  );
  const live = m.documents.filter((d) => liveShas.has(d.sha256));
  return {
    createdAt: m.createdAt,
    formatVersion: m.formatVersion,
    csvSchema: m.app.csvSchema,
    build: m.app.build,
    counts: m.counts,
    documents: live.map((d) => d.path),
    versions: m.documents.length - live.length,
    missing: file.missing.map((x) => ({ sha256: x.sha256, names: x.names })),
  };
};
