import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  BackupBytesMissingError,
  BackupFileCorruptError,
  BackupManifestError,
  BackupNotAZipError,
  BackupPassphraseError,
  BackupTooNewError,
  BackupUnexpectedFileError,
} from "@fiscode/core";
import { exampleBundle, exportBundle } from "@fiscode/csv";
import {
  __setVaultStoreForTests,
  buildBundle,
  historyRepo,
  documentLinkRepo,
  documentRepo,
  folderRepo,
  importBundle,
  memoryDir,
  vaultStore,
} from "@fiscode/db";
import { sha256Hex } from "@fiscode/db/vault";
import { setupTestDb, teardownTestDb } from "@fiscode/db/test";
import {
  createBackup,
  AGE_NO_IDENTITY_MATCHED,
  decryptBackup,
  encryptBackup,
  planBackupRestore,
  readBackup,
  restoreBackup,
  type BackupManifest,
} from "./index.ts";
import {
  backupDir,
  checkRoundtrip,
  resolvePassphrase,
  restoreBackupToDir,
  summarizeBackup,
  verifyBackup,
} from "./node.ts";

// Noon UTC: the same calendar day (the file name's date is local) from UTC-11 to UTC+11.
const CREATED = "2026-11-21T12:00:00.000Z";
// A throwaway constant, only ever used on demo data. Work factor 10 keeps scrypt fast in tests.
const PASS = "throwaway-test-passphrase";
const WF = 10;
const openBackup = (b: Blob) => readBackup(b, { passphrase: PASS });
const plain = async (blob: Blob) => decryptBackup(new Uint8Array(await blob.arrayBuffer()), PASS);

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = setupTestDb();
  __setVaultStoreForTests(vaultStore(memoryDir()));
});
afterEach(() => {
  __setVaultStoreForTests(undefined);
  teardownTestDb(sqlite);
});

/** A fresh, empty profile (database and blob store). */
const emptyProfile = () => {
  teardownTestDb(sqlite);
  sqlite = setupTestDb();
  __setVaultStoreForTests(vaultStore(memoryDir()));
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

const zipEntries = async (blob: Blob) => unzipSync(await plain(blob));
const rezip = (entries: Record<string, Uint8Array>) =>
  new Blob([zipSync(entries) as unknown as ArrayBuffer]);

describe("backup: layout and manifest", () => {
  it("manifest, CSV, live documents at their folder paths, everything else once by sha", async () => {
    await seed();
    const { blob, fileName, manifest } = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    expect(fileName).toBe("fiscode-backup-2026-11-21.zip.age");
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
    // The shared sha's one path is chosen by path, never by id (review #85 r4): the receipt's
    // "documents/2026/…" sorts before "documents/Unfiled/copy.pdf".
    const shared = manifest.documents.find((d) => d.documentIds.length === 2)!;
    expect(shared.path).toMatch(/^documents\/2026\/Expenses\/Demo receipt( \(2\))?\.pdf$/);
    expect(paths).not.toContain("documents/Unfiled/copy.pdf");
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
    const { blob, manifest } = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    expect(manifest.documents).toEqual([]);
    expect(Object.keys(await zipEntries(blob))).toHaveLength(2);
  });
});

describe("backup: restore into an empty profile is exact", () => {
  it("same rows, history and documents; the CSV re-exports byte-identical; a new backup is byte-identical", async () => {
    await seed();
    const before = await buildBundle({ includeDeleted: true, includeHistory: true });
    const beforeCsv = exportBundle(before as never, { scope: "full" });
    const first = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });

    emptyProfile();
    const read = await openBackup(first.blob);
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

    const second = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    // The 1:1 proof is on the decrypted zips: age's random file key and salt make every
    // ciphertext different.
    expect(new Uint8Array(await second.blob.arrayBuffer())).not.toEqual(
      new Uint8Array(await first.blob.arrayBuffer()),
    );
    expect(await plain(second.blob)).toEqual(await plain(first.blob));
  });
});

