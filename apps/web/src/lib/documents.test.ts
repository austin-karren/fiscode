import { describe, expect, it } from "vitest";

import {
  dropBytesForStub,
  documentRepo,
  folderRepo,
  FolderCycleError,
  FolderNameTakenError,
  FolderTooDeepError,
  DocumentBytesMissingError,
} from "./documents-stub";
import { uploadFiles } from "./documents-upload";
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
      { name: "demo-receipt.pdf", ok: true, line: "Added demo-receipt.pdf." },
      { name: "demo-notes.txt", ok: true, line: "Added demo-notes.txt." },
      {
        name: "demo-letter.docx",
        ok: false,
        line: "demo-letter.docx: this file type can't be added.",
      },
      { name: "demo-too-big.pdf", ok: false, line: "demo-too-big.pdf is over 25 MB." },
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
