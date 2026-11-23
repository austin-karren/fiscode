import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import {
  DocumentBytesMissingError,
  DocumentNameInvalidError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
  FolderCycleError,
  FolderNameTakenError,
  FolderTooDeepError,
  MAX_DOCUMENT_BYTES,
  RecordNotFoundError,
} from "@fiscode/core";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import { __setBlobStoreForTests, memoryBlobStore, sha256Hex } from "../blob-store.ts";
import {
  clientRepo,
  documentLinkRepo,
  documentRepo,
  expenseRepo,
  folderRepo,
  historyRepo,
  homeOfficeRepo,
  profileRepo,
  vehicleRepo,
} from "./index.ts";
import { __setEnsureRaceHookForTests } from "./documents.ts";
import { getDb } from "../client.ts";
import { documentFolder } from "../schema/index.ts";

let sqlite: Database.Database;
let store: ReturnType<typeof memoryBlobStore>;
beforeEach(() => {
  sqlite = setupTestDb();
  store = memoryBlobStore();
  __setBlobStoreForTests(store);
});
afterEach(() => {
  __setBlobStoreForTests(undefined);
  teardownTestDb(sqlite);
});

const file = (name: string, text: string, type = "application/pdf") =>
  Object.assign(new Blob([text], { type }), { name });

const expense = () =>
  expenseRepo.create({
    date: "2026-03-16",
    category: "equipment",
    description: "Demo monitor",
    amountCents: 129_99,
    clientId: null,
    reason: null,
    flagForSection179: false,
    startupExpense: false,
    placedInServiceDate: null,
    notes: null,
    deletedAt: null,
  } as never);

describe("folderRepo", () => {
  it("creates folders; names are trimmed and unique among live siblings (case-insensitive)", async () => {
    const root = await folderRepo.create({ name: "  2026  " });
    expect(root.name).toBe("2026");
    await folderRepo.create({ name: "Expenses", parentId: root.id });
    await expect(folderRepo.create({ name: "expenses", parentId: root.id })).rejects.toBeInstanceOf(
      FolderNameTakenError,
    );
    // Same name elsewhere is fine.
    await folderRepo.create({ name: "Expenses" });
  });

  it("refuses an 9th level, and a move into its own subtree", async () => {
    let parent: string | null = null;
    const ids: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const f = await folderRepo.create({ name: `L${i}`, parentId: parent });
      ids.push(f.id);
      parent = f.id;
    }
    await expect(folderRepo.create({ name: "L9", parentId: parent })).rejects.toBeInstanceOf(
      FolderTooDeepError,
    );
    await expect(folderRepo.move(ids[0]!, ids[3]!)).rejects.toBeInstanceOf(FolderCycleError);
  });

  it("renames and moves, keeping names unique at the destination", async () => {
    const a = await folderRepo.create({ name: "A" });
    const b = await folderRepo.create({ name: "B" });
    const x = await folderRepo.create({ name: "X", parentId: a.id });
    await folderRepo.create({ name: "X", parentId: b.id });
    await expect(folderRepo.move(x.id, b.id)).rejects.toBeInstanceOf(FolderNameTakenError);
    expect((await folderRepo.rename(x.id, "Y")).name).toBe("Y");
    expect((await folderRepo.move(x.id, b.id)).parentId).toBe(b.id);
  });

  it("softDeleteTree deletes a subtree and its documents in one go; restoreTree undoes it", async () => {
    const root = await folderRepo.create({ name: "2026" });
    const child = await folderRepo.create({ name: "Expenses", parentId: root.id });
    const doc = await documentRepo.upload(file("r.pdf", "receipt"), { folderId: child.id });
    expect(await folderRepo.countTree(root.id)).toEqual({ folders: 2, documents: 1 });

    const deleted = await folderRepo.softDeleteTree(root.id);
    expect(deleted.folderIds.toSorted()).toEqual([root.id, child.id].toSorted());
    expect(deleted.documentIds).toEqual([doc.id]);
    expect(await folderRepo.tree()).toEqual([]);
    expect(await documentRepo.get(doc.id)).toBeUndefined();

    await folderRepo.restoreTree(deleted);
    expect((await folderRepo.tree()).map((n) => n.folder.name)).toEqual(["2026"]);
    expect(await documentRepo.get(doc.id)).toBeDefined();
  });

  it("tree: live only, nested, sorted by sort_order then name, with document counts", async () => {
    const b = await folderRepo.create({ name: "b" });
    await folderRepo.create({ name: "a" });
    const c = await folderRepo.create({ name: "c", parentId: b.id });
    await documentRepo.upload(file("1.pdf", "1"), { folderId: c.id });
    const tree = await folderRepo.tree();
    expect(tree.map((n) => n.folder.name)).toEqual(["a", "b"]);
    expect(tree[1]!.children[0]!.folder.name).toBe("c");
    expect(tree[1]!.children[0]!.documentCount).toBe(1);
  });

  it("ensureYearDefaults is idempotent and never brings back a folder the user deleted", async () => {
    const first = await folderRepo.ensureYearDefaults(2026);
    expect(first.map((f) => f.name)).toEqual([
      "2026",
      "Expenses",
      "Income",
      "Mileage",
      "Health insurance",
      "Tax forms",
      "Other",
    ]);
    expect(first.every((f) => f.taxYear === 2026)).toBe(true);
    const again = await folderRepo.ensureYearDefaults(2026);
    expect(again.map((f) => f.id)).toEqual(first.map((f) => f.id));

    const other = first.find((f) => f.name === "Other")!;
    await folderRepo.softDelete(other.id);
    const after = await folderRepo.ensureYearDefaults(2026);
    expect(after.map((f) => f.name)).not.toContain("Other");
  });
});