describe("backup: restore over existing data", () => {
  it("returns the plan (rows, history, files) for the dialog; restore replaces everything with one snapshot", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    await documentRepo.upload(file("after.pdf", "added after the backup"));
    const existing = await buildBundle({ includeDeleted: true, includeHistory: true });
    const read = await openBackup(backup.blob);
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
    return createBackup({ createdAt: CREATED, passphrase: PASS, scryptWorkFactor: WF });
  };

  it("not a zip", async () => {
    await expect(openBackup(new Blob(["record_type,date\n"]))).rejects.toBeInstanceOf(
      BackupNotAZipError,
    );
  });

  it("no manifest, or not a fiscode manifest", async () => {
    const entries = await zipEntries((await good()).blob);
    const { ["manifest.json"]: _m, ...rest } = entries;
    await expect(openBackup(rezip(rest))).rejects.toBeInstanceOf(BackupManifestError);
    await expect(
      openBackup(rezip({ ...entries, "manifest.json": strToU8('{"format":"other"}') })),
    ).rejects.toBeInstanceOf(BackupManifestError);
  });

  it("a newer format", async () => {
    const entries = await zipEntries((await good()).blob);
    const m = JSON.parse(strFromU8(entries["manifest.json"]!)) as BackupManifest;
    await expect(
      openBackup(
        rezip({ ...entries, "manifest.json": strToU8(JSON.stringify({ ...m, formatVersion: 2 })) }),
      ),
    ).rejects.toBeInstanceOf(BackupTooNewError);
  });

  it("a damaged file is named", async () => {
    const backup = await good();
    const entries = await zipEntries(backup.blob);
    const path = backup.manifest.documents[0]!.path;
    const tampered = { ...entries, [path]: strToU8("tampered!!") };
    await expect(openBackup(rezip(tampered))).rejects.toThrow(path);
    await expect(openBackup(rezip(tampered))).rejects.toBeInstanceOf(BackupFileCorruptError);
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
    m.counts = { ...m.counts, blobs: m.documents.length };
    const { [dropped.path]: _gone, ...rest } = entries;
    await expect(
      openBackup(rezip({ ...rest, "manifest.json": strToU8(JSON.stringify(m)) })),
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
    const read = await openBackup(
      rezip({ ...entries, [m.csv.path]: csv, "manifest.json": strToU8(JSON.stringify(m)) }),
    );
    expect(read.ok).toBe(false);
  });
});

describe("backup: a device without some bytes (after a CSV-only restore)", () => {
  it("backs up anyway, lists them as missing, and restores the rows", async () => {
    await seed();
    __setVaultStoreForTests(vaultStore(memoryDir())); // this device has none of the files
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    expect(backup.manifest.documents).toEqual([]);
    expect(backup.manifest.missing.length).toBeGreaterThan(0);
    emptyProfile();
    const read = await openBackup(backup.blob);
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
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const zip = join(dir, backup.fileName);
    writeFileSync(zip, new Uint8Array(await backup.blob.arrayBuffer()));
    // The test's own database must not be the one the script opens.
    teardownTestDb(sqlite);

    expect((await verifyBackup(zip, PASS)).manifest.counts.rows).toBe(backup.manifest.counts.rows);
    await restoreBackupToDir(zip, join(dir, "profile"), PASS);
    expect(await checkRoundtrip(zip, PASS)).toMatchObject({ identical: true });
    const summary = await summarizeBackup(zip, PASS);
    expect(summary.documents).toContain("documents/2026/Expenses/Demo receipt.pdf");

    sqlite = setupTestDb(); // for afterEach
  });

  it("the real script runs under Bun (no Vite-only code on its import path): verify and check-roundtrip", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const zip = join(dir, backup.fileName);
    writeFileSync(zip, new Uint8Array(await backup.blob.arrayBuffer()));
    const bin = fileURLToPath(new URL("../bin/fiscode-backup.ts", import.meta.url));
    // Bun as the repo pins it (packageManager), as CI runs it. stderr goes to the test output.
    const run = (...args: string[]) => {
      const r = spawnSync("bun", [bin, ...args], {
        encoding: "utf8",
        env: { ...process.env, FISCODE_BACKUP_PASSPHRASE: PASS },
      });
      if (r.stderr) console.error(r.stderr);
      return r;
    };
    const verify = run("verify", zip);
    expect(verify.stderr).toBe("");
    expect(verify.status).toBe(0);
    expect(verify.stdout).toMatch(/^ok: /);
    const roundtrip = run("check-roundtrip", zip);
    expect(roundtrip.stdout.trim()).toBe("identical (decrypted contents)");
    expect(roundtrip.status).toBe(0);
    expect(run("verify", join(dir, "nope.zip")).status).toBe(1);
  }, 30_000);

  it("refuses to restore into a directory that isn't empty", async () => {
    await importBundle(exampleBundle() as never, "import-restore");
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const zip = join(dir, backup.fileName);
    writeFileSync(zip, new Uint8Array(await backup.blob.arrayBuffer()));
    mkdirSync(join(dir, "busy"));
    writeFileSync(join(dir, "busy", "x"), "x");
    teardownTestDb(sqlite);
    await expect(restoreBackupToDir(zip, join(dir, "busy"), PASS)).rejects.toThrow(/isn't empty/);
    sqlite = setupTestDb();
  });
});

describe("review #85 r1", () => {
  const withManifest = (entries: Record<string, Uint8Array>, m: unknown) =>
    rezip({ ...entries, "manifest.json": strToU8(JSON.stringify(m)) });

  it("(1) a blob only history references (an older version) dropped from the zip is refused", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const entries = await zipEntries(backup.blob);
    const version = backup.manifest.documents.find((d) => d.path.includes("/.versions/"))!;
    const { [version.path]: _gone, ...rest } = entries;
    const m = {
      ...backup.manifest,
      documents: backup.manifest.documents.filter((d) => d !== version),
    };
    m.counts = { ...m.counts, blobs: m.documents.length };
    await expect(openBackup(withManifest(rest, m))).rejects.toBeInstanceOf(BackupBytesMissingError);
  });

  it("(2) missing files are reported with the documents' names; counts.blobs is cross-checked", async () => {
    await seed();
    __setVaultStoreForTests(vaultStore(memoryDir()));
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const read = await openBackup(backup.blob);
    if (!read.ok) throw new Error(read.headline);
    expect(read.missing.length).toBeGreaterThan(0);
    expect(read.missing.flatMap((m) => m.names)).toContain("Demo receipt.pdf");

    const entries = await zipEntries(backup.blob);
    await expect(
      openBackup(
        withManifest(entries, {
          ...backup.manifest,
          counts: { ...backup.manifest.counts, blobs: 99 },
        }),
      ),
    ).rejects.toBeInstanceOf(BackupManifestError);
  });

  it("(3) a manifest of the wrong shape is a BackupManifestError, never a TypeError", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const entries = await zipEntries(backup.blob);
    for (const bad of [
      null,
      { ...backup.manifest, documents: null },
      { ...backup.manifest, csv: undefined },
      { ...backup.manifest, missing: "none" },
      { ...backup.manifest, documents: [{ path: 3 }] },
    ]) {
      await expect(openBackup(withManifest(entries, bad))).rejects.toBeInstanceOf(
        BackupManifestError,
      );
    }
  });

  it("(4) formatVersion must be a whole number of 1 or more; a file the manifest doesn't list is refused by name", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const entries = await zipEntries(backup.blob);
    for (const v of [0, 1.5, "1"]) {
      await expect(
        openBackup(withManifest(entries, { ...backup.manifest, formatVersion: v })),
      ).rejects.toBeInstanceOf(BackupManifestError);
    }
    const extra = rezip({ ...entries, "documents/sneaky.pdf": strToU8("x") });
    await expect(openBackup(extra)).rejects.toBeInstanceOf(BackupUnexpectedFileError);
    await expect(openBackup(extra)).rejects.toThrow("documents/sneaky.pdf");
  });
});

