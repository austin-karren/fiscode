import { todayIso } from "@fiscode/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import {
  FolderFixedError,
  OperationCancelledError,
  VaultPathTooLongError,
  MAX_VAULT_PATH,
} from "@fiscode/core";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import {
  __resetVaultMigrationStateForTests,
  __setVaultStoreForTests,
  memoryDir,
  readJournal,
  vaultStore,
  type VaultDirHandle,
  type VaultStore,
  documentDate,
} from "../vault/index.ts";
import { buildBundle, documentLinkRepo, documentRepo, expenseRepo, folderRepo } from "./index.ts";
import { importBundle } from "./import.ts";
import { scanVault } from "./vault-scan.ts";
import type { TreeProgress } from "./document-tree.ts";

// previewPath (upload and rename dialogs), fixed folders, and folder-op progress and cancel.

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
// The local day, as the D2 added-date prefix uses.
const today = () => todayIso();

const tree = async (dir = ""): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await store.list(dir)) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.kind === "directory") out.push(...(await tree(path)));
    else if (path !== "fiscode.json") out.push(path);
  }
  return out.sort();
};

const snapshot = async () => ({
  files: await tree(),
  folders: (await folderRepo.list()).map((f) => [f.id, f.name, f.parentId]),
  docs: (await documentRepo.list()).map((d) => [d.id, d.vaultPath]),
  history: (sqlite.prepare("SELECT count(*) AS n FROM history").get() as { n: number }).n,
});

describe("documentRepo.previewPath", () => {
  it("a sanitised (n) folder: the upload goes where the preview said", async () => {
    await folderRepo.create({ name: "a:b" });
    const f = await folderRepo.create({ name: "a_b" });
    const before = await snapshot();
    const p = await documentRepo.previewPath({ folderId: f.id, name: "A.pdf" });
    // Read-only: nothing written, no History.
    expect(await snapshot()).toEqual(before);
    const d = await documentRepo.upload(file("A.pdf", "a"), { folderId: f.id });
    expect(p).toEqual({ path: d.vaultPath, fits: true, overBy: 0 });
    expect(p.path).toBe(`documents/a_b (2)/${today()} A.pdf`);
  });

  it("a rename keeps the date prefix the file has", async () => {
    const d = await documentRepo.upload(file("Monitor.pdf", "m"));
    const e = await expenseRepo.create({
      date: "2026-03-16",
      category: "equipment",
      description: "Demo monitor",
      amountCents: 1_00,
    } as never);
    await documentLinkRepo.link(d.id, "expense", e.id);
    const p = await documentRepo.previewPath({ id: d.id, folderId: null, name: "Screen.pdf" });
    const r = await documentRepo.rename(d.id, "Screen.pdf");
    expect(p.path).toBe("documents/Unfiled/2026-03-16 Screen.pdf");
    expect(p.path).toBe(r.vaultPath);
  });

  it("a collision gets the (2) the save gives it", async () => {
    const [, expenses] = await folderRepo.ensureYearDefaults(2026);
    await documentRepo.upload(file("NAS.pdf", "a"), { folderId: expenses!.id });
    const p = await documentRepo.previewPath({ folderId: expenses!.id, name: "nas.pdf" });
    const b = await documentRepo.upload(file("nas.pdf", "b"), { folderId: expenses!.id });
    expect(p.path).toBe(`documents/2026/Expenses/${today()} nas (2).pdf`);
    expect(p.path).toBe(b.vaultPath);
  });

  it("a case-only rename doesn't collide with itself", async () => {
    const d = await documentRepo.upload(file("invoice.pdf", "i"));
    const p = await documentRepo.previewPath({ id: d.id, folderId: null, name: "Invoice.pdf" });
    const r = await documentRepo.rename(d.id, "Invoice.pdf");
    expect(p.path).toBe(`documents/Unfiled/${today()} Invoice.pdf`);
    expect(p.path).toBe(r.vaultPath);
  });

  it("an unchanged name keeps its (2)", async () => {
    await documentRepo.upload(file("A.pdf", "a"));
    const b = await documentRepo.upload(file("A.pdf", "b"));
    const p = await documentRepo.previewPath({ id: b.id, folderId: null, name: "A.pdf" });
    expect(p.path).toBe(b.vaultPath);
  });

  it("over budget: fits is false, overBy says by how much, and the save refuses", async () => {
    const a = await folderRepo.create({ name: "A" });
    const b = await folderRepo.create({ name: "B".repeat(100), parentId: a.id });
    const p = await documentRepo.previewPath({ folderId: b.id, name: `${"T".repeat(200)}.pdf` });
    // The title is cut to fit first; it is over only when even the shortest title can't fit.
    expect(p.fits).toBe(true);
    expect(p.path.length).toBeLessThanOrEqual(MAX_VAULT_PATH);
    const d = await documentRepo.upload(file(`${"T".repeat(200)}.pdf`, "t"), { folderId: b.id });
    expect(p.path).toBe(d.vaultPath);
    // Push the folder path past the budget behind the repo's back, as an old import could.
    sqlite.exec(`UPDATE document_folder SET name = '${"C".repeat(120)}' WHERE id = '${a.id}'`);
    sqlite.exec(`UPDATE document_folder SET name = '${"D".repeat(120)}' WHERE id = '${b.id}'`);
    const over = await documentRepo.previewPath({ id: d.id, folderId: b.id, name: "X.pdf" });
    expect(over.fits).toBe(false);
    expect(over.overBy).toBe(over.path.length - MAX_VAULT_PATH);
    expect(over.overBy).toBeGreaterThan(0);
    await expect(documentRepo.rename(d.id, "X.pdf")).rejects.toBeInstanceOf(VaultPathTooLongError);
  });
});

