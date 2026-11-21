import { describe, expect, it, vi } from "vitest";

import {
  FolderCycleError,
  FolderNameInvalidError,
  validDocumentName,
  YEAR_ROOT_KEY,
  FolderNameTakenError,
  FolderTooDeepError,
  DocumentBytesMissingError,
} from "@fiscode/core";
import { documentRepo, folderRepo } from "@fiscode/db";
import { dropBytesForStub } from "../test/fake-documents";
vi.mock("@fiscode/db", async () => {
  // SQLite and OPFS don't exist in jsdom: the repos are the in-memory fake.
  const fake = await import("../test/fake-documents");
  return {
    folderRepo: fake.folderRepo,
    documentRepo: fake.documentRepo,
    documentLinkRepo: fake.documentLinkRepo,
  };
});

import { uploadFiles } from "./documents-upload";
import { landedLine, restoreDocument } from "./documents-restore";
import { formatBytes, subtreeOf } from "./documents-view";

// Demo files only: made here, never real documents.
const file = (name: string, body: string | Uint8Array<ArrayBuffer>, type = "") =>
  new File([body], name, { type });

describe("uploading documents (stub)", () => {
  it("gives every file its own result and never fails the batch", async () => {
    const folder = await folderRepo.create({ name: "Demo upload" });
    const results = await uploadFiles(
      [
        file("demo-receipt.pdf", "%PDF-1.4 demo", "application/pdf"),
        file("demo-letter.docx", "PK demo"),
        file("demo-too-big.pdf", new Uint8Array(25 * 1024 * 1024 + 1), "application/pdf"),
        file("demo-notes.txt", "demo notes"), // no type from the browser: sniffed from .txt
      ],
      folder.id,
      [],
      () => "Demo upload",
    );
    expect(results).toEqual([
      {
        name: "demo-receipt.pdf",
        ok: true,
        line: "Added demo-receipt.pdf.",
        doc: expect.objectContaining({ name: "demo-receipt.pdf" }),
      },
      {
        name: "demo-notes.txt",
        ok: true,
        line: "Added demo-notes.txt.",
        doc: expect.objectContaining({ name: "demo-notes.txt" }),
      },
      {
        name: "demo-letter.docx",
        ok: false,
        line: '"demo-letter.docx" isn\'t a type fiscode stores. Use a PDF, PNG, JPEG, WebP, HEIC, GIF or text file.',
      },
      {
        name: "demo-too-big.pdf",
        ok: false,
        line: '"demo-too-big.pdf" is larger than 25 MB. fiscode stores files up to 25 MB.',
      },
    ]);
    expect(await documentRepo.listInFolder(folder.id)).toHaveLength(2);
  });

  it("names where the first copy is, per file, across folders and within a batch (REVIEW #83 r1 F1)", async () => {
    const receipts = await folderRepo.create({ name: "Demo receipts" });
    const other = await folderRepo.create({ name: "Demo other" });
    const photo = await documentRepo.upload(file("demo-photo.png", "PNG same", "image/png"), {
      folderId: receipts.id,
    });
    const receipt = await documentRepo.upload(file("demo-a.pdf", "%PDF same", "application/pdf"), {
      folderId: receipts.id,
    });
    const paths: Record<string, string> = {
      [receipts.id]: "Demo receipts",
      [other.id]: "Demo other",
    };
    const results = await uploadFiles(
      [
        file("demo-photo.png", "PNG same", "image/png"),
        file("demo-b.pdf", "%PDF same", "application/pdf"),
        file("demo-new.txt", "fresh", "text/plain"),
        file("demo-new-again.txt", "fresh", "text/plain"), // the same bytes, in this same batch
      ],
      other.id,
      [photo, receipt],
      (id) => (id ? paths[id]! : "Unfiled"),
    );
    expect(results.map((r) => r.line)).toEqual([
      "Added demo-photo.png: the same file as demo-photo.png in Demo receipts.",
      "Added demo-b.pdf: the same file as demo-a.pdf in Demo receipts.",
      "Added demo-new.txt.",
      "Added demo-new-again.txt: the same file as demo-new.txt in Demo other.",
    ]);
    expect(results[0]?.sameAs?.id).toBe(photo.id);
  });

  it("reports a document whose bytes aren't on this device", async () => {
    const doc = await documentRepo.upload(file("demo-gone.txt", "demo gone", "text/plain"));
    dropBytesForStub(doc.sha256);
    await expect(documentRepo.readBytes(doc.id)).rejects.toBeInstanceOf(DocumentBytesMissingError);
  });
});