describe("review #85 r1: the script reports missing files", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fiscode-backup-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("(2) verify exits 3 and names them, unless --allow-missing; summary and restore print them", async () => {
    await seed();
    __setVaultStoreForTests(vaultStore(memoryDir()));
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const zip = join(dir, backup.fileName);
    writeFileSync(zip, new Uint8Array(await backup.blob.arrayBuffer()));
    const bin = fileURLToPath(new URL("../bin/fiscode-backup.ts", import.meta.url));
    // Bun as the repo pins it (packageManager), as CI runs it. stderr goes to the test output.
    const run = (...args: string[]) => {
      const r = spawnSync("bun", [bin, ...args], {
        encoding: "utf8",
        env: { ...process.env, FISCODE_BACKUP_PASSPHRASE: PASS },
      });
      if (r.stderr) console.error(r.stderr);
      return r;
    };
    const verify = run("verify", zip);
    expect(verify.status).toBe(3);
    expect(verify.stdout).toMatch(/files? listed as missing/);
    expect(verify.stdout).toContain("Demo receipt.pdf");
    expect(run("verify", zip, "--allow-missing").status).toBe(0);
    expect(run("summary", zip).stdout).toContain("Demo receipt.pdf");
    const restore = run("restore", zip, "--to", join(dir, "p"));
    expect(restore.status).toBe(0);
    expect(restore.stdout).toMatch(/files? listed as missing/);
  }, 30_000);

  it("(6) summary lists every live document from the rows (shared bytes too), and counts versions", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const zip = join(dir, backup.fileName);
    writeFileSync(zip, new Uint8Array(await backup.blob.arrayBuffer()));
    teardownTestDb(sqlite);
    const summary = await summarizeBackup(zip, PASS);
    // copy.pdf shares the receipt's bytes (one zip entry) and is still listed (review #85 r4).
    expect(summary.documents).toEqual([
      "documents/2026/Expenses/Demo receipt (2).pdf",
      "documents/2026/Expenses/Demo receipt.pdf",
      "documents/Unfiled/copy.pdf",
    ]);
    expect(summary.versions).toBe(2);
    sqlite = setupTestDb();
  });
});