describe("documentRepo", () => {
  it("uploads: hashes, stores the blob once (dedupe), and inserts a row per upload", async () => {
    const a = await documentRepo.upload(file("a.pdf", "same bytes"));
    const b = await documentRepo.upload(file("b.pdf", "same bytes"));
    expect(a.sha256).toBe(await sha256Hex(new Blob(["same bytes"])));
    expect(a.sha256).toBe(b.sha256);
    expect(store.size()).toBe(1);
    expect(a.id).not.toBe(b.id);
    expect(a.mime).toBe("application/pdf");
    expect(a.sizeBytes).toBe(10);
    expect(a.folderId).toBeNull();
  });

  it("refuses files over 25 MB and types it doesn't store; sniffs the type from the name", async () => {
    const big = Object.assign(new Blob([new Uint8Array(MAX_DOCUMENT_BYTES + 1)]), {
      name: "big.pdf",
    });
    await expect(documentRepo.upload(big)).rejects.toBeInstanceOf(DocumentTooLargeError);
    await expect(
      documentRepo.upload(file("x.exe", "x", "application/x-msdownload")),
    ).rejects.toBeInstanceOf(DocumentTypeNotAllowedError);
    const heic = await documentRepo.upload(file("IMG_1.HEIC", "h", ""));
    expect(heic.mime).toBe("image/heic");
  });

  it("uploadMany is never all-or-nothing", async () => {
    const r = await documentRepo.uploadMany([
      file("ok.pdf", "1"),
      file("bad.exe", "2", "application/x-msdownload"),
    ]);
    expect(r.ok.map((d) => d.name)).toEqual(["ok.pdf"]);
    expect(r.failed.map((f) => f.name)).toEqual(["bad.exe"]);
    expect(r.failed[0]!.error).toBeInstanceOf(DocumentTypeNotAllowedError);
  });

  it("rename, move, search, listInFolder", async () => {
    const f = await folderRepo.create({ name: "F" });
    const d = await documentRepo.upload(file("scan.pdf", "s"));
    await documentRepo.rename(d.id, "Demo receipt.pdf");
    await documentRepo.move(d.id, f.id);
    expect((await documentRepo.listInFolder(f.id)).map((x) => x.name)).toEqual([
      "Demo receipt.pdf",
    ]);
    expect(await documentRepo.listInFolder(null)).toEqual([]);
    expect((await documentRepo.search("RECEIPT")).map((x) => x.id)).toEqual([d.id]);
  });

  it("replaceBytes makes a new version; versions lists both; reverting the row brings the old bytes", async () => {
    const d = await documentRepo.upload(file("v.pdf", "one"));
    const v2 = await documentRepo.replaceBytes(d.id, file("v.pdf", "two!"));
    expect(v2.sha256).not.toBe(d.sha256);
    expect(await (await documentRepo.readBytes(d.id)).text()).toBe("two!");
    const versions = await documentRepo.versions(d.id);
    expect(versions.map((v) => [v.sha256, v.sizeBytes, v.available])).toEqual([
      [d.sha256, 3, true],
      [v2.sha256, 4, true],
    ]);
    await documentRepo.revertTo(d.id, d);
    expect(await (await documentRepo.readBytes(d.id)).text()).toBe("one");
  });

  it("readBytes throws DocumentBytesMissingError when this device has no blob", async () => {
    const d = await documentRepo.upload(file("m.pdf", "m"));
    __setBlobStoreForTests(memoryBlobStore());
    await expect(documentRepo.readBytes(d.id)).rejects.toBeInstanceOf(DocumentBytesMissingError);
  });

  it("writes history for every change", async () => {
    const d = await documentRepo.upload(file("h.pdf", "h"));
    await documentRepo.rename(d.id, "h2.pdf");
    await documentRepo.softDelete(d.id);
    const ops = (await historyRepo.listFor("document", d.id)).map((h) => h.op);
    expect(ops).toEqual(["insert", "update", "delete"]);
  });
});