describe("a title that starts with a date", () => {
  it("gets no second date, in the preview and the save", async () => {
    const p = await documentRepo.previewPath({ folderId: null, name: "2026-08-12 Demo bill.pdf" });
    const d = await documentRepo.upload(file("2026-08-12 Demo bill.pdf", "b"));
    expect(p.path).toBe("documents/Unfiled/2026-08-12 Demo bill.pdf");
    expect(d.vaultPath).toBe(p.path);
  });

  it("renamed to an undated title, it takes the D2 date, not the old title's", async () => {
    const d = await documentRepo.upload(file("2026-08-12 Demo bill.pdf", "b"));
    const p = await documentRepo.previewPath({ id: d.id, folderId: null, name: "Demo bill.pdf" });
    const r = await documentRepo.rename(d.id, "Demo bill.pdf");
    expect(r.vaultPath).toBe(`documents/Unfiled/${today()} Demo bill.pdf`);
    expect(p.path).toBe(r.vaultPath);
  });

  it("a bare-date title (2026-08-12.pdf) renamed to an undated one takes the D2 date", async () => {
    const d = await documentRepo.upload(file("2026-08-12.pdf", "b"));
    expect(d.vaultPath).toBe("documents/Unfiled/2026-08-12.pdf");
    const p = await documentRepo.previewPath({ id: d.id, folderId: null, name: "Bill.pdf" });
    const r = await documentRepo.rename(d.id, "Bill.pdf");
    expect(r.vaultPath).toBe(`documents/Unfiled/${today()} Bill.pdf`);
    expect(p.path).toBe(r.vaultPath);
  });

  it("an invalid date (2026-13-40) is not a date: it gets the D2 prefix", async () => {
    const d = await documentRepo.upload(file("2026-13-40 notes.pdf", "n"));
    expect(d.vaultPath).toBe(`documents/Unfiled/${today()} 2026-13-40 notes.pdf`);
  });
});