describe("encryption (age, scrypt passphrase)", () => {
  const all = () => buildBundle({ includeDeleted: true, includeHistory: true });

  it("the file is an age v1 file, not a zip; the zip inside is deterministic", async () => {
    await seed();
    const { blob } = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(strFromU8(bytes.slice(0, 22))).toBe("age-encryption.org/v1\n");
    expect(strFromU8(bytes.slice(0, 200))).toContain("-> scrypt ");
    expect(strFromU8(bytes)).not.toContain("manifest.json");
    expect(unzipSync(await plain(blob))["manifest.json"]).toBeDefined();
  });

  it("a wrong passphrase is a typed error and nothing changes", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    await importBundle(exampleBundle() as never, "import-restore");
    const before = await all();
    const wrong = readBackup(backup.blob, { passphrase: "not-the-passphrase" });
    await expect(wrong).rejects.toBeInstanceOf(BackupPassphraseError);
    await expect(readBackup(backup.blob, { passphrase: "not-the-passphrase" })).rejects.toThrow(
      /Nothing was changed/,
    );
    expect(normalized(await all())).toEqual(normalized(before));
  });

  it("an encrypted backup without a passphrase asks for one", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    await expect(readBackup(backup.blob)).rejects.toThrow(/encrypted/);
    await expect(readBackup(backup.blob)).rejects.toBeInstanceOf(BackupPassphraseError);
  });

  it("a passphrase shorter than 12 characters is refused before anything is built", async () => {
    await seed();
    await expect(createBackup({ createdAt: CREATED, passphrase: "short" })).rejects.toBeInstanceOf(
      BackupPassphraseError,
    );
    await expect(encryptBackup(new Uint8Array(1), "")).rejects.toThrow(/at least 12/);
  });

  it("a plain zip (already decrypted by hand with the age CLI) still restores", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const read = await readBackup(new Blob([(await plain(backup.blob)) as unknown as ArrayBuffer]));
    expect(read.ok).toBe(true);
  });

  describe("headless", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "fiscode-backup-pass-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("a wrong passphrase restores nothing: the directory isn't created", async () => {
      await seed();
      const backup = await createBackup({
        createdAt: CREATED,
        passphrase: PASS,
        scryptWorkFactor: WF,
      });
      const zip = join(dir, backup.fileName);
      writeFileSync(zip, new Uint8Array(await backup.blob.arrayBuffer()));
      teardownTestDb(sqlite);
      await expect(
        restoreBackupToDir(zip, join(dir, "profile"), "not-the-passphrase"),
      ).rejects.toBeInstanceOf(BackupPassphraseError);
      expect(existsSync(join(dir, "profile"))).toBe(false);
      sqlite = setupTestDb();
    });

    it("backupDir writes ciphertext; check-roundtrip compares the decrypted zips", async () => {
      await seed();
      const backup = await createBackup({
        createdAt: CREATED,
        passphrase: PASS,
        scryptWorkFactor: WF,
      });
      const zip = join(dir, backup.fileName);
      writeFileSync(zip, new Uint8Array(await backup.blob.arrayBuffer()));
      teardownTestDb(sqlite);
      await restoreBackupToDir(zip, join(dir, "profile"), PASS);
      const again = await backupDir(join(dir, "profile"), {
        createdAt: CREATED,
        build: backup.manifest.app.build,
        passphrase: PASS,
        scryptWorkFactor: WF,
      });
      expect(strFromU8(again.bytes.slice(0, 22))).toBe("age-encryption.org/v1\n");
      expect(again.zip).toEqual(await plain(backup.blob));
      sqlite = setupTestDb();
    });

    // Temp files only: never the real default path.
    const file = (text: string, mode: number) => {
      const path = join(dir, "pass");
      writeFileSync(path, text);
      chmodSync(path, mode);
      return path;
    };
    const noPrompt = () => undefined;

    it("passphrase order: env, then the file, then the prompt", () => {
      const path = file("from-the-file-passphrase\n", 0o600);
      expect(
        resolvePassphrase(
          { FISCODE_BACKUP_PASSPHRASE: "from-the-env", FISCODE_BACKUP_PASSPHRASE_FILE: path },
          noPrompt,
        ),
      ).toBe("from-the-env");
      // One trailing newline is stripped, nothing else.
      expect(resolvePassphrase({ FISCODE_BACKUP_PASSPHRASE_FILE: path }, noPrompt)).toBe(
        "from-the-file-passphrase",
      );
      expect(
        resolvePassphrase({ FISCODE_BACKUP_PASSPHRASE_FILE: join(dir, "none") }, () => "typed"),
      ).toBe("typed");
    });

    it("a group- or other-readable file is refused without revealing it; no source at all is a clear error", () => {
      for (const mode of [0o640, 0o604, 0o644]) {
        const path = file("from-the-file-passphrase", mode);
        let message = "";
        try {
          resolvePassphrase({ FISCODE_BACKUP_PASSPHRASE_FILE: path }, noPrompt);
        } catch (err) {
          message = (err as Error).message;
        }
        expect(message).toMatch(/chmod 600/);
        expect(message).not.toContain("from-the-file-passphrase");
      }
      expect(() =>
        resolvePassphrase({ FISCODE_BACKUP_PASSPHRASE_FILE: join(dir, "none") }, noPrompt),
      ).toThrow(/No passphrase/);
    });

    it("the script refuses a passphrase argument, and errors clearly with no source and no terminal", () => {
      const bin = fileURLToPath(new URL("../bin/fiscode-backup.ts", import.meta.url));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        FISCODE_BACKUP_PASSPHRASE_FILE: join(dir, "none"),
      };
      delete env.FISCODE_BACKUP_PASSPHRASE;
      const arg = spawnSync("bun", [bin, "verify", "x.zip.age", "--passphrase", PASS], {
        encoding: "utf8",
        env,
      });
      expect(arg.status).toBe(2);
      expect(arg.stderr).not.toContain(PASS);
      // setsid: no controlling terminal, so /dev/tty can't open.
      const none = spawnSync("setsid", ["-w", "bun", bin, "verify", "x.zip.age"], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(none.stderr).toMatch(/No passphrase/);
      expect(none.status).toBe(1);
    }, 30_000);
  });
});