describe("documentLinkRepo", () => {
  it("links idempotently; refuses a record that isn't there; lists both ways with a label", async () => {
    const e = await expense();
    const d = await documentRepo.upload(file("r.pdf", "r"));
    const l1 = await documentLinkRepo.link(d.id, "expense", e.id);
    const l2 = await documentLinkRepo.link(d.id, "expense", e.id);
    expect(l2.id).toBe(l1.id);
    await expect(documentLinkRepo.link(d.id, "expense", "nope")).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );

    const forRecord = await documentLinkRepo.forRecord("expense", e.id);
    expect(forRecord.map((l) => l.document.id)).toEqual([d.id]);
    const forDoc = await documentLinkRepo.forDocument(d.id);
    expect(forDoc[0]!.record).toEqual({
      recordType: "expense",
      id: e.id,
      date: "2026-03-16",
      label: "2026-03-16 · Equipment · $129.99",
      amountCents: 129_99,
    });
  });

  it("unlink is a soft delete; a deleted record's links are hidden from forDocument and kept", async () => {
    const e = await expense();
    const d = await documentRepo.upload(file("r.pdf", "r"));
    const l = await documentLinkRepo.link(d.id, "expense", e.id);
    await expenseRepo.softDelete(e.id);
    expect(await documentLinkRepo.forDocument(d.id)).toEqual([]);
    await expenseRepo.revertTo(e.id, e);
    expect(await documentLinkRepo.forDocument(d.id)).toHaveLength(1);
    expect(await documentLinkRepo.unlink(l.id)).toBe(true);
    expect(await documentLinkRepo.forRecord("expense", e.id)).toEqual([]);
  });

  it("countsFor (badges) and countsByDocument (list): one query each, zeros absent", async () => {
    const e1 = await expense();
    const e2 = await expense();
    const d1 = await documentRepo.upload(file("1.pdf", "1"));
    const d2 = await documentRepo.upload(file("2.pdf", "2"));
    await documentRepo.upload(file("3.pdf", "3"));
    await documentLinkRepo.link(d1.id, "expense", e1.id);
    await documentLinkRepo.link(d2.id, "expense", e1.id);
    await documentLinkRepo.link(d1.id, "expense", e2.id);
    expect(await documentLinkRepo.countsFor("expense", [e1.id, e2.id, "none"])).toEqual({
      [e1.id]: 2,
      [e2.id]: 1,
    });
    const byDoc = await documentLinkRepo.countsByDocument();
    expect(byDoc).toEqual(
      new Map([
        [d1.id, 2],
        [d2.id, 1],
      ]),
    );
  });
});

