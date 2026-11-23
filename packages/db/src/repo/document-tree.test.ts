import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { VaultMigratingError, VaultPathTooLongError, MAX_VAULT_PATH } from "@fiscode/core";
import { eq } from "drizzle-orm";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import {
  __resetVaultMigrationStateForTests,
  __setVaultStoreForTests,
  JOURNAL_FILE,
  memoryDir,
  oldBytesPath,
  readJournal,
  recoverVault,
  setVaultMigrationState,
  sha256Hex,
  vaultStore,
  writeJournal,
  type VaultDirHandle,
  type VaultStore,
} from "../vault/index.ts";
import { buildBundle, documentRepo, expenseRepo, folderRepo, historyRepo } from "./index.ts";
import { getDb } from "../client.ts";
import { document, vaultApplied } from "../schema/index.ts";

// Every repo tree op writes through the vault journal (ADR 0001 § 6, PR 3).

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

const file = (name: string, text: string, type = "application/pdf") =>
  Object.assign(new Blob([text], { type }), { name });
const today = () => new Date().toISOString().slice(0, 10);
const text = async (path: string) => (await store.read(path))?.text();

/** Every file under `vault/`, sorted, without the manifest. */
const tree = async (dir = ""): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await store.list(dir)) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.kind === "directory") out.push(...(await tree(path)));
    else if (path !== "fiscode.json") out.push(path);
  }
  return out.sort();
};

describe("upload", () => {
  it("writes the file at its vault path and records it, with the manifest", async () => {
    const d = await documentRepo.upload(file("Receipt.pdf", "r1"));
    const path = `documents/Unfiled/${today()} Receipt.pdf`;
    expect(d.vaultPath).toBe(path);
    expect(await text(path)).toBe("r1");
    expect(await tree()).toEqual([path]);
    const manifest = JSON.parse((await text("fiscode.json"))!);
    expect(manifest.documents[d.id]).toEqual({ path, sha256: d.sha256, sizeBytes: 2 });
    // The journal and its ledger row are gone once done.
    expect(await readJournal(root)).toBeUndefined();
    expect(await getDb().select().from(vaultApplied)).toEqual([]);
  });

  it("goes under the folder's path, and a clash gets (2) in upload order", async () => {
    const [year, expenses] = await folderRepo.ensureYearDefaults(2026);
    expect(year).toBeDefined();
    const a = await documentRepo.upload(file("NAS.pdf", "a"), { folderId: expenses!.id });
    const b = await documentRepo.upload(file("nas.pdf", "b"), { folderId: expenses!.id });
    expect(a.vaultPath).toBe(`documents/2026/Expenses/${today()} NAS.pdf`);
    expect(b.vaultPath).toBe(`documents/2026/Expenses/${today()} nas (2).pdf`);
  });

  it("keeps vault_path out of History and the bundle (it is this device's)", async () => {
    const d = await documentRepo.upload(file("A.pdf", "a"));
    const [h] = await historyRepo.listFor("document", d.id);
    expect(h!.afterJson).not.toContain("vaultPath");
    const bundle = await buildBundle({ includeHistory: true });
    expect(Object.keys(bundle.documents[0]!)).not.toContain("vaultPath");
  });
});