describe("review #85 r4", () => {
  const all = () => buildBundle({ includeDeleted: true, includeHistory: true });
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fiscode-backup-r4-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Where age's header ends: after the "--- <mac>" line. */
  const headerEnd = (bytes: Uint8Array) => {
    const text = strFromU8(bytes.subarray(0, 400));
    const at = text.indexOf("\n--- ");
    return at + text.slice(at + 1).indexOf("\n") + 2;
  };

  it("(1) a damaged file with the RIGHT passphrase is BackupFileCorruptError, not 'wrong'; nothing changes", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const good = new Uint8Array(await backup.blob.arrayBuffer());
    const end = headerEnd(good);
    expect(good.length).toBeGreaterThan(end + 100);
    const truncated = good.slice(0, good.length - 100);
    const zeroed = good.slice();
    zeroed[end + 60] = zeroed[end + 60]! ^ 0xff;
    const headerOnly = good.slice(0, end);
    const badMac = good.slice();
    badMac[end - 5] = badMac[end - 5] === 0x41 ? 0x42 : 0x41; // inside the header MAC
    const before = await all();
    for (const bytes of [truncated, zeroed, headerOnly, badMac]) {
      const read = readBackup(new Blob([bytes as unknown as ArrayBuffer]), { passphrase: PASS });
      await expect(read).rejects.toBeInstanceOf(BackupFileCorruptError);
      await expect(
        readBackup(new Blob([bytes as unknown as ArrayBuffer]), { passphrase: PASS }),
      ).rejects.toThrow(/damaged.*Nothing was changed/);
    }
    // A wrong passphrase is still "wrong", even on a damaged file (the header is checked first).
    await expect(
      readBackup(new Blob([truncated as unknown as ArrayBuffer]), {
        passphrase: "not-the-passphrase",
      }),
    ).rejects.toBeInstanceOf(BackupPassphraseError);
    expect(normalized(await all())).toEqual(normalized(before));
  });

  it("(3) a passphrase 'file' that is a directory gets its own message", () => {
    mkdirSync(join(dir, "a-dir"), { mode: 0o755 });
    expect(() =>
      resolvePassphrase({ FISCODE_BACKUP_PASSPHRASE_FILE: join(dir, "a-dir") }, () => undefined),
    ).toThrow(/isn't a file/);
  });

  it("(5) the script opens a plain .zip without asking for a passphrase", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const zip = join(dir, "fiscode-backup-2026-11-21.zip");
    writeFileSync(zip, await plain(backup.blob));
    const bin = fileURLToPath(new URL("../bin/fiscode-backup.ts", import.meta.url));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FISCODE_BACKUP_PASSPHRASE_FILE: join(dir, "none"),
    };
    delete env.FISCODE_BACKUP_PASSPHRASE;
    // No passphrase source and no terminal: a plain zip still verifies and round-trips.
    const run = (...args: string[]) =>
      spawnSync("setsid", ["-w", "bun", bin, ...args], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    const verify = run("verify", zip);
    expect(verify.stderr).toBe("");
    expect(verify.status).toBe(0);
    expect(run("check-roundtrip", zip).stdout.trim()).toBe("identical");
    // The encrypted one still needs it.
    const age = join(dir, backup.fileName);
    writeFileSync(age, new Uint8Array(await backup.blob.arrayBuffer()));
    expect(run("verify", age).stderr).toMatch(/No passphrase/);
  }, 30_000);
});