describe("folders (stub)", () => {
  it("refuses a taken name among siblings, case-insensitively", async () => {
    const parent = await folderRepo.create({ name: "Demo names" });
    await folderRepo.create({ name: "Receipts", parentId: parent.id });
    await expect(
      folderRepo.create({ name: "receipts", parentId: parent.id }),
    ).rejects.toBeInstanceOf(FolderNameTakenError);
  });

  it("refuses a blank name or one with a slash, with a line to show (#84)", async () => {
    await expect(folderRepo.create({ name: "  " })).rejects.toThrow(
      new FolderNameInvalidError("Enter a name."),
    );
    await expect(folderRepo.create({ name: "a/b" })).rejects.toThrow("A name can't contain /.");
  });

  it("refuses moving a folder into itself, and nesting past 8 levels", async () => {
    const a = await folderRepo.create({ name: "Demo A" });
    const b = await folderRepo.create({ name: "B", parentId: a.id });
    await expect(folderRepo.move(a.id, b.id)).rejects.toBeInstanceOf(FolderCycleError);
    let parent = a.id;
    for (let i = 2; i <= 8; i++)
      parent = (await folderRepo.create({ name: `L${i}`, parentId: parent })).id;
    await expect(folderRepo.create({ name: "L9", parentId: parent })).rejects.toBeInstanceOf(
      FolderTooDeepError,
    );
  });

  it("deletes a folder tree with its documents, and Undo restores them all", async () => {
    const top = await folderRepo.create({ name: "Demo tree" });
    const child = await folderRepo.create({ name: "Child", parentId: top.id });
    await documentRepo.upload(file("demo-in-child.txt", "demo child", "text/plain"), {
      folderId: child.id,
    });
    expect(await folderRepo.countTree(top.id)).toEqual({ folders: 2, documents: 1 });
    const deleted = await folderRepo.softDeleteTree(top.id);
    expect((await folderRepo.list()).some((f) => f.id === child.id)).toBe(false);
    await folderRepo.restoreTree(deleted);
    expect(await folderRepo.countTree(top.id)).toEqual({ folders: 2, documents: 1 });
  });

  it("makes the year's folders once, and leaves a deleted one deleted", async () => {
    await folderRepo.ensureYearDefaults(2031);
    const year = (await folderRepo.list()).find((f) => f.name === "2031")!;
    const names = (await folderRepo.list())
      .filter((f) => f.parentId === year.id)
      .map((f) => f.name);
    expect(names.toSorted()).toEqual([
      "Expenses",
      "Health insurance",
      "Income",
      "Mileage",
      "Other",
      "Tax forms",
    ]);
    const other = (await folderRepo.list()).find(
      (f) => f.parentId === year.id && f.name === "Other",
    )!;
    await folderRepo.softDeleteTree(other.id);
    await folderRepo.ensureYearDefaults(2031);
    expect(
      (await folderRepo.list()).some((f) => f.parentId === year.id && f.name === "Other"),
    ).toBe(false);
  });
});

describe("documents view helpers", () => {
  it("sizes files in words", () => {
    expect([formatBytes(604), formatBytes(2048), formatBytes(3.4 * 1024 * 1024)]).toEqual([
      "604 B",
      "2 KB",
      "3.4 MB",
    ]);
  });

  it("finds a folder's subtree, which it can't move into", async () => {
    const a = await folderRepo.create({ name: "Demo sub" });
    const b = await folderRepo.create({ name: "B", parentId: a.id });
    const c = await folderRepo.create({ name: "C", parentId: b.id });
    expect([...subtreeOf(await folderRepo.list(), a.id)].toSorted()).toEqual(
      [a.id, b.id, c.id].toSorted(),
    );
  });
});

