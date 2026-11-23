import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
// Subpaths only: "@fiscode/db" loads boot.ts, which needs Vite's import.meta.glob.
import { __setBlobStoreForTests, type BlobStore } from "@fiscode/db/blob-store";
import { __resetDbForTests, __setDbForTests } from "@fiscode/db/client";
import { buildBundle } from "@fiscode/db/repo";
import { tables } from "@fiscode/db/schema";
import {
  buildBackupZip,
  decryptBackup,
  encryptBackup,
  humanPaths,
  isAge,
  readBackup,
  restoreBackupInto,
  type BackupManifest,
} from "./index.ts";

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
 * The SQLite driver for where this runs: Bun's built-in bun:sqlite under Bun (Bun 1.3 crashed
 * loading better-sqlite3's native addon; 1.4.3 loads it, but bun:sqlite needs no addon), better-sqlite3 under Node (the
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
  passphrase: string | undefined,
): Promise<{ manifest: BackupManifest; missing: MissingFile[] }> => {
  const file = await readBackup(zipFile(path), { passphrase });
  if (!file.ok) throw new Error(refusal(file));
  return { manifest: file.manifest, missing: file.missing };
};

/** Restore a backup into a new, empty profile directory. Refuses a directory with files in it. */
export const restoreBackupToDir = async (
  path: string,
  dir: string,
  passphrase: string | undefined,
): Promise<{ manifest: BackupManifest; missing: MissingFile[] }> => {
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    throw new Error(`${dir} isn't empty. Restore into a new directory.`);
  }
  // Read (decrypt and check) before making the directory: a wrong passphrase changes nothing.
  const file = await readBackup(zipFile(path), { passphrase });
  if (!file.ok) throw new Error(refusal(file));
  const close = await openProfileDir(dir);
  try {
    await restoreBackupInto(file, fsBlobStore(dir));
  } finally {
    close();
  }
  return { manifest: file.manifest, missing: file.missing };
};

/** The deterministic (unencrypted) backup zip of a profile directory. */
const zipDir = async (
  dir: string,
  options: { createdAt: string; build?: string; date?: string },
) => {
  if (!existsSync(join(dir, DB_FILE))) throw new Error(`${dir} has no ${DB_FILE}.`);
  const close = await openProfileDir(dir);
  try {
    return await buildBackupZip(
      await buildBundle({ includeDeleted: true, includeHistory: true }),
      fsBlobStore(dir),
      options,
    );
  } finally {
    close();
  }
};

/**
 * An encrypted backup of a profile directory: `bytes` is the age file, `zip` the deterministic
 * zip inside it.
 */
export const backupDir = async (
  dir: string,
  options: { createdAt: string; build?: string; passphrase: string; scryptWorkFactor?: number },
): Promise<{ bytes: Uint8Array; zip: Uint8Array; fileName: string; manifest: BackupManifest }> => {
  const plain = await zipDir(dir, options);
  const bytes = await encryptBackup(plain.bytes, options.passphrase, options.scryptWorkFactor);
  return { bytes, zip: plain.bytes, fileName: plain.fileName, manifest: plain.manifest };
};

/** True when the file starts with age's header: an encrypted backup that needs a passphrase. */
export const isEncryptedBackupFile = (path: string): boolean => {
  const fd = openSync(path, "r");
  try {
    const head = new Uint8Array(32);
    return isAge(head.subarray(0, readSync(fd, head, 0, head.length, 0)));
  } finally {
    closeSync(fd);
  }
};

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * What a restore uses from a backup zip: the CSV's bytes, each stored file's bytes by sha256, and
 * the shas listed as missing. Not the zip's file names, which are only for people.
 */
const restoredContents = (zip: Uint8Array) => {
  const entries = unzipSync(zip);
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as BackupManifest;
  return {
    csv: entries[manifest.csv.path],
    files: new Map(manifest.documents.map((d) => [d.sha256, entries[d.path]])),
    missing: manifest.missing.map((m) => m.sha256).toSorted(),
  };
};