describe("#85 follow-ups (r2 a-c, r5 d-f)", () => {
  const withManifest = (entries: Record<string, Uint8Array>, m: unknown) =>
    rezip({ ...entries, "manifest.json": strToU8(JSON.stringify(m)) });
  const manifestOf = (entries: Record<string, Uint8Array>) =>
    JSON.parse(strFromU8(entries["manifest.json"]!)) as BackupManifest;

  it("(a) human paths are safe on Windows: no reserved characters, device names or trailing dots", async () => {
    await importBundle(exampleBundle() as never, "import-restore");
    const con = await folderRepo.create({ name: "CON" });
    const names = [
      'Receipt: "Q1" <draft>?.pdf',
      "a|b*c.pdf",
      "nul.txt",
      "aux",
      "com1.pdf",
      "LPT9.tar.gz",
      "ends with dot.",
      "ends with space ",
      "console.pdf", // not reserved: only the exact device name is
    ];
    for (const name of names) {
      await documentRepo.upload(file(name, `bytes of ${name}`), { folderId: con.id });
    }
    const { manifest } = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const live = manifest.documents.map((d) => d.path).filter((p) => !p.includes("/.versions/"));
    expect(live).toHaveLength(names.length);
    const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
    for (const path of live) {
      for (const segment of path.split("/")) {
        expect(segment).not.toMatch(/[<>:"|?*]/);
        expect(segment).not.toMatch(RESERVED);
        expect(segment).not.toMatch(/[. ]$/);
      }
    }
    expect(live).toContain("documents/_CON/Receipt_ _Q1_ _draft__.pdf");
    expect(live).toContain("documents/_CON/_nul.txt");
    expect(live).toContain("documents/_CON/console.pdf");
    // Still restores exactly: paths are for people, the manifest's sha256 is what restores.
    const read = await openBackup(
      (await createBackup({ createdAt: CREATED, passphrase: PASS, scryptWorkFactor: WF })).blob,
    );
    expect(read.ok).toBe(true);
  });

  it("(a) two names that become the same safe name are still told apart", async () => {
    await importBundle(exampleBundle() as never, "import-restore");
    await documentRepo.upload(file("a?b.pdf", "one"));
    await documentRepo.upload(file("a*b.pdf", "two"));
    const { manifest } = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    expect(
      manifest.documents
        .map((d) => d.path)
        .filter((p) => p.startsWith("documents/Unfiled/"))
        .toSorted(),
    ).toEqual(["documents/Unfiled/a_b (2).pdf", "documents/Unfiled/a_b.pdf"]);
  });

  it("(c) a manifest that lists a path or a sha twice is refused", async () => {
    await seed();
    const entries = await zipEntries(
      (await createBackup({ createdAt: CREATED, passphrase: PASS, scryptWorkFactor: WF })).blob,
    );
    const m = manifestOf(entries);
    const first = m.documents[0]!;
    const twicePath = {
      ...m,
      documents: [...m.documents, first],
      counts: { ...m.counts, blobs: m.documents.length + 1 },
    };
    await expect(openBackup(withManifest(entries, twicePath))).rejects.toBeInstanceOf(
      BackupManifestError,
    );
    await expect(openBackup(withManifest(entries, twicePath))).rejects.toThrow(/twice/);
    const twiceSha = {
      ...m,
      documents: [...m.documents, { ...first, path: "documents/elsewhere.pdf" }],
      counts: { ...m.counts, blobs: m.documents.length + 1 },
    };
    await expect(
      openBackup(
        withManifest({ ...entries, "documents/elsewhere.pdf": entries[first.path]! }, twiceSha),
      ),
    ).rejects.toThrow(/twice/);
  });

  it("(b) a sha listed as both missing and in the zip is refused as contradictory", async () => {
    await seed();
    const entries = await zipEntries(
      (await createBackup({ createdAt: CREATED, passphrase: PASS, scryptWorkFactor: WF })).blob,
    );
    const m = manifestOf(entries);
    const both = { ...m, missing: [{ sha256: m.documents[0]!.sha256, documentIds: [] }] };
    await expect(openBackup(withManifest(entries, both))).rejects.toBeInstanceOf(
      BackupManifestError,
    );
    await expect(openBackup(withManifest(entries, both))).rejects.toThrow(/both missing and/);
  });

  it("(d) age-encryption's wrong-passphrase error is the one decryptBackup recognizes", async () => {
    // decryptBackup tells "wrong" from "damaged" by this message (the library exports no typed
    // error). If an upgrade changes it, this fails first: update AGE_NO_IDENTITY_MATCHED.
    const { Decrypter } = await import("age-encryption");
    const encrypted = await encryptBackup(strToU8("demo"), PASS, WF);
    const d = new Decrypter();
    d.addPassphrase("not-the-passphrase");
    const message = await d.decrypt(encrypted).then(
      () => "decrypted",
      (err: Error) => err.message,
    );
    expect(message).toMatch(AGE_NO_IDENTITY_MATCHED);
    await expect(decryptBackup(encrypted, "not-the-passphrase")).rejects.toBeInstanceOf(
      BackupPassphraseError,
    );
  });

  it("(e) check-roundtrip says 'identical' for a plain zip, 'identical (decrypted contents)' for .age", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const dir = mkdtempSync(join(tmpdir(), "fiscode-backup-fu-"));
    try {
      const age = join(dir, backup.fileName);
      const zip = join(dir, "fiscode-backup-2026-11-21.zip");
      writeFileSync(age, new Uint8Array(await backup.blob.arrayBuffer()));
      writeFileSync(zip, await plain(backup.blob));
      const bin = fileURLToPath(new URL("../bin/fiscode-backup.ts", import.meta.url));
      const run = (path: string) =>
        spawnSync("bun", [bin, "check-roundtrip", path], {
          encoding: "utf8",
          env: { ...process.env, FISCODE_BACKUP_PASSPHRASE: PASS },
        });
      expect(run(zip).stdout.trim()).toBe("identical");
      expect(run(age).stdout.trim()).toBe("identical (decrypted contents)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("(f) an empty answer at the prompt (Enter or Ctrl-D) says no passphrase was entered", () => {
    const env = {
      FISCODE_BACKUP_PASSPHRASE_FILE: join(tmpdir(), "fiscode-no-such-passphrase-file"),
    };
    expect(() => resolvePassphrase(env, () => "")).toThrow(/No passphrase entered/);
    expect(() => resolvePassphrase(env, () => "")).not.toThrow(/Enter its passphrase/);
  });
});

describe("review #87 r1", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fiscode-backup-87-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("(1) a backup made before Windows-safe names round-trips as 'identical contents', exit 0", async () => {
    await importBundle(exampleBundle() as never, "import-restore");
    const con = await folderRepo.create({ name: "CON" });
    await documentRepo.upload(file("a:b.pdf", "demo a:b"), { folderId: con.id });
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    // Rewrite it as ccf749afe (#85) wrote it: the names as they are, in the zip and the manifest.
    const entries = unzipSync(await plain(backup.blob));
    const m = JSON.parse(strFromU8(entries["manifest.json"]!)) as BackupManifest;
    const old = (p: string) => (p === "documents/_CON/a_b.pdf" ? "documents/CON/a:b.pdf" : p);
    expect(m.documents.map((d) => d.path)).toContain("documents/_CON/a_b.pdf");
    const rewritten: Record<string, Uint8Array> = {
      "manifest.json": strToU8(
        JSON.stringify({ ...m, documents: m.documents.map((d) => ({ ...d, path: old(d.path) })) }),
      ),
    };
    for (const [name, bytes] of Object.entries(entries)) {
      if (name !== "manifest.json") rewritten[old(name)] = bytes;
    }
    const oldAge = join(dir, "pre-87.zip.age");
    writeFileSync(oldAge, await encryptBackup(zipSync(rewritten), PASS, WF));
    const now = join(dir, backup.fileName);
    writeFileSync(now, new Uint8Array(await backup.blob.arrayBuffer()));
    teardownTestDb(sqlite);

    expect(await checkRoundtrip(oldAge, PASS)).toMatchObject({ identical: true, sameZip: false });
    expect(await checkRoundtrip(now, PASS)).toMatchObject({ identical: true, sameZip: true });
    const bin = fileURLToPath(new URL("../bin/fiscode-backup.ts", import.meta.url));
    const r = spawnSync("bun", [bin, "check-roundtrip", oldAge], {
      encoding: "utf8",
      env: { ...process.env, FISCODE_BACKUP_PASSPHRASE: PASS },
    });
    expect(r.stdout.trim()).toBe("identical contents (file names in the zip were updated)");
    expect(r.status).toBe(0);
    sqlite = setupTestDb();
  }, 30_000);

  it("(2) no document takes a folder's path: the zip extracts with no file where a directory goes", async () => {
    await importBundle(exampleBundle() as never, "import-restore");
    const p = await folderRepo.create({ name: "P" });
    await documentRepo.upload(file("x", "demo x"), { folderId: p.id });
    const xDot = await folderRepo.create({ name: "x.", parentId: p.id });
    await documentRepo.upload(file("in-sub.pdf", "demo in sub"), { folderId: xDot.id });
    const q = await folderRepo.create({ name: "Q" });
    await documentRepo.upload(file("Sub", "demo Sub"), { folderId: q.id });
    const sub = await folderRepo.create({ name: "sub", parentId: q.id });
    await documentRepo.upload(file("y.pdf", "demo y"), { folderId: sub.id });
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const entries = unzipSync(await plain(backup.blob));
    const names = Object.keys(entries);
    expect(names).toContain("documents/P/x (2)");
    expect(names).toContain("documents/P/x/in-sub.pdf");
    expect(names).toContain("documents/Q/Sub (2)");
    expect(names).toContain("documents/Q/sub/y.pdf");
    // No file is (ignoring case) a directory of another entry...
    const lower = names.map((n) => n.toLowerCase());
    for (const f of lower) expect(lower.some((o) => o.startsWith(`${f}/`))).toBe(false);
    // ...and a real extraction succeeds.
    const out = join(dir, "x");
    for (const [name, bytes] of Object.entries(entries)) {
      mkdirSync(dirname(join(out, name)), { recursive: true });
      writeFileSync(join(out, name), bytes);
    }
  });

  it("(3) the other device names Windows reserves: CONIN$, CONOUT$, COM¹-³, LPT¹-³", async () => {
    await importBundle(exampleBundle() as never, "import-restore");
    const names = ["CONIN$", "conout$.txt", "COM¹.txt", "com³", "LPT².pdf", "lpt¹", "COM4.ok"];
    for (const n of names) await documentRepo.upload(file(n, `demo ${n}`));
    const { manifest } = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const live = manifest.documents.map((d) => d.path.replace("documents/Unfiled/", ""));
    expect(live.toSorted()).toEqual(
      [
        "_CONIN$",
        "_conout$.txt",
        "_COM¹.txt",
        "_com³",
        "_LPT².pdf",
        "_lpt¹",
        "_COM4.ok",
      ].toSorted(),
    );
  });
});

describe("check-roundtrip when the restored contents differ", () => {
  // A raw byte flip never reaches the comparison: restore's sha256 check refuses it first. To get
  // identical: false, a backup has to pass every restore check and still back up differently.
  let dir: string;
  let entries: Record<string, Uint8Array>;
  let m: BackupManifest;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "fiscode-backup-neg-"));
    await importBundle(exampleBundle() as never, "import-restore");
    await documentRepo.upload(file("Demo receipt.pdf", "demo receipt"));
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    entries = unzipSync(await plain(backup.blob));
    m = JSON.parse(strFromU8(entries["manifest.json"]!)) as BackupManifest;
    teardownTestDb(sqlite); // the script's functions open their own database
  });
  afterEach(() => {
    sqlite = setupTestDb();
    rmSync(dir, { recursive: true, force: true });
  });

  const sha = (b: Uint8Array) => sha256Hex(new Blob([b as unknown as ArrayBuffer]));
  const write = async (name: string, zip: Record<string, Uint8Array>, manifest: unknown = m) => {
    const path = join(dir, `${name}.zip.age`);
    const files = { ...zip, "manifest.json": strToU8(JSON.stringify(manifest)) };
    writeFileSync(path, await encryptBackup(zipSync(files), PASS, WF));
    return path;
  };
  const script = (path: string) =>
    spawnSync(
      "bun",
      [
        fileURLToPath(new URL("../bin/fiscode-backup.ts", import.meta.url)),
        "check-roundtrip",
        path,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, FISCODE_BACKUP_PASSPHRASE: PASS },
      },
    );

  it("a document's bytes changed: refused before comparing (BackupFileCorruptError naming it), exit 1", async () => {
    const d = m.documents[0]!;
    const bytes = entries[d.path]!.slice();
    bytes[0]! ^= 1;
    const path = await write("doc-byte", { ...entries, [d.path]: bytes });
    await expect(checkRoundtrip(path, PASS)).rejects.toBeInstanceOf(BackupFileCorruptError);
    await expect(checkRoundtrip(path, PASS)).rejects.toThrow(d.path);
    const r = script(path);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/identical/);
    expect(r.stderr).toContain(d.path);
  }, 30_000);

  it("the CSV's bytes changed: refused before comparing, exit 1", async () => {
    const csv = entries[m.csv.path]!.slice();
    csv[csv.length - 3]! ^= 1;
    const path = await write("csv-byte", { ...entries, [m.csv.path]: csv });
    await expect(checkRoundtrip(path, PASS)).rejects.toBeInstanceOf(BackupFileCorruptError);
    const r = script(path);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/identical/);
  }, 30_000);

  it("a CSV that restores but re-exports differently (LF line endings, resealed): identical false, exit 1", async () => {
    const lf = entries[m.csv.path]!.filter((c) => c !== 0x0d); // the BOM stays
    expect(lf.length).toBeLessThan(entries[m.csv.path]!.length);
    const manifest = { ...m, csv: { ...m.csv, sha256: await sha(lf), sizeBytes: lf.length } };
    const path = await write("csv-lf", { ...entries, [m.csv.path]: lf }, manifest);
    expect(await checkRoundtrip(path, PASS)).toMatchObject({ identical: false, sameZip: false });
    const r = script(path);
    expect(r.stdout.trim()).toBe("DIFFERENT: the restored profile backs up to other contents");
    expect(r.status).toBe(1);
  }, 30_000);

  it("a listed document file nothing references: restored, then not backed up again: identical false, exit 1", async () => {
    const extra = strToU8("demo bytes no document uses");
    const extraSha = await sha(extra);
    const path = `documents/.versions/${extraSha}`;
    const manifest = {
      ...m,
      documents: [
        ...m.documents,
        { path, sha256: extraSha, sizeBytes: extra.length, documentIds: [] },
      ],
      counts: { ...m.counts, blobs: m.counts.blobs + 1 },
    };
    const file = await write("extra-file", { ...entries, [path]: extra }, manifest);
    expect(await checkRoundtrip(file, PASS)).toMatchObject({ identical: false, sameZip: false });
    const r = script(file);
    expect(r.stdout.trim()).toBe("DIFFERENT: the restored profile backs up to other contents");
    expect(r.status).toBe(1);
  }, 30_000);

  it("control: a document byte changed and resealed everywhere is a different valid backup: identical", async () => {
    // The check compares what restores, so a consistent edit round-trips (it isn't a forgery check).
    const d = m.documents[0]!;
    const bytes = entries[d.path]!.slice();
    bytes[0]! ^= 1;
    const newSha = await sha(bytes);
    const raw = entries[m.csv.path]!;
    const csv = new Uint8Array([
      ...raw.slice(0, 3),
      ...strToU8(strFromU8(raw.slice(3)).replaceAll(d.sha256, newSha)),
    ]);
    const manifest = {
      ...m,
      csv: { ...m.csv, sha256: await sha(csv), sizeBytes: csv.length },
      documents: m.documents.map((x) => (x === d ? { ...x, sha256: newSha } : x)),
    };
    const path = await write(
      "resealed",
      { ...entries, [d.path]: bytes, [m.csv.path]: csv },
      manifest,
    );
    expect(await checkRoundtrip(path, PASS)).toMatchObject({ identical: true });
    expect(script(path).status).toBe(0);
  }, 30_000);
});

