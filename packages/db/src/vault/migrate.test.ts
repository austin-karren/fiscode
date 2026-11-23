import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { newId, VaultMigratingError } from "@fiscode/core";
import { eq } from "drizzle-orm";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import { getDb } from "../client.ts";
import { document, documentFolder, history, meta } from "../schema/index.ts";
import {
  documentRepo,
  linkedDates,
  prepareVault,
  REPATH_DONE_KEY,
  runVaultStartup,
} from "../repo/index.ts";
import { memoryDir, type VaultDirHandle } from "./dir.ts";
import {
  isVaultMigrated,
  migrateToVault,
  readVaultMigrationReport,
  type MigrationProgress,
} from "./migrate.ts";
import { __resetVaultMigrationStateForTests, getVaultMigrationState } from "./state.ts";
import {
  __setVaultStoreForTests,
  oldBytesPath,
  sha256Hex,
  vaultStore,
  type VaultStore,
} from "./store.ts";

// The blob → tree migration (ADR 0001 § 10). Documents are seeded as main stores them today:
// rows without vault_path, bytes as by-sha blobs.

let sqlite: Database.Database;
let root: VaultDirHandle;
let store: VaultStore;
beforeEach(() => {
  sqlite = setupTestDb();
  root = memoryDir();
  store = vaultStore(root);
  __setVaultStoreForTests(store, root);
});
afterEach(() => {
  __setVaultStoreForTests(undefined);
  __resetVaultMigrationStateForTests();
  teardownTestDb(sqlite);
});

const datesFor = linkedDates;

/** A document as main has it: a blob by sha and a row with no vault_path. */
const seed = async (
  name: string,
  bytes: string,
  o: { addedAt?: string; folderId?: string | null; deletedAt?: string | null; blob?: boolean } = {},
) => {
  const blob = new Blob([bytes]);
  const sha256 = await sha256Hex(blob);
  if (o.blob !== false) await store.put(sha256, blob);
  const row = {
    id: newId(),
    folderId: o.folderId ?? null,
    name,
    mime: "application/pdf",
    sizeBytes: blob.size,
    sha256,
    addedAt: o.addedAt ?? "2026-01-05T10:00:00.000Z",
    notes: null,
    deletedAt: o.deletedAt ?? null,
    createdAt: "2026-01-05T10:00:00.000Z",
    updatedAt: "2026-01-05T10:00:00.000Z",
  };
  await getDb().insert(document).values(row);
  await getDb()
    .insert(history)
    .values({
      id: newId(),
      entity: "document",
      entityId: row.id,
      op: "insert",
      beforeJson: null,
      afterJson: JSON.stringify(row),
      at: row.createdAt,
    });
  return row;
};

/** An earlier version in History, as replaceBytes on main wrote it. */
const seedOldVersion = async (doc: { id: string; sha256: string }, bytes: string) => {
  const blob = new Blob([bytes]);
  const sha256 = await sha256Hex(blob);
  await store.put(sha256, blob);
  await getDb()
    .insert(history)
    .values({
      id: newId(),
      entity: "document",
      entityId: doc.id,
      op: "update",
      beforeJson: JSON.stringify({ sha256 }),
      afterJson: JSON.stringify({ sha256: doc.sha256 }),
      at: "2026-01-06T00:00:00.000Z",
    });
  return sha256;
};