describe("rename and move", () => {
  it("renaming a document moves its file", async () => {
    const d = await documentRepo.upload(file("A.pdf", "a"));
    const r = await documentRepo.rename(d.id, "Better name.pdf");
    expect(r.vaultPath).toBe(`documents/Unfiled/${today()} Better name.pdf`);
    expect(await tree()).toEqual([r.vaultPath]);
  });

  it("moving a document moves its file, and the old folder goes when empty", async () => {
    const f = await folderRepo.create({ name: "Trips" });
    const d = await documentRepo.upload(file("A.pdf", "a"), { folderId: f.id });
    const g = await folderRepo.create({ name: "Other" });
    const r = await documentRepo.move(d.id, g.id);
    expect(await tree()).toEqual([`documents/Other/${today()} A.pdf`]);
    expect(r.vaultPath).toBe(`documents/Other/${today()} A.pdf`);
    expect(await store.list("documents/Trips")).toEqual([]);
  });

  it("a notes edit doesn't move the file or renumber its (2)", async () => {
    const a = await documentRepo.upload(file("X.pdf", "a"));
    const b = await documentRepo.upload(file("X.pdf", "b"));
    await documentRepo.softDelete(a.id);
    const r = await documentRepo.update(b.id, { notes: "kept" });
    expect(r!.vaultPath).toBe(b.vaultPath);
    expect(b.vaultPath).toContain(" (2).pdf");
  });

  it("a folder rename moves every file below it and re-runs vaultPath for each", async () => {
    const top = await folderRepo.create({ name: "T" });
    const sub = await folderRepo.create({ name: "S".repeat(60), parentId: top.id });
    const a = await documentRepo.upload(file("A.pdf", "a"), { folderId: top.id });
    // A title long enough that a longer folder name must cut it (PR 1 review r3).
    const longTitle = `${"L".repeat(100)}.pdf`;
    const b = await documentRepo.upload(file(longTitle, "b"), { folderId: sub.id });
    expect(b.vaultPath).toBe(`documents/T/${"S".repeat(60)}/${today()} ${longTitle}`);
    // Still passes folderPathFits ("documents/<100>/<60>" + 30 ≤ 240), but the title no longer fits.
    await folderRepo.rename(top.id, "N".repeat(100));
    const [a2, b2] = [await documentRepo.get(a.id), await documentRepo.get(b.id)];
    const dir = `documents/${"N".repeat(100)}`;
    expect(a2!.vaultPath).toBe(`${dir}/${today()} A.pdf`);
    expect(b2!.vaultPath!.startsWith(`${dir}/${"S".repeat(60)}/${today()} LLLL`)).toBe(true);
    expect(b2!.vaultPath!.length).toBeLessThanOrEqual(MAX_VAULT_PATH);
    expect(await tree()).toEqual([a2!.vaultPath, b2!.vaultPath].sort());
    expect(await text(b2!.vaultPath!)).toBe("b");
  });

  it("refuses a folder rename or move whose deepest folder would be over budget", async () => {
    const top = await folderRepo.create({ name: "T" });
    const sub = await folderRepo.create({ name: "S".repeat(100), parentId: top.id });
    const d = await documentRepo.upload(file("A.pdf", "a"), { folderId: sub.id });
    await expect(folderRepo.rename(top.id, "N".repeat(110))).rejects.toBeInstanceOf(
      VaultPathTooLongError,
    );
    const deep = await folderRepo.create({ name: "D".repeat(110) });
    await expect(folderRepo.move(top.id, deep.id)).rejects.toBeInstanceOf(VaultPathTooLongError);
    // Nothing changed.
    expect((await folderRepo.get(top.id))!.name).toBe("T");
    expect(await tree()).toEqual([(await documentRepo.get(d.id))!.vaultPath]);
  });

  it("refuses to create a folder over budget", async () => {
    const a = await folderRepo.create({ name: "A".repeat(110) });
    await expect(
      folderRepo.create({ name: "B".repeat(100), parentId: a.id }),
    ).rejects.toBeInstanceOf(VaultPathTooLongError);
    expect(await folderRepo.list()).toHaveLength(1);
  });
});