/**
 * Restore a backup into a temporary directory, back it up again with the same `createdAt` and
 * build, and compare. The ciphertext always differs (age's random key and salt), so the
 * decrypted zips are compared:
 * - `sameZip`: byte for byte the same zip;
 * - `identical`: the same contents a restore uses (the CSV's bytes, every file's bytes by sha256,
 *   the missing list). A backup made before the zip's file names changed (#87: Windows-safe
 *   names) restores exactly but zips under other names: `identical` without `sameZip`.
 */
export const checkRoundtrip = async (
  path: string,
  passphrase: string | undefined,
): Promise<{ identical: boolean; sameZip: boolean; manifest: BackupManifest }> => {
  const dir = await mkdtemp(join(tmpdir(), "fiscode-backup-"));
  try {
    const { manifest } = await restoreBackupToDir(path, join(dir, "profile"), passphrase);
    const again = await zipDir(join(dir, "profile"), {
      createdAt: manifest.createdAt,
      build: manifest.app.build,
      // The date the backup was named for where it was made (its CSV's name), not this
      // machine's local date of createdAt.
      date: /(\d{4}-\d{2}-\d{2})\.csv$/.exec(manifest.csv.path)?.[1],
    });
    const original = await decryptBackup(new Uint8Array(readFileSync(path)), passphrase);
    if (sameBytes(original, again.bytes)) return { identical: true, sameZip: true, manifest };
    const was = restoredContents(original);
    const now = restoredContents(again.bytes);
    const identical =
      sameBytes(was.csv, now.csv) &&
      was.files.size === now.files.size &&
      [...was.files].every(([sha, bytes]) => sameBytes(bytes, now.files.get(sha))) &&
      was.missing.join() === now.missing.join();
    return { identical, sameZip: false, manifest };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/**
 * Counts, dates, schema and every live document by folder path and name, from the rows (so two
 * documents with the same bytes are both listed: review #85 r4), for a README or a CI log.
 * `versions` counts the stored files no live document points at.
 */
export const summarizeBackup = async (path: string, passphrase: string | undefined) => {
  const file = await readBackup(zipFile(path), { passphrase });
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
    documents: [...humanPaths(file.bundle).values()].toSorted(),
    versions: m.documents.length - live.length,
    missing: file.missing.map((x) => ({ sha256: x.sha256, names: x.names })),
  };
};

/** Where the headless script looks for the passphrase file when FISCODE_BACKUP_PASSPHRASE_FILE is unset. */
export const defaultPassphraseFile = (): string =>
  join(homedir(), ".config", "fiscode", "backup-passphrase");

/**
 * The headless passphrase, in this order: FISCODE_BACKUP_PASSPHRASE; else the file named by
 * FISCODE_BACKUP_PASSPHRASE_FILE (default ~/.config/fiscode/backup-passphrase), refused when
 * group- or other-readable, with one trailing newline stripped; else `prompt` (a terminal, no
 * echo). Throws a message that never contains the passphrase.
 */
export const resolvePassphrase = (
  env: Record<string, string | undefined>,
  prompt: () => string | undefined,
): string => {
  if (env.FISCODE_BACKUP_PASSPHRASE) return env.FISCODE_BACKUP_PASSPHRASE;
  const file = env.FISCODE_BACKUP_PASSPHRASE_FILE || defaultPassphraseFile();
  if (existsSync(file)) {
    const stat = statSync(file);
    if (!stat.isFile()) {
      throw new Error(
        `${file} isn't a file. Point FISCODE_BACKUP_PASSPHRASE_FILE at the passphrase file.`,
      );
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(
        `${file} can be read by other users. Run: chmod 600 ${file} (nothing was read from it).`,
      );
    }
    const text = readFileSync(file, "utf8").replace(/\r?\n$/, "");
    if (!text) throw new Error(`${file} is empty.`);
    return text;
  }
  const typed = prompt();
  if (typed === "") throw new Error("No passphrase entered. Nothing was changed.");
  if (typed === undefined) {
    throw new Error(
      `No passphrase: set FISCODE_BACKUP_PASSPHRASE, create ${file} (chmod 600), or run in a terminal to be asked.`,
    );
  }
  return typed;
};