const seedFolder = async (name: string, parentId: string | null = null) => {
  const row = {
    id: newId(),
    parentId,
    name,
    taxYear: null,
    sortOrder: 0,
    defaultKey: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await getDb().insert(documentFolder).values(row);
  return row;
};

const pathOf = async (id: string) =>
  (await getDb().select().from(document).where(eq(document.id, id)))[0]!.vaultPath;

describe("migrateToVault", () => {
  it("copies every live document into the tree, old bytes into _fiscode, and marks it done", async () => {
    const f = await seedFolder("Receipts");
    const a = await seed("Amazon NAS.pdf", "nas", { folderId: f.id });
    const old = await seedOldVersion(a, "nas v0");
    const gone = await seed("Gone.pdf", "gone", { deletedAt: "2026-02-01T00:00:00.000Z" });
    const progress: MigrationProgress[] = [];

    const report = await migrateToVault({ datesFor, onProgress: (p) => progress.push(p) });

    expect(await pathOf(a.id)).toBe("documents/Receipts/2026-01-05 Amazon NAS.pdf");
    expect(await store.holds("documents/Receipts/2026-01-05 Amazon NAS.pdf", a.sha256)).toBe(true);
    expect(await store.holds(oldBytesPath("versions", old), old)).toBe(true);
    expect(await store.holds(oldBytesPath("trash", gone.sha256), gone.sha256)).toBe(true);
    expect(await pathOf(gone.id)).toBeNull();
    // The old store stays whole (D9).
    expect(await store.has(a.sha256)).toBe(true);
    expect(progress.at(-1)).toEqual({ phase: "migrating", done: 3, total: 3 });
    expect(getVaultMigrationState()).toEqual({ phase: "done" });
    expect(await isVaultMigrated()).toBe(true);
    expect(report).toMatchObject({ documents: 1, placed: 1, oldBytesKept: 2, missing: [] });
    // The report is persisted for /documents/check.
    expect(await readVaultMigrationReport()).toEqual(report);
    const manifest = JSON.parse((await (await store.read("fiscode.json"))!.text()) as string);
    expect(Object.keys(manifest.blobs).sort()).toEqual([old, gone.sha256].sort());
  });

  it("gives the earlier-added document the plain name, whatever the row order", async () => {
    const later = await seed("Invoice.pdf", "later", { addedAt: "2026-01-05T12:00:00.000Z" });
    const earlier = await seed("invoice.pdf", "earlier", { addedAt: "2026-01-05T08:00:00.000Z" });
    await migrateToVault({ datesFor });
    expect(await pathOf(earlier.id)).toBe("documents/Unfiled/2026-01-05 invoice.pdf");
    expect(await pathOf(later.id)).toBe("documents/Unfiled/2026-01-05 Invoice (2).pdf");
  });

  it("is resumable: a cancel leaves both stores readable, and the rerun ends where one run would", async () => {
    const docs = [];
    for (let i = 0; i < 4; i++) {
      docs.push(
        await seed(`Doc ${i}.pdf`, `bytes ${i}`, { addedAt: `2026-01-0${i + 1}T00:00:00.000Z` }),
      );
    }
    const ac = new AbortController();
    await expect(
      migrateToVault({
        datesFor,
        signal: ac.signal,
        onProgress: (p) => {
          if (p.done === 2) ac.abort();
        },
      }),
    ).rejects.toThrow();
    // Still read-only after a cancel (r1 B4), with a reason the banner can show.
    expect(getVaultMigrationState()).toMatchObject({
      phase: "migration-incomplete",
      reason: "cancelled",
    });
    expect(await isVaultMigrated()).toBe(false);
    // Half done, every document still reads (tree or old store).
    expect(await pathOf(docs[3]!.id)).toBeNull();
    for (const [i, d] of docs.entries()) {
      expect(await (await documentRepo.readBytes(d.id)).text()).toBe(`bytes ${i}`);
    }
    const report = await migrateToVault({ datesFor });
    expect(report.placed).toBe(2);
    for (const [i, d] of docs.entries()) {
      expect(await pathOf(d.id)).toBe(`documents/Unfiled/2026-01-0${i + 1} Doc ${i}.pdf`);
    }
  });

  it("shortens an over-budget folder and a long title, reports both, and never stops", async () => {
    const a = await seedFolder("A".repeat(120));
    const b = await seedFolder("B".repeat(110), a.id);
    const d = await seed(`${"T".repeat(110)}.pdf`, "t", { folderId: b.id });
    const report = await migrateToVault({ datesFor });
    expect(report.foldersShortened).toHaveLength(1);
    expect(report.foldersShortened[0]).toMatchObject({ folderId: a.id, from: "A".repeat(120) });
    const path = (await pathOf(d.id))!;
    expect(path.length).toBeLessThanOrEqual(240);
    expect(report.titlesShortened).toEqual([{ documentId: d.id, name: d.name, path }]);
    // The folder row carries the shorter name, with History.
    const [row] = await getDb().select().from(documentFolder).where(eq(documentFolder.id, a.id));
    expect(row!.name.length).toBeLessThan(120);
  });

  it("lists bytes this device doesn't have, or that don't match, and still finishes", async () => {
    const lost = await seed("Lost.pdf", "lost", { blob: false });
    const bad = await seed("Bad.pdf", "good", { addedAt: "2026-01-06T00:00:00.000Z" });
    // Damage the blob in place (put would skip: a blob with that sha is there).
    const dir = await (
      await (await root.getDirectoryHandle("documents")).getDirectoryHandle("blobs")
    ).getDirectoryHandle(bad.sha256.slice(0, 2));
    const w = await (await dir.getFileHandle(bad.sha256)).createWritable();
    await w.write(new Blob(["tampered"]));
    await w.close();
    const report = await migrateToVault({ datesFor });
    expect(report.missing).toEqual([
      { documentId: lost.id, sha256: lost.sha256, reason: "missing" },
      { documentId: bad.id, sha256: bad.sha256, reason: "damaged" },
    ]);
    expect(await pathOf(bad.id)).toBeNull();
    expect(await pathOf(lost.id)).toBeNull();
    expect(await isVaultMigrated()).toBe(true);
  });

  it("never overwrites a file it doesn't know: the document takes the next (n)", async () => {
    const d = await seed("Note.pdf", "mine");
    await store.write("documents/Unfiled/2026-01-05 Note.pdf", new Blob(["someone else's"]));
    await migrateToVault({ datesFor });
    expect(await pathOf(d.id)).toBe("documents/Unfiled/2026-01-05 Note (2).pdf");
    expect(await (await store.read("documents/Unfiled/2026-01-05 Note.pdf"))!.text()).toBe(
      "someone else's",
    );
  });

  it("adopts a file already written with the right bytes (a crash before vault_path was set)", async () => {
    const d = await seed("Note.pdf", "mine");
    await store.write("documents/Unfiled/2026-01-05 Note.pdf", new Blob(["mine"]));
    const report = await migrateToVault({ datesFor });
    expect(await pathOf(d.id)).toBe("documents/Unfiled/2026-01-05 Note.pdf");
    expect(report.placed).toBe(0);
  });
});

describe("app start", () => {
  it("prepareVault makes Documents read-only until the job finishes", async () => {
    await seed("A.pdf", "a");
    await prepareVault();
    expect(getVaultMigrationState().phase).toBe("migrating");
    await expect(
      documentRepo.upload(
        Object.assign(new Blob(["b"], { type: "application/pdf" }), { name: "B.pdf" }),
      ),
    ).rejects.toBeInstanceOf(VaultMigratingError);
    await runVaultStartup();
    expect(getVaultMigrationState()).toEqual({ phase: "done" });
  });

  it("the boot backstop places only live rows without a vault_path", async () => {
    const placed = await seed("Placed.pdf", "p");
    await runVaultStartup();
    // An import brings a row without a path; an outside edit changes a placed file.
    const imported = await seed("Imported.pdf", "i");
    const placedPath = (await pathOf(placed.id))!;
    await store.write(placedPath, new Blob(["edited outside"]));
    await runVaultStartup();
    expect(await pathOf(imported.id)).toBe("documents/Unfiled/2026-01-05 Imported.pdf");
    // Left to the reconcile scan: not overwritten.
    expect(await (await store.read(placedPath))!.text()).toBe("edited outside");
  });

  it("after the migration, boot re-paths a double-dated file once", async () => {
    const d = await seed("2026-08-12 Demo bill.pdf", "b");
    await runVaultStartup();
    const fixed = (await pathOf(d.id))!;
    expect(fixed).toBe("documents/Unfiled/2026-08-12 Demo bill.pdf");
    // Where the old rule put it.
    const old = "documents/Unfiled/2026-01-05 2026-08-12 Demo bill.pdf";
    await store.write(old, (await store.read(fixed))!);
    await store.remove(fixed);
    await getDb().update(document).set({ vaultPath: old }).where(eq(document.id, d.id));
    await getDb().delete(meta).where(eq(meta.key, REPATH_DONE_KEY));
    const seen: string[] = [];
    await runVaultStartup({ onRepathProgress: (p) => seen.push(p.phase) });
    expect(await pathOf(d.id)).toBe(fixed);
    expect(seen).toEqual(["repathing", "done"]);
    // Once: done is recorded, so the next boot doesn't run it.
    seen.length = 0;
    await runVaultStartup({ onRepathProgress: (p) => seen.push(p.phase) });
    expect(seen).toEqual([]);
  });

  it("a migration done in another tab is not run again", async () => {
    await getDb().insert(meta).values({ key: "vault_migration", value: "done" });
    await prepareVault();
    expect(getVaultMigrationState()).toEqual({ phase: "done" });
  });
});

describe("app start never blocks the app", () => {
  it("prepareVault reports failed instead of throwing", async () => {
    sqlite.exec("DROP TABLE meta");
    await expect(prepareVault()).resolves.toBeUndefined();
    expect(getVaultMigrationState()).toMatchObject({
      phase: "migration-incomplete",
      reason: "failed",
    });
  });
});

describe("r1 B4: only the migration job places documents before it is done", () => {
  it("a tree change before the migration leaves unplaced rows alone", async () => {
    const old = await seed("Old.pdf", "old");
    await documentRepo.upload(
      Object.assign(new Blob(["n"], { type: "application/pdf" }), { name: "New.pdf" }),
    );
    expect(await pathOf(old.id)).toBeNull();
    // After the job is done, the backstop in a tree change does place them.
    await migrateToVault({ datesFor });
    expect(await pathOf(old.id)).toBe("documents/Unfiled/2026-01-05 Old.pdf");
  });

  it("a failed job leaves Documents read-only, and Resume finishes it", async () => {
    const { resumeVaultMigration } = await import("../repo/index.ts");
    const d = await seed("A.pdf", "a");
    await prepareVault();
    // Make the job fail: the row update hits a trigger.
    sqlite.exec(`CREATE TRIGGER stop BEFORE UPDATE OF vault_path ON document
      BEGIN SELECT RAISE(ABORT, 'disk gone'); END`);
    await runVaultStartup();
    expect(getVaultMigrationState()).toMatchObject({
      phase: "migration-incomplete",
      reason: "failed",
    });
    await expect(documentRepo.rename(d.id, "B.pdf")).rejects.toThrow(/didn't finish/);
    sqlite.exec("DROP TRIGGER stop");
    await resumeVaultMigration();
    expect(getVaultMigrationState()).toEqual({ phase: "done" });
    expect(await pathOf(d.id)).toBe("documents/Unfiled/2026-01-05 A.pdf");
  });
});