describe("folderRepo.previewPath", () => {
  it("a rename: the folder's directory as the save makes it", async () => {
    await folderRepo.create({ name: "a_b" });
    const f = await folderRepo.create({ name: "x" });
    await documentRepo.upload(file("A.pdf", "a"), { folderId: f.id });
    const p = await folderRepo.previewPath({ id: f.id, parentId: null, name: "a:b" });
    expect(p).toEqual({ path: "documents/a_b (2)", fits: true, overBy: 0 });
    await folderRepo.rename(f.id, "a:b");
    expect(await tree()).toEqual([`documents/a_b (2)/${today()} A.pdf`]);
  });

  it("trims and validates the name as the save does", async () => {
    const p = await folderRepo.previewPath({ parentId: null, name: "  Tax  " });
    expect(p.path).toBe("documents/Tax");
    await expect(folderRepo.previewPath({ parentId: null, name: "a/b" })).rejects.toThrow();
    const d = await documentRepo.upload(file("A.pdf", "a"));
    await expect(
      documentRepo.previewPath({ id: d.id, folderId: null, name: " " }),
    ).rejects.toThrow();
  });

  it("a new folder", async () => {
    const top = await folderRepo.create({ name: "T" });
    const p = await folderRepo.previewPath({ parentId: top.id, name: "S" });
    expect(p).toEqual({ path: "documents/T/S", fits: true, overBy: 0 });
  });

  it("over budget, from a file below it: fits is false, and the save refuses", async () => {
    const top = await folderRepo.create({ name: "T" });
    const sub = await folderRepo.create({ name: "S".repeat(100), parentId: top.id });
    await documentRepo.upload(file("A.pdf", "a"), { folderId: sub.id });
    const p = await folderRepo.previewPath({ id: top.id, parentId: null, name: "N".repeat(110) });
    expect(p.path).toBe(`documents/${"N".repeat(110)}`);
    expect(p.fits).toBe(false);
    expect(p.overBy).toBeGreaterThan(0);
    await expect(folderRepo.rename(top.id, "N".repeat(110))).rejects.toBeInstanceOf(
      VaultPathTooLongError,
    );
  });
});

describe("fixed folders (D5, ADR § 5)", () => {
  it("a user rename or move of a year folder is refused; a default category can't move", async () => {
    const [year, expenses] = await folderRepo.ensureYearDefaults(2026);
    const other = await folderRepo.create({ name: "Other things" });
    const before = await snapshot();
    await expect(folderRepo.rename(year!.id, "Y")).rejects.toThrow(
      "Year folders can't be renamed or moved.",
    );
    await expect(folderRepo.move(year!.id, other.id)).rejects.toBeInstanceOf(FolderFixedError);
    await expect(folderRepo.move(expenses!.id, other.id)).rejects.toThrow(
      "Default folders can't be moved.",
    );
    expect(await snapshot()).toEqual(before);
    // A default category can still be renamed.
    expect((await folderRepo.rename(expenses!.id, "Receipts")).name).toBe("Receipts");
  });

  it("update() has the same rules: a year folder's name or parent change is refused", async () => {
    const [year, expenses] = await folderRepo.ensureYearDefaults(2026);
    const other = await folderRepo.create({ name: "Other things" });
    const before = await snapshot();
    await expect(folderRepo.update(year!.id, { name: "Y" })).rejects.toBeInstanceOf(
      FolderFixedError,
    );
    await expect(folderRepo.update(year!.id, { parentId: other.id })).rejects.toBeInstanceOf(
      FolderFixedError,
    );
    await expect(folderRepo.update(expenses!.id, { parentId: null })).rejects.toBeInstanceOf(
      FolderFixedError,
    );
    expect(await snapshot()).toEqual(before);
  });

  it("History revert, Trash restore and import never refuse a fixed folder", async () => {
    const [year] = await folderRepo.ensureYearDefaults(2026);
    const deleted = await folderRepo.softDeleteTree(year!.id);
    await expect(folderRepo.restoreTree(deleted)).resolves.toBeDefined();
    // A revert to a snapshot under another name (as an old History row can hold) goes through.
    await expect(
      folderRepo.revertTo(year!.id, { ...year!, name: "2026 old" }),
    ).resolves.toMatchObject({ name: "2026 old" });
    const bundle = await buildBundle();
    await expect(importBundle(bundle, "restore" as never)).resolves.toBeUndefined();
    expect((await folderRepo.get(year!.id))!.name).toBe("2026 old");
  });
});