describe("#84 r2: default folders by key, document names, restores that never refuse", () => {
  it("keeps a renamed default folder as the default, and makes no second one", async () => {
    await folderRepo.ensureYearDefaults(2032);
    const year = (await folderRepo.list()).find(
      (f) => f.defaultKey === YEAR_ROOT_KEY && f.taxYear === 2032,
    )!;
    await folderRepo.rename(year.id, "Taxes 2032");
    const expenses = (await folderRepo.list()).find(
      (f) => f.parentId === year.id && f.defaultKey === "expenses",
    )!;
    await folderRepo.rename(expenses.id, "Receipts");
    await folderRepo.ensureYearDefaults(2032);
    const all = await folderRepo.list();
    expect(all.filter((f) => f.defaultKey === YEAR_ROOT_KEY && f.taxYear === 2032)).toHaveLength(1);
    expect(
      all.filter((f) => f.parentId === year.id && f.defaultKey === "expenses").map((f) => f.name),
    ).toEqual(["Receipts"]);
  });

  it("says why a document name can't be used (core's validDocumentName throws)", () => {
    expect(() => validDocumentName("  ")).toThrow("Enter a name.");
    expect(() => validDocumentName("a/b.pdf")).toThrow(/\//);
    expect(() => validDocumentName("x".repeat(121))).toThrow("Use 120 characters or fewer.");
    expect(validDocumentName(" demo.pdf ")).toBe("demo.pdf");
  });

  it("restores a folder whose name was taken as 'Name (2)', and says so", async () => {
    const parent = await folderRepo.create({ name: "Demo restore" });
    const first = await folderRepo.create({ name: "Receipts", parentId: parent.id });
    await folderRepo.softDelete(first.id);
    await folderRepo.create({ name: "Receipts", parentId: parent.id });
    await folderRepo.revertTo(first.id, { ...first, deletedAt: null });
    expect((await folderRepo.get(first.id))?.name).toBe("Receipts (2)");
    expect(await landedLine(first)).toBe("Restored Receipts as Receipts (2) in Demo restore.");
  });

  it("restores a folder whose parent is gone under the year's root, and says so", async () => {
    await folderRepo.ensureYearDefaults(2033);
    const year = (await folderRepo.list()).find(
      (f) => f.defaultKey === YEAR_ROOT_KEY && f.taxYear === 2033,
    )!;
    const box = await folderRepo.create({ name: "Demo box", parentId: year.id });
    const inner = await folderRepo.create({ name: "Demo inner", parentId: box.id });
    await folderRepo.softDelete(inner.id);
    await folderRepo.softDeleteTree(box.id);
    await folderRepo.revertTo(inner.id, { ...inner, deletedAt: null });
    expect((await folderRepo.get(inner.id))?.parentId).toBe(year.id);
    expect(await landedLine(inner)).toBe("Restored Demo inner in 2033: its folder is gone.");
  });
});

describe("restoring a document whose folder is in Trash (REVIEW #83 r5 F4)", () => {
  it("puts it in the nearest folder that isn't in Trash, and says so", async () => {
    // Box > demo-notes.txt; delete the document, then the folder; restore the document.
    const top = await folderRepo.create({ name: "Demo top" });
    const box = await folderRepo.create({ name: "Box", parentId: top.id });
    const doc = await documentRepo.upload(file("demo-notes.txt", "demo f4", "text/plain"), {
      folderId: box.id,
    });
    await documentRepo.softDelete(doc.id);
    await folderRepo.softDeleteTree(box.id);
    const line = await restoreDocument((await documentRepo.get(doc.id))!);
    expect(line).toBe("Restored demo-notes.txt in Demo top: its folder is in Trash.");
    expect((await documentRepo.listInFolder(top.id)).map((d) => d.id)).toContain(doc.id);
  });

  it("goes to Unfiled when no folder above it is left", async () => {
    const box = await folderRepo.create({ name: "Demo lone box" });
    const doc = await documentRepo.upload(file("demo-lone.txt", "demo lone", "text/plain"), {
      folderId: box.id,
    });
    await documentRepo.softDelete(doc.id);
    await folderRepo.softDeleteTree(box.id);
    expect(await restoreDocument((await documentRepo.get(doc.id))!)).toBe(
      "Restored demo-lone.txt in Unfiled: its folder is in Trash.",
    );
  });

  it("restores in place, quietly, when its folder is still there", async () => {
    const box = await folderRepo.create({ name: "Demo kept box" });
    const doc = await documentRepo.upload(file("demo-kept.txt", "demo kept", "text/plain"), {
      folderId: box.id,
    });
    await documentRepo.softDelete(doc.id);
    expect(await restoreDocument((await documentRepo.get(doc.id))!)).toBe(
      "Restored demo-kept.txt.",
    );
  });
});