describe("review #84 r1", () => {
  it("(1) ensureYearDefaults adopts the user's own folders, matching names without case", async () => {
    const mine = await folderRepo.create({ name: "2026" });
    const lower = await folderRepo.create({ name: "expenses", parentId: mine.id });
    const made = await folderRepo.ensureYearDefaults(2026);
    expect(made[0]!.id).toBe(mine.id);
    expect(made.find((f) => f.defaultKey === "expenses")!.id).toBe(lower.id);
    expect((await folderRepo.list()).length).toBe(7);
  });

  it("(2) a renamed or moved default folder is never made again", async () => {
    const first = await folderRepo.ensureYearDefaults(2026);
    const expenses = first.find((f) => f.name === "Expenses")!;
    await folderRepo.rename(expenses.id, "Receipts");
    const other = first.find((f) => f.name === "Other")!;
    await folderRepo.move(other.id, null);
    const before = (await folderRepo.listIncludingDeleted()).length;
    await folderRepo.ensureYearDefaults(2026);
    expect((await folderRepo.listIncludingDeleted()).length).toBe(before);
    expect(first.every((f) => f.defaultKey !== null)).toBe(true);
  });

  it("(3) two ensureYearDefaults at once make one set", async () => {
    await Promise.all([folderRepo.ensureYearDefaults(2026), folderRepo.ensureYearDefaults(2026)]);
    expect((await folderRepo.list()).length).toBe(7);
  });

  it("(4) countsByDocument leaves out links to deleted records, like forDocument", async () => {
    const e = await expense();
    const d = await documentRepo.upload(file("r.pdf", "r"));
    await documentLinkRepo.link(d.id, "expense", e.id);
    expect(await documentLinkRepo.countsByDocument()).toEqual(new Map([[d.id, 1]]));
    await expenseRepo.softDelete(e.id);
    expect(await documentLinkRepo.forDocument(d.id)).toEqual([]);
    expect(await documentLinkRepo.countsByDocument()).toEqual(new Map());
  });

  it("(5) restoring a folder whose name is taken comes back as 'Name (2)'", async () => {
    const a = await folderRepo.create({ name: "Receipts" });
    const snapshot = (await folderRepo.get(a.id))!;
    await folderRepo.softDelete(a.id);
    await folderRepo.create({ name: "receipts" });
    const back = await folderRepo.revertTo(a.id, snapshot);
    expect(back!.name).toBe("Receipts (2)");
    expect(back!.deletedAt).toBeNull();
  });

  it("(5) restoring a folder whose parent is gone puts it under its year's root, or at the top", async () => {
    const [root] = await folderRepo.ensureYearDefaults(2026);
    const parent = await folderRepo.create({ name: "Trips", parentId: root!.id, taxYear: 2026 });
    const child = await folderRepo.create({ name: "May", parentId: parent.id, taxYear: 2026 });
    const loose = await folderRepo.create({ name: "Loose", parentId: parent.id });
    const childSnap = (await folderRepo.get(child.id))!;
    const looseSnap = (await folderRepo.get(loose.id))!;
    await folderRepo.softDeleteTree(parent.id);
    expect((await folderRepo.revertTo(child.id, childSnap))!.parentId).toBe(root!.id);
    // No tax year: no root to go under, so the top level.
    expect((await folderRepo.revertTo(loose.id, looseSnap))!.parentId).toBeNull();
  });

  it("r2 (1) restoreTree brings a folder back as 'Name (2)' when its name is taken (walk step 11)", async () => {
    const tree = await folderRepo.create({ name: "Tree" });
    const leaf = await folderRepo.create({ name: "Leaf", parentId: tree.id });
    const deleted = await folderRepo.softDeleteTree(tree.id);
    await folderRepo.create({ name: "tree" });
    await folderRepo.restoreTree(deleted);
    const roots = (await folderRepo.tree()).map((n) => n.folder.name);
    expect(roots.toSorted()).toEqual(["tree", "Tree (2)"].toSorted());
    // Its children come back with it, under it, unchanged.
    expect((await folderRepo.get(leaf.id))!.parentId).toBe(tree.id);
  });

  it("(6) document rename rejects empty and over-long names, and trims", async () => {
    const d = await documentRepo.upload(file("a.pdf", "a"));
    await expect(documentRepo.rename(d.id, "   ")).rejects.toBeInstanceOf(DocumentNameInvalidError);
    await expect(documentRepo.rename(d.id, "x".repeat(121))).rejects.toBeInstanceOf(
      DocumentNameInvalidError,
    );
    expect((await documentRepo.rename(d.id, "  b.pdf ")).name).toBe("b.pdf");
  });
});

