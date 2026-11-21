import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  BackupBytesMissingError,
  BackupFileCorruptError,
  BackupManifestError,
  BackupNotAZipError,
  BackupTooNewError,
} from "@fiscode/core";
import { exampleBundle, exportBundle } from "@fiscode/csv";
import {
  __setBlobStoreForTests,
  buildBundle,
  documentLinkRepo,
  documentRepo,
  folderRepo,
  importBundle,
  memoryBlobStore,
} from "@fiscode/db";
import { setupTestDb, teardownTestDb } from "@fiscode/db/test";
import {
  createBackup,
  planBackupRestore,
  readBackup,
  restoreBackup,
  type BackupManifest,
} from "./index.ts";
import { checkRoundtrip, restoreBackupToDir, summarizeBackup, verifyBackup } from "./node.ts";

const CREATED = "2026-11-21T02:00:00.000Z";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = setupTestDb();
  __setBlobStoreForTests(memoryBlobStore());
});
afterEach(() => {
  __setBlobStoreForTests(undefined);
  teardownTestDb(sqlite);
});

/** A fresh, empty profile (database and blob store). */
const emptyProfile = () => {
  teardownTestDb(sqlite);
  sqlite = setupTestDb();
  __setBlobStoreForTests(memoryBlobStore());
};

const file = (name: string, text: string) =>
  Object.assign(new Blob([text], { type: "application/pdf" }), { name });

/** The demo data, documents in folders (one replaced, one deleted, one duplicate), links, history. */
const seed = async () => {
  await importBundle(exampleBundle() as never, "import-restore");
  const year = await folderRepo.ensureYearDefaults(2026);
  const expenses = year.find((f) => f.defaultKey === "expenses")!;
  const receipt = await documentRepo.upload(file("Demo receipt.pdf", "receipt v1"), {
    folderId: expenses.id,
  });
  await documentRepo.replaceBytes(receipt.id, file("Demo receipt.pdf", "receipt v2"));
  // Same name, same folder: the zip path gets " (2)".
  await documentRepo.upload(file("Demo receipt.pdf", "another receipt"), { folderId: expenses.id });
  // Same bytes as v2 elsewhere: stored once.
  await documentRepo.upload(file("copy.pdf", "receipt v2"));
  const gone = await documentRepo.upload(file("Old scan.pdf", "old scan"));
  await documentRepo.softDelete(gone.id);
  const expense = (await buildBundle()).expenses[0]!;
  await documentLinkRepo.link(receipt.id, "expense", expense.id);
};

/** Every table sorted the way the export sorts it: by time where there is one, then by id. */
const normalized = (b: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(b).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? (v as { id: string; at?: string }[]).toSorted(
            (x, y) =>
              (x.at ?? "").localeCompare(y.at ?? "") || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
          )
        : v,
    ]),
  );

const zipEntries = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));
const rezip = (entries: Record<string, Uint8Array>) =>
  new Blob([zipSync(entries) as unknown as ArrayBuffer]);

describe("backup: layout and manifest", () => {
  it("manifest, CSV, live documents at their folder paths, everything else once by sha", async () => {
    await seed();
    const { blob, fileName, manifest } = await createBackup({ createdAt: CREATED });
    expect(fileName).toBe("fiscode-backup-2026-11-21.zip");
    const entries = await zipEntries(blob);
    const names = Object.keys(entries);
    expect(names[0]).toBe("manifest.json");
    expect(names[1]).toBe("fiscode-full-backup-2026-11-21.csv");
    const paths = manifest.documents.map((d) => d.path);
    expect(paths).toContain("documents/2026/Expenses/Demo receipt.pdf");
    expect(paths).toContain("documents/2026/Expenses/Demo receipt (2).pdf");
    // v1 of the receipt and the deleted scan: under .versions.
    expect(paths.filter((p) => p.startsWith("documents/.versions/"))).toHaveLength(2);
    // v2 is shared by two documents and stored once.
    const shas = manifest.documents.map((d) => d.sha256);
    expect(new Set(shas).size).toBe(shas.length);
    expect(manifest.documents.find((d) => d.documentIds.length === 2)).toBeDefined();
    expect(manifest).toMatchObject({
      format: "fiscode-backup",
      formatVersion: 1,
      createdAt: CREATED,
      app: { csvSchema: "v6", build: "dev" },
      missing: [],
    });
    expect(JSON.parse(strFromU8(entries["manifest.json"]!))).toEqual(manifest);
  });

  it("an app with no documents still backs up as a zip (CSV + manifest)", async () => {
    await importBundle(exampleBundle() as never, "import-restore");
    const { blob, manifest } = await createBackup({ createdAt: CREATED });
    expect(manifest.documents).toEqual([]);
    expect(Object.keys(await zipEntries(blob))).toHaveLength(2);
  });
});