describe("bytes: replace, delete, restore, History revert", () => {
  it("replace keeps the old bytes in _fiscode/versions and writes the new ones in place", async () => {
    const d = await documentRepo.upload(file("A.pdf", "old"));
    const r = await documentRepo.replaceBytes(d.id, file("A.pdf", "new"));
    expect(r.vaultPath).toBe(d.vaultPath);
    expect(await text(r.vaultPath!)).toBe("new");
    expect(await text(oldBytesPath("versions", d.sha256))).toBe("old");
    expect(await (await documentRepo.readBytes(d.id)).text()).toBe("new");
  });

  it("soft delete moves the bytes to trash and the file out of the tree; restore brings it back", async () => {
    const d = await documentRepo.upload(file("A.pdf", "a"));
    await documentRepo.softDelete(d.id);
    expect(await tree()).toEqual([oldBytesPath("trash", d.sha256)]);
    const [snap] = await getDb().select().from(document).where(eq(document.id, d.id));
    await documentRepo.revertTo(d.id, { ...snap!, deletedAt: null });
    expect(await text(d.vaultPath!)).toBe("a");
    // Old bytes are never removed (another document may share them).
    expect(await text(oldBytesPath("trash", d.sha256))).toBe("a");
  });

  it("a folder tree delete and its undo round-trip the files", async () => {
    const f = await folderRepo.create({ name: "Trips" });
    const a = await documentRepo.upload(file("A.pdf", "a"), { folderId: f.id });
    const deleted = await folderRepo.softDeleteTree(f.id);
    expect((await tree()).filter((p) => p.startsWith("documents/"))).toEqual([]);
    await folderRepo.restoreTree(deleted);
    expect(await text(a.vaultPath!)).toBe("a");
  });

  it("a History revert to older bytes puts them back and keeps the current ones", async () => {
    const d = await documentRepo.upload(file("A.pdf", "v1"));
    const v2 = await documentRepo.replaceBytes(d.id, file("A.pdf", "v2"));
    const [first] = await historyRepo.listFor("document", d.id);
    const snapshot = JSON.parse(first!.afterJson!);
    const back = await documentRepo.revertTo(d.id, snapshot);
    expect(back!.sha256).toBe(d.sha256);
    expect(await text(back!.vaultPath!)).toBe("v1");
    expect(await text(oldBytesPath("versions", v2.sha256))).toBe("v2");
  });

  it("a History revert of a rename moves the file back", async () => {
    const d = await documentRepo.upload(file("A.pdf", "a"));
    await documentRepo.rename(d.id, "B.pdf");
    const back = await documentRepo.revertTo(d.id, { ...d, vaultPath: undefined } as never);
    expect(back!.vaultPath).toBe(d.vaultPath);
    expect(await tree()).toEqual([d.vaultPath]);
  });

  it("the date prefix follows the one linked record", async () => {
    const d = await documentRepo.upload(file("Monitor.pdf", "m"));
    const e = await expenseRepo.create({
      date: "2026-03-16",
      category: "equipment",
      description: "Demo monitor",
      amountCents: 129_99,
    } as never);
    const { documentLinkRepo } = await import("./documents.ts");
    await documentLinkRepo.link(d.id, "expense", e.id);
    const r = await documentRepo.rename(d.id, "Monitor receipt.pdf");
    expect(r.vaultPath).toBe("documents/Unfiled/2026-03-16 Monitor receipt.pdf");
  });
});

describe("crash safety", () => {
  it("a failed commit rolls the files back", async () => {
    const d = await documentRepo.upload(file("A.pdf", "a"));
    // A trigger makes the row commit fail after the file ops ran.
    const other = await documentRepo.upload(file("Z.pdf", "z"));
    sqlite.exec(`CREATE TRIGGER no_rename BEFORE UPDATE OF name ON document
      WHEN NEW.id = '${d.id}' BEGIN SELECT RAISE(ABORT, 'crash'); END`);
    await expect(documentRepo.rename(d.id, "B.pdf")).rejects.toThrow(/crash/);
    expect((await tree()).sort()).toEqual([d.vaultPath, other.vaultPath].sort());
    expect(await readJournal(root)).toBeUndefined();
  });

  it("a crash after the commit is rolled forward on boot", async () => {
    const d = await documentRepo.upload(file("A.pdf", "a"));
    // The journal can't be deleted once: as if the tab died right after the commit.
    const crashOnce = { left: 1 };
    const flaky: VaultDirHandle = {
      ...root,
      kind: "directory",
      getDirectoryHandle: root.getDirectoryHandle.bind(root),
      getFileHandle: root.getFileHandle.bind(root),
      entries: root.entries.bind(root),
      async removeEntry(name, o) {
        if (name === JOURNAL_FILE && crashOnce.left-- > 0) throw new Error("tab closed");
        return root.removeEntry(name, o);
      },
    };
    __setVaultStoreForTests(store, flaky);
    await expect(documentRepo.rename(d.id, "B.pdf")).rejects.toThrow(/tab closed/);
    expect(await readJournal(root)).toBeDefined();
    expect(await recoverVault()).toBe("rolled-forward");
    expect(await tree()).toEqual([`documents/Unfiled/${today()} B.pdf`]);
    expect(await getDb().select().from(vaultApplied)).toEqual([]);
  });

  it("a journal without its vault_applied row is rolled back on boot", async () => {
    const d = await documentRepo.upload(file("A.pdf", "a"));
    const to = `documents/Unfiled/${today()} B.pdf`;
    const plan = {
      planId: "p1",
      ops: [{ op: "move" as const, from: d.vaultPath!, to, sha256: d.sha256 }],
    };
    await writeJournal(root, plan);
    await store.move(d.vaultPath!, to, d.sha256); // the op ran, the rows never committed
    expect(await recoverVault()).toBe("rolled-back");
    expect(await tree()).toEqual([d.vaultPath]);
  });
});