describe("review #84 r3: two tabs", () => {
  afterEach(() => __setEnsureRaceHookForTests(undefined));

  it("another tab makes the year root between our read and our write: one set, no throw", async () => {
    let otherRootId = "";
    __setEnsureRaceHookForTests(async () => {
      __setEnsureRaceHookForTests(undefined); // once
      const at = new Date().toISOString();
      otherRootId = "df_other_tab";
      await getDb().insert(documentFolder).values({
        id: otherRootId,
        parentId: null,
        name: "2026",
        taxYear: 2026,
        sortOrder: 0,
        defaultKey: "year-root",
        deletedAt: null,
        createdAt: at,
        updatedAt: at,
      });
    });
    const made = await folderRepo.ensureYearDefaults(2026);
    expect(made[0]!.id).toBe(otherRootId);
    expect(made).toHaveLength(7);
    const all = await folderRepo.listIncludingDeleted();
    expect(all.filter((f) => f.defaultKey === "year-root")).toHaveLength(1);
    expect(all).toHaveLength(7);
  });

  it("any other unique violation is not swallowed: it reaches the caller", async () => {
    __setEnsureRaceHookForTests(async () => {
      __setEnsureRaceHookForTests(undefined);
      throw new Error("UNIQUE constraint failed: document.id");
    });
    await expect(folderRepo.ensureYearDefaults(2026)).rejects.toThrow(
      "UNIQUE constraint failed: document.id",
    );
  });

  it("the default-key violation is recognised by index name or by its columns", async () => {
    const { isDefaultKeyViolation } = await import("./documents.ts");
    expect(
      isDefaultKeyViolation(
        new Error(
          "UNIQUE constraint failed: document_folder.tax_year, document_folder.default_key",
        ),
      ),
    ).toBe(true);
    expect(
      isDefaultKeyViolation(
        new Error("UNIQUE constraint failed: index 'document_folder_default_key_idx'"),
      ),
    ).toBe(true);
    expect(isDefaultKeyViolation(new Error("UNIQUE constraint failed: document_folder.id"))).toBe(
      false,
    );
    expect(isDefaultKeyViolation(new Error("disk I/O error"))).toBe(false);
  });

  it("the index refuses a second folder with a year's key", async () => {
    await folderRepo.ensureYearDefaults(2026);
    const at = new Date().toISOString();
    await expect(
      getDb().insert(documentFolder).values({
        id: "df_dup",
        parentId: null,
        name: "2026 again",
        taxYear: 2026,
        sortOrder: 0,
        defaultKey: "year-root",
        deletedAt: null,
        createdAt: at,
        updatedAt: at,
      }),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe("documentLinkRepo: home office, profile, client, vehicle", () => {
  const stamp = { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  const linkAndRead = async (type: string, id: string) => {
    const d = await documentRepo.upload(file(`${type}.pdf`, type));
    await documentLinkRepo.link(d.id, type, id);
    const [l] = await documentLinkRepo.forDocument(d.id);
    return { d, record: l!.record };
  };

  it("home_office: dated by its start date, labeled with method and office size", async () => {
    const h = await homeOfficeRepo.create({
      startDate: "2026-02-01",
      method: "simplified",
      officeSqft: 120,
      deletedAt: null,
      ...stamp,
    } as never);
    const { record } = await linkAndRead("home_office", h.id);
    expect(record).toEqual({
      recordType: "home_office",
      id: h.id,
      date: "2026-02-01",
      label: "2026-02-01 · Home office · Simplified · 120 sq ft",
    });
  });

  it("vehicle: dated by its in-service date when set, else none", async () => {
    const v = await vehicleRepo.create({
      make: "Demo",
      model: "Wagon",
      year: 2020,
      inServiceDate: "2026-04-02",
      deletedAt: null,
      ...stamp,
    } as never);
    expect((await linkAndRead("vehicle", v.id)).record).toEqual({
      recordType: "vehicle",
      id: v.id,
      date: "2026-04-02",
      label: "2026-04-02 · 2020 Demo Wagon",
    });
    const w = await vehicleRepo.create({
      make: "Demo",
      model: "Van",
      deletedAt: null,
      ...stamp,
    } as never);
    expect((await linkAndRead("vehicle", w.id)).record).toEqual({
      recordType: "vehicle",
      id: w.id,
      date: "",
      label: "Demo Van",
    });
  });

  it("client: labeled by name, no date", async () => {
    const c = await clientRepo.create({
      name: "Demo Client Co",
      deletedAt: null,
      ...stamp,
    } as never);
    expect((await linkAndRead("client", c.id)).record).toEqual({
      recordType: "client",
      id: c.id,
      date: "",
      label: "Demo Client Co",
    });
  });

  it("profile: the singleton, labeled by filing status and state, no date", async () => {
    await profileRepo.upsert({
      filingStatus: "single",
      state: "UT",
      seStartDate: "2026-01-01",
    } as never);
    expect((await linkAndRead("profile", "profile")).record).toEqual({
      recordType: "profile",
      id: "profile",
      date: "",
      label: "Tax profile · Single · UT",
    });
  });

  it("a missing row of each new type is RecordNotFoundError; a deleted one hides like expense", async () => {
    const d = await documentRepo.upload(file("x.pdf", "x"));
    for (const t of ["home_office", "profile", "client", "vehicle"]) {
      await expect(documentLinkRepo.link(d.id, t, "nope")).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
    }
    const c = await clientRepo.create({ name: "Gone Co", deletedAt: null, ...stamp } as never);
    const { d: cd } = await linkAndRead("client", c.id);
    expect(await documentLinkRepo.countsByDocument()).toEqual(new Map([[cd.id, 1]]));
    await clientRepo.softDelete(c.id);
    expect(await documentLinkRepo.forDocument(cd.id)).toEqual([]);
    expect(await documentLinkRepo.countsByDocument()).toEqual(new Map());
    await expect(documentLinkRepo.link(cd.id, "client", c.id)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it("countsByDocument counts links to every linkable type", async () => {
    const v = await vehicleRepo.create({
      make: "A",
      model: "B",
      deletedAt: null,
      ...stamp,
    } as never);
    const h = await homeOfficeRepo.create({
      startDate: "2026-01-01",
      deletedAt: null,
      ...stamp,
    } as never);
    await profileRepo.upsert({
      filingStatus: "single",
      state: "UT",
      seStartDate: "2026-01-01",
    } as never);
    const d = await documentRepo.upload(file("all.pdf", "all"));
    await documentLinkRepo.link(d.id, "vehicle", v.id);
    await documentLinkRepo.link(d.id, "home_office", h.id);
    await documentLinkRepo.link(d.id, "profile", "profile");
    expect(await documentLinkRepo.countsByDocument()).toEqual(new Map([[d.id, 3]]));
  });
});