describe("backup: restore into an empty profile is exact", () => {
  it("same rows, history and documents; the CSV re-exports byte-identical; a new backup is byte-identical", async () => {
    await seed();
    const before = await buildBundle({ includeDeleted: true, includeHistory: true });
    const beforeCsv = exportBundle(before as never, { scope: "full" });
    const first = await createBackup({ createdAt: CREATED });

    emptyProfile();
    const read = await readBackup(first.blob);
    if (!read.ok) throw new Error(read.headline);
    await restoreBackup(read);

    const after = await buildBundle({ includeDeleted: true, includeHistory: true });
    // The same rows in every table, history included. Row order isn't part of the data: entries
    // with the same millisecond come back in any order, and the export sorts by time, then id.
    expect(normalized(after)).toEqual(normalized(before));
    expect(exportBundle(after as never, { scope: "full" })).toBe(beforeCsv);
    // Every document's current bytes, live or deleted, read back.
    for (const d of after.documents) {
      if (d.deletedAt === null) {
        expect((await documentRepo.readBytes(d.id)).size).toBe(d.sizeBytes);
      }
    }
    // Older versions too.
    const receipt = after.documents.find((d) => d.name === "Demo receipt.pdf" && d.folderId)!;
    expect((await documentRepo.versions(receipt.id)).every((v) => v.available)).toBe(true);

    const second = await createBackup({ createdAt: CREATED });
    const a = new Uint8Array(await first.blob.arrayBuffer());
    const b = new Uint8Array(await second.blob.arrayBuffer());
    expect(b).toEqual(a);
  });
});

describe("backup: restore over existing data", () => {
  it("returns the plan (rows, history, files) for the dialog; restore replaces everything with one snapshot", async () => {
    await seed();
    const backup = await createBackup({ createdAt: CREATED });
    await documentRepo.upload(file("after.pdf", "added after the backup"));
    const existing = await buildBundle({ includeDeleted: true, includeHistory: true });
    const read = await readBackup(backup.blob);
    if (!read.ok) throw new Error(read.headline);
    const plan = planBackupRestore(read, existing);
    expect(plan.mode).toBe("restore");
    expect(plan.removed.live).toBe(1); // after.pdf
    expect(plan.snapshot).toBe(true);
    expect(plan.documents).toEqual({
      files: read.manifest.documents.length,
      bytes: expect.any(Number),
    });
    await restoreBackup(read);
    expect((await documentRepo.list()).map((d) => d.name)).not.toContain("after.pdf");
  });
});