describe("while the migration runs", () => {
  it("every document write throws VaultMigratingError; reads still work", async () => {
    const d = await documentRepo.upload(file("A.pdf", "a"));
    const f = await folderRepo.create({ name: "F" });
    setVaultMigrationState({ phase: "migrating", done: 0, total: 3 });
    await expect(documentRepo.upload(file("B.pdf", "b"))).rejects.toBeInstanceOf(
      VaultMigratingError,
    );
    await expect(documentRepo.rename(d.id, "C.pdf")).rejects.toBeInstanceOf(VaultMigratingError);
    await expect(documentRepo.softDelete(d.id)).rejects.toBeInstanceOf(VaultMigratingError);
    await expect(folderRepo.rename(f.id, "G")).rejects.toBeInstanceOf(VaultMigratingError);
    await expect(folderRepo.create({ name: "H" })).rejects.toBeInstanceOf(VaultMigratingError);
    expect(await (await documentRepo.readBytes(d.id)).text()).toBe("a");
    expect(await sha256Hex(await documentRepo.readBytes(d.id))).toBe(d.sha256);
  });
});

describe("review fixes", () => {
  it("a roll-forward on boot rewrites the manifest", async () => {
    const d = await documentRepo.upload(file("A.pdf", "a"));
    const crash = { left: 1 };
    const flaky: VaultDirHandle = {
      kind: "directory",
      getDirectoryHandle: root.getDirectoryHandle.bind(root),
      getFileHandle: root.getFileHandle.bind(root),
      entries: root.entries.bind(root),
      async removeEntry(name, o) {
        if (name === JOURNAL_FILE && crash.left-- > 0) throw new Error("tab closed");
        return root.removeEntry(name, o);
      },
    };
    __setVaultStoreForTests(store, flaky);
    await expect(documentRepo.rename(d.id, "B.pdf")).rejects.toThrow(/tab closed/);
    await recoverVault();
    const manifest = JSON.parse((await text("fiscode.json"))!);
    expect(manifest.documents[d.id].path).toBe(`documents/Unfiled/${today()} B.pdf`);
  });
});