describe("folder rename and move: progress and cancel (§ 11.3)", () => {
  const three = async () => {
    const f = await folderRepo.create({ name: "F" });
    const docs = [];
    for (const n of ["A", "B", "C"]) {
      docs.push(await documentRepo.upload(file(`${n}.pdf`, n), { folderId: f.id }));
    }
    return { f, docs };
  };

  it("counts each file op, then saving, then done", async () => {
    const { f } = await three();
    const seen: TreeProgress[] = [];
    await folderRepo.rename(f.id, "G", { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([
      { phase: "moving", done: 0, total: 3 },
      { phase: "moving", done: 1, total: 3 },
      { phase: "moving", done: 2, total: 3 },
      { phase: "moving", done: 3, total: 3 },
      { phase: "saving", done: 3, total: 3 },
      { phase: "done", done: 3, total: 3 },
    ]);
  });

  it("a cancel part way leaves the tree and the rows exactly as before", async () => {
    const { f } = await three();
    const other = await folderRepo.create({ name: "O" });
    const before = await snapshot();
    const ctl = new AbortController();
    const onProgress = (p: TreeProgress) => {
      if (p.phase === "moving" && p.done === 2) ctl.abort();
    };
    await expect(
      folderRepo.move(f.id, other.id, { onProgress, signal: ctl.signal }),
    ).rejects.toThrow(new OperationCancelledError());
    // No orphans, no duplicates, no History row, no journal left.
    expect(await snapshot()).toEqual(before);
    expect(await readJournal(root)).toBeUndefined();
  });

  it("an already-aborted signal does nothing", async () => {
    const { f } = await three();
    const before = await snapshot();
    const ctl = new AbortController();
    ctl.abort();
    await expect(folderRepo.rename(f.id, "G", { signal: ctl.signal })).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
    expect(await snapshot()).toEqual(before);
  });

  it("a cancel after the commit is ignored: the op finishes", async () => {
    const { f, docs } = await three();
    const ctl = new AbortController();
    const onProgress = (p: TreeProgress) => {
      if (p.phase === "saving") queueMicrotask(() => ctl.abort());
      if (p.phase === "done") ctl.abort();
    };
    const r = await folderRepo.rename(f.id, "G", { onProgress, signal: ctl.signal });
    expect(r.name).toBe("G");
    expect(await tree()).toEqual(docs.map((d) => d.vaultPath!.replace("/F/", "/G/")).sort());
  });
});

describe("the D2 added-date prefix is the local day", () => {
  it("an upload at 23:30 local is named that day, and the scan's redate check agrees", async () => {
    // Fake only Date, so the vault's timers and promises run as normal.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 23:30 local on 2026-08-12 is already 2026-08-13 in UTC in any US zone.
      vi.setSystemTime(new Date(2026, 7, 12, 23, 30));
      const d = await documentRepo.upload(file("Demo bill.pdf", "b"));
      expect(d.vaultPath).toBe("documents/Unfiled/2026-08-12 Demo bill.pdf");
      expect(documentDate(d.addedAt, [])).toBe("2026-08-12");
      expect(
        (await documentRepo.previewPath({ folderId: null, name: "Demo bill 2.pdf" })).path,
      ).toBe("documents/Unfiled/2026-08-12 Demo bill 2.pdf");
      // Linked to a same-day record: the file name doesn't change, so it isn't "redated".
      const e = await expenseRepo.create({
        date: "2026-08-12",
        category: "equipment",
        description: "Demo bill",
        amountCents: 1_00,
      });
      await documentLinkRepo.link(d.id, "expense", e.id);
      expect((await documentRepo.get(d.id))!.vaultPath).toBe(d.vaultPath);
      const r = await scanVault();
      if (r.status !== "done") throw new Error(`scan skipped: ${r.reason}`);
      expect(r.redated).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