describe("backup: refusals (nothing written)", () => {
  const good = async () => {
    await seed();
    return createBackup({ createdAt: CREATED });
  };

  it("not a zip", async () => {
    await expect(readBackup(new Blob(["record_type,date\n"]))).rejects.toBeInstanceOf(
      BackupNotAZipError,
    );
  });

  it("no manifest, or not a fiscode manifest", async () => {
    const entries = await zipEntries((await good()).blob);
    const { ["manifest.json"]: _m, ...rest } = entries;
    await expect(readBackup(rezip(rest))).rejects.toBeInstanceOf(BackupManifestError);
    await expect(
      readBackup(rezip({ ...entries, "manifest.json": strToU8('{"format":"other"}') })),
    ).rejects.toBeInstanceOf(BackupManifestError);
  });

  it("a newer format", async () => {
    const entries = await zipEntries((await good()).blob);
    const m = JSON.parse(strFromU8(entries["manifest.json"]!)) as BackupManifest;
    await expect(
      readBackup(
        rezip({ ...entries, "manifest.json": strToU8(JSON.stringify({ ...m, formatVersion: 2 })) }),
      ),
    ).rejects.toBeInstanceOf(BackupTooNewError);
  });

  it("a damaged file is named", async () => {
    const backup = await good();
    const entries = await zipEntries(backup.blob);
    const path = backup.manifest.documents[0]!.path;
    const tampered = { ...entries, [path]: strToU8("tampered!!") };
    await expect(readBackup(rezip(tampered))).rejects.toThrow(path);
    await expect(readBackup(rezip(tampered))).rejects.toBeInstanceOf(BackupFileCorruptError);
  });

  it("a document whose bytes aren't in the zip (nor listed as missing)", async () => {
    const backup = await good();
    const entries = await zipEntries(backup.blob);
    // A live document's file (an older version under .versions is history only).
    const dropped = backup.manifest.documents.find((d) => !d.path.includes("/.versions/"))!;
    const m: BackupManifest = {
      ...backup.manifest,
      documents: backup.manifest.documents.filter((d) => d.path !== dropped.path),
    };
    const { [dropped.path]: _gone, ...rest } = entries;
    await expect(
      readBackup(rezip({ ...rest, "manifest.json": strToU8(JSON.stringify(m)) })),
    ).rejects.toBeInstanceOf(BackupBytesMissingError);
  });

  it("a CSV the importer refuses comes back as ok: false, as an import does", async () => {
    const backup = await good();
    const entries = await zipEntries(backup.blob);
    const csv = strToU8("not,a,fiscode,file\n");
    const { sha256Hex } = await import("@fiscode/db");
    const m: BackupManifest = {
      ...backup.manifest,
      csv: {
        ...backup.manifest.csv,
        sha256: await sha256Hex(new Blob([csv as unknown as ArrayBuffer])),
        sizeBytes: csv.length,
      },
    };
    const read = await readBackup(
      rezip({ ...entries, [m.csv.path]: csv, "manifest.json": strToU8(JSON.stringify(m)) }),
    );
    expect(read.ok).toBe(false);
  });
});

describe("backup: a device without some bytes (after a CSV-only restore)", () => {
  it("backs up anyway, lists them as missing, and restores the rows", async () => {
    await seed();
    __setBlobStoreForTests(memoryBlobStore()); // this device has none of the files
    const backup = await createBackup({ createdAt: CREATED });
    expect(backup.manifest.documents).toEqual([]);
    expect(backup.manifest.missing.length).toBeGreaterThan(0);
    emptyProfile();
    const read = await readBackup(backup.blob);
    if (!read.ok) throw new Error(read.headline);
    await restoreBackup(read);
    expect((await documentRepo.list()).length).toBe(3);
  });
});

describe("backup: headless (node.ts, the script's functions)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fiscode-backup-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("verify, restore into a directory, check-roundtrip byte-identical, summary", async () => {
    await seed();
    const backup = await createBackup({ createdAt: CREATED });
    const zip = join(dir, backup.fileName);
    writeFileSync(zip, new Uint8Array(await backup.blob.arrayBuffer()));
    // The test's own database must not be the one the script opens.
    teardownTestDb(sqlite);

    expect((await verifyBackup(zip)).counts.rows).toBe(backup.manifest.counts.rows);
    await restoreBackupToDir(zip, join(dir, "profile"));
    expect(await checkRoundtrip(zip)).toMatchObject({ identical: true });
    const summary = await summarizeBackup(zip);
    expect(summary.documents).toContain("documents/2026/Expenses/Demo receipt.pdf");

    sqlite = setupTestDb(); // for afterEach
  });

  it("refuses to restore into a directory that isn't empty", async () => {
    await importBundle(exampleBundle() as never, "import-restore");
    const backup = await createBackup({ createdAt: CREATED });
    const zip = join(dir, backup.fileName);
    writeFileSync(zip, new Uint8Array(await backup.blob.arrayBuffer()));
    mkdirSync(join(dir, "busy"));
    writeFileSync(join(dir, "busy", "x"), "x");
    teardownTestDb(sqlite);
    await expect(restoreBackupToDir(zip, join(dir, "busy"))).rejects.toThrow(/isn't empty/);
    sqlite = setupTestDb();
  });
});