describe("r1: a path changes exactly when its inputs change", () => {
  const linkExpense = async (docId: string, date: string) => {
    const e = await expenseRepo.create({
      date,
      category: "equipment",
      description: "Demo",
      amountCents: 1_00,
    } as never);
    const { documentLinkRepo } = await import("./documents.ts");
    return { e, link: await documentLinkRepo.link(docId, "expense", e.id) };
  };

  it("B1: a case-only document rename moves the file", async () => {
    const d = await documentRepo.upload(file("invoice.pdf", "i"));
    const r = await documentRepo.rename(d.id, "Invoice.pdf");
    expect(r.vaultPath).toBe(`documents/Unfiled/${today()} Invoice.pdf`);
    expect(await tree()).toEqual([r.vaultPath]);
  });

  it("B1: an accent-only document rename moves the file", async () => {
    const d = await documentRepo.upload(file("Resume.pdf", "r"));
    const r = await documentRepo.rename(d.id, "Résumé.pdf");
    expect(r.vaultPath).toBe(`documents/Unfiled/${today()} Résumé.pdf`);
    expect(await tree()).toEqual([r.vaultPath]);
  });

  it("B1: a case-only folder rename moves every file below it", async () => {
    const f = await folderRepo.create({ name: "trips" });
    const d = await documentRepo.upload(file("A.pdf", "a"), { folderId: f.id });
    await folderRepo.rename(f.id, "Trips");
    const after = (await documentRepo.get(d.id))!.vaultPath;
    expect(after).toBe(`documents/Trips/${today()} A.pdf`);
    expect(await tree()).toEqual([after]);
  });

  it("B2: linking re-dates the file in the same plan; unlinking dates it back", async () => {
    const d = await documentRepo.upload(file("Monitor.pdf", "m"));
    const { link } = await linkExpense(d.id, "2026-03-16");
    expect((await documentRepo.get(d.id))!.vaultPath).toBe(
      "documents/Unfiled/2026-03-16 Monitor.pdf",
    );
    expect(await tree()).toEqual(["documents/Unfiled/2026-03-16 Monitor.pdf"]);
    const { documentLinkRepo } = await import("./documents.ts");
    await documentLinkRepo.unlink(link.id);
    expect(await tree()).toEqual([`documents/Unfiled/${d.addedAt.slice(0, 10)} Monitor.pdf`]);
    // Undoing the unlink (a revert) re-dates it again.
    await documentLinkRepo.revertTo(link.id, link);
    expect(await tree()).toEqual(["documents/Unfiled/2026-03-16 Monitor.pdf"]);
  });

  it("B2: a notes edit or a folder rename never re-dates a file", async () => {
    const f = await folderRepo.create({ name: "F" });
    const d = await documentRepo.upload(file("Monitor.pdf", "m"), { folderId: f.id });
    // The link row changes behind the tree's back (as a record-date edit does today: the PR 6
    // scan's to catch). An unrelated write must not pick it up.
    await linkExpense(d.id, "2026-03-16");
    const placed = (await documentRepo.get(d.id))!.vaultPath!;
    await expenseRepo.update((await expenseRepo.list())[0]!.id, { date: "2026-04-01" } as never);
    const r = await documentRepo.update(d.id, { notes: "a note" });
    expect(r!.vaultPath).toBe(placed);
    await folderRepo.rename(f.id, "G");
    expect((await documentRepo.get(d.id))!.vaultPath).toBe("documents/G/2026-03-16 Monitor.pdf");
  });

  it("B2: a rename keeps the date the file has", async () => {
    const d = await documentRepo.upload(file("Monitor.pdf", "m"));
    await linkExpense(d.id, "2026-03-16");
    const r = await documentRepo.rename(d.id, "Screen.pdf");
    expect(r.vaultPath).toBe("documents/Unfiled/2026-03-16 Screen.pdf");
  });
});

describe("r1 B3/B4: held until the migration is done", () => {
  it("B3: an import is refused while migrating and after it stopped part way", async () => {
    const { importBundle } = await import("./import.ts");
    const { emptyBundle } = await import("../bundle.ts");
    const { VaultMigrationIncompleteError } = await import("@fiscode/core");
    setVaultMigrationState({ phase: "migrating", done: 0, total: 1 });
    await expect(importBundle(emptyBundle(), "restore" as never)).rejects.toBeInstanceOf(
      VaultMigratingError,
    );
    setVaultMigrationState({ phase: "migration-incomplete", reason: "failed", message: "x" });
    await expect(importBundle(emptyBundle(), "restore" as never)).rejects.toBeInstanceOf(
      VaultMigrationIncompleteError,
    );
  });

  it("B4: after a failed or cancelled job every write stays refused", async () => {
    const { VaultMigrationIncompleteError } = await import("@fiscode/core");
    const d = await documentRepo.upload(file("A.pdf", "a"));
    for (const reason of ["failed", "cancelled"] as const) {
      setVaultMigrationState({ phase: "migration-incomplete", reason, message: "x" });
      await expect(documentRepo.rename(d.id, "B.pdf")).rejects.toBeInstanceOf(
        VaultMigrationIncompleteError,
      );
      await expect(documentRepo.upload(file("C.pdf", "c"))).rejects.toBeInstanceOf(
        VaultMigrationIncompleteError,
      );
    }
  });
});