describe("a backup restore is its own History entry (backup-restore)", () => {
  const snapshots = async () =>
    (await historyRepo.listAll()).filter((h) => h.entity === "__import_snapshot");

  it("over existing data: one backup-restore snapshot with the backup's time; the data is the backup's", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const expected = normalized(await buildBundle({ includeDeleted: true }));
    await folderRepo.create({ name: "Made after the backup" });
    const before = (await snapshots()).length;
    const read = await openBackup(backup.blob);
    if (!read.ok) throw new Error(read.headline);
    await restoreBackup(read);
    const added = (await snapshots()).slice(before);
    expect(added.map((s) => s.entityId)).toEqual(["backup-restore"]);
    expect(JSON.parse(added[0]!.afterJson!).backup).toEqual({ createdAt: CREATED });
    expect(normalized(await buildBundle({ includeDeleted: true }))).toEqual(expected);
  });

  it("into an empty profile: no snapshot (nothing to go back to), so the restore stays exact", async () => {
    await seed();
    const backup = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    const logBefore = (await historyRepo.listAll()).map((h) => h.id);
    emptyProfile();
    const read = await openBackup(backup.blob);
    if (!read.ok) throw new Error(read.headline);
    await restoreBackup(read);
    // The same entries (listAll's order among equal times isn't fixed): nothing added.
    const logAfter = (await historyRepo.listAll()).map((h) => h.id);
    expect(logAfter.toSorted()).toEqual(logBefore.toSorted());
  });

  it("then backed up and restored again: the backup-restore entry survives byte for byte", async () => {
    await seed();
    const first = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    await folderRepo.create({ name: "Made after the backup" });
    const read = await openBackup(first.blob);
    if (!read.ok) throw new Error(read.headline);
    await restoreBackup(read); // writes the backup-restore entry
    const second = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    emptyProfile();
    const again = await openBackup(second.blob);
    if (!again.ok) throw new Error(again.headline);
    await restoreBackup(again);
    const third = await createBackup({
      createdAt: CREATED,
      passphrase: PASS,
      scryptWorkFactor: WF,
    });
    expect(await plain(third.blob)).toEqual(await plain(second.blob));
    expect((await snapshots()).some((s) => s.entityId === "backup-restore")).toBe(true);
  });
});
