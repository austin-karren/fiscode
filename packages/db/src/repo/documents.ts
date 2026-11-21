import {
  DocumentBytesMissingError,
  DocumentNotFoundError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
  EXPENSE_CATEGORY_LABELS,
  FolderCycleError,
  FolderNameTakenError,
  FolderNotFoundError,
  FolderTooDeepError,
  INCOME_SOURCE_TYPE_LABELS,
  MAX_DOCUMENT_BYTES,
  MAX_FOLDER_DEPTH,
  RecordNotFoundError,
  YEAR_DEFAULT_FOLDERS,
  documentMimeFor,
  formatUSD,
  validFolderName,
  labelFor,
  newId,
  type Cents,
} from "@fiscode/core";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getBlobStore, sha256Hex } from "../blob-store.ts";
import { getDb, runAtomic, type AtomicQuery } from "../client.ts";
import {
  client,
  document,
  documentFolder,
  documentLink,
  expense,
  history as historyTable,
  income,
  mileage,
  type DocumentFolderInsert,
  type DocumentFolderRow,
  type DocumentInsert,
  type DocumentLinkInsert,
  type DocumentLinkRow,
  type DocumentRow,
} from "../schema/index.ts";
import { makeCrudRepo } from "./crud.ts";

// Document folders, documents and links (contract: d-data drafts/contract-documents.md). Every
// write goes through the crud repos, so it lands in history and can be reverted; the two tree
// operations write their rows and history in one transaction.

const folderCrud = makeCrudRepo<DocumentFolderInsert, DocumentFolderRow>(
  documentFolder,
  "document_folder",
  { orderBy: "name" },
);
const documentCrud = makeCrudRepo<DocumentInsert, DocumentRow>(document, "document", {
  orderBy: "name",
});
const linkCrud = makeCrudRepo<DocumentLinkInsert, DocumentLinkRow>(documentLink, "document_link");

const nowIso = () => new Date().toISOString();
const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

// ─── Folders ────────────────────────────────────────────────────────────────

export type FolderNode = {
  folder: DocumentFolderRow;
  children: FolderNode[];
  /** Live documents directly in this folder. */
  documentCount: number;
};

const liveFolders = () => folderCrud.list();

const requireFolder = async (id: string): Promise<DocumentFolderRow> => {
  const f = await folderCrud.get(id);
  if (!f) throw new FolderNotFoundError();
  return f;
};

/** Depth of a folder: a root folder is 1. */
const depthOf = (id: string | null, all: Map<string, DocumentFolderRow>): number => {
  let depth = 0;
  for (let at = id; at !== null; at = all.get(at)?.parentId ?? null) depth++;
  return depth;
};

/** The ids of a folder and every live folder below it. */
const subtreeIds = (id: string, folders: readonly DocumentFolderRow[]): string[] => {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const f of folders) if (f.parentId === out[i]) out.push(f.id);
  }
  return out;
};

const assertNameFree = (
  name: string,
  parentId: string | null,
  folders: readonly DocumentFolderRow[],
  selfId?: string,
) => {
  const taken = folders.some(
    (f) =>
      f.id !== selfId &&
      (f.parentId ?? null) === parentId &&
      f.name.localeCompare(name, "en", { sensitivity: "base" }) === 0,
  );
  if (taken) throw new FolderNameTakenError(name);
};

export const folderRepo = {
  ...folderCrud,

  /** A new folder. Throws FolderNameTakenError, FolderNotFoundError, FolderTooDeepError. */
  async create(input: {
    name: string;
    parentId?: string | null;
    taxYear?: number | null;
  }): Promise<DocumentFolderRow> {
    const name = validFolderName(input.name);
    const parentId = input.parentId ?? null;
    const folders = await liveFolders();
    if (parentId !== null) await requireFolder(parentId);
    const all = new Map(folders.map((f) => [f.id, f]));
    if (depthOf(parentId, all) + 1 > MAX_FOLDER_DEPTH) throw new FolderTooDeepError();
    assertNameFree(name, parentId, folders);
    return folderCrud.create({
      name,
      parentId,
      taxYear: input.taxYear ?? null,
      sortOrder: 0,
      deletedAt: null,
    });
  },

  async rename(id: string, rawName: string): Promise<DocumentFolderRow> {
    const name = validFolderName(rawName);
    const folder = await requireFolder(id);
    assertNameFree(name, folder.parentId ?? null, await liveFolders(), id);
    return (await folderCrud.update(id, { name }))!;
  },

  /** Move under `newParentId` (null = root). Throws FolderCycleError, FolderNameTakenError, FolderTooDeepError. */
  async move(id: string, newParentId: string | null): Promise<DocumentFolderRow> {
    const folder = await requireFolder(id);
    const folders = await liveFolders();
    if (newParentId !== null) {
      await requireFolder(newParentId);
      if (subtreeIds(id, folders).includes(newParentId)) throw new FolderCycleError();
    }
    const all = new Map(folders.map((f) => [f.id, f]));
    // The deepest level below this folder, counting itself as 1.
    const height = (fid: string): number =>
      1 + Math.max(0, ...folders.filter((f) => f.parentId === fid).map((f) => height(f.id)));
    if (depthOf(newParentId, all) + height(id) > MAX_FOLDER_DEPTH) throw new FolderTooDeepError();
    assertNameFree(folder.name, newParentId, folders, id);
    return (await folderCrud.update(id, { parentId: newParentId }))!;
  },

  /** Live folders and documents in a folder's subtree, itself included: for the delete confirm. */
  async countTree(id: string): Promise<{ folders: number; documents: number }> {
    const folders = await liveFolders();
    const ids = subtreeIds(id, folders);
    const docs = (await documentCrud.list()).filter((d) => d.folderId && ids.includes(d.folderId));
    return { folders: ids.length, documents: docs.length };
  },

  /**
   * Soft-delete a folder, every live folder below it and every live document in them, in one
   * transaction with their history. Returns what it deleted, for `restoreTree` (undo).
   */
  async softDeleteTree(id: string): Promise<{ folderIds: string[]; documentIds: string[] }> {
    await requireFolder(id);
    const folders = await liveFolders();
    const folderIds = subtreeIds(id, folders);
    const docs = (await documentCrud.list()).filter(
      (d) => d.folderId !== null && folderIds.includes(d.folderId),
    );
    const at = nowIso();
    await runAtomic([
      ...rowsWrite(
        documentFolder,
        "document_folder",
        folders.filter((f) => folderIds.includes(f.id)),
        {
          deletedAt: at,
          updatedAt: at,
        },
        "delete",
      ),
      ...rowsWrite(document, "document", docs, { deletedAt: at, updatedAt: at }, "delete"),
    ]);
    return { folderIds, documentIds: docs.map((d) => d.id) };
  },

  /** Undo `softDeleteTree`: bring back exactly what it deleted, in one transaction. */
  async restoreTree(result: { folderIds: string[]; documentIds: string[] }): Promise<void> {
    const db = getDb();
    const folders = result.folderIds.length
      ? ((await db
          .select()
          .from(documentFolder)
          .where(inArray(documentFolder.id, result.folderIds))) as DocumentFolderRow[])
      : [];
    const docs = result.documentIds.length
      ? ((await db
          .select()
          .from(document)
          .where(inArray(document.id, result.documentIds))) as DocumentRow[])
      : [];
    const at = nowIso();
    await runAtomic([
      ...rowsWrite(
        documentFolder,
        "document_folder",
        folders,
        { deletedAt: null, updatedAt: at },
        "revert",
      ),
      ...rowsWrite(document, "document", docs, { deletedAt: null, updatedAt: at }, "revert"),
    ]);
  },

  /** Live folders as a tree: sorted by sort_order then name, with live document counts. */
  async tree(): Promise<FolderNode[]> {
    const folders = await liveFolders();
    const counts = new Map<string, number>();
    for (const d of await documentCrud.list()) {
      if (d.folderId) counts.set(d.folderId, (counts.get(d.folderId) ?? 0) + 1);
    }
    const build = (parentId: string | null): FolderNode[] =>
      folders
        .filter((f) => (f.parentId ?? null) === parentId)
        .toSorted((a, b) => a.sortOrder - b.sortOrder || byName(a, b))
        .map((folder) => ({
          folder,
          children: build(folder.id),
          documentCount: counts.get(folder.id) ?? 0,
        }));
    return build(null);
  },

  /**
   * The year's default folders: a `<year>` root with Expenses, Income, Mileage, Health insurance,
   * Tax forms and Other. Idempotent. A folder the user deleted is never made again: a deleted row
   * with that name in that place counts as there. Returns the live ones, root first, in order.
   */
  async ensureYearDefaults(taxYear: number): Promise<DocumentFolderRow[]> {
    const everyFolder = await folderCrud.listIncludingDeleted();
    const find = (name: string, parentId: string | null) =>
      everyFolder
        .filter((f) => (f.parentId ?? null) === parentId && f.name === name)
        .toSorted((a, b) => Number(a.deletedAt !== null) - Number(b.deletedAt !== null))[0];
    const rootName = String(taxYear);
    let root = find(rootName, null);
    if (root?.deletedAt) return [];
    root ??= await folderRepo.create({ name: rootName, taxYear });
    const out = [root];
    for (const name of YEAR_DEFAULT_FOLDERS) {
      const existing = find(name, root.id);
      if (existing?.deletedAt) continue;
      out.push(existing ?? (await folderRepo.create({ name, parentId: root.id, taxYear })));
    }
    return out;
  },
};

/** Update rows to `set` and write one history row each, as queries for `runAtomic`. */
const rowsWrite = <T extends { id: string }>(
  table: typeof documentFolder | typeof document,
  entity: string,
  rows: readonly T[],
  set: Record<string, unknown>,
  op: "delete" | "revert",
): AtomicQuery[] => {
  const db = getDb();
  const at = nowIso();
  return rows.flatMap((row) => [
    db
      .update(table)
      .set(set as never)
      .where(eq(table.id, row.id)),
    db.insert(historyTable).values({
      id: newId(),
      entity,
      entityId: row.id,
      op,
      beforeJson: JSON.stringify(row),
      afterJson: JSON.stringify({ ...row, ...set }),
      at,
    }),
  ]);
};

// ─── Documents ──────────────────────────────────────────────────────────────

type NamedBlob = Blob & { name: string };

/** Size, type and hash checks, then the blob is stored (once per sha). */
const storeBytes = async (bytes: NamedBlob) => {
  if (bytes.size > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError(bytes.name);
  const mime = documentMimeFor(bytes.name, bytes.type);
  if (!mime) throw new DocumentTypeNotAllowedError(bytes.name);
  const sha256 = await sha256Hex(bytes);
  await getBlobStore().put(sha256, bytes);
  return { mime, sha256, sizeBytes: bytes.size };
};

const requireDocument = async (id: string): Promise<DocumentRow> => {
  const d = await documentCrud.get(id);
  if (!d) throw new DocumentNotFoundError();
  return d;
};

export const documentRepo = {
  ...documentCrud,

  /** Store a file and add a document row. Throws DocumentTooLargeError, DocumentTypeNotAllowedError, StorageQuotaError. */
  async upload(bytes: NamedBlob, options: { folderId?: string | null } = {}): Promise<DocumentRow> {
    const folderId = options.folderId ?? null;
    if (folderId !== null) await requireFolder(folderId);
    const stored = await storeBytes(bytes);
    return documentCrud.create({
      folderId,
      name: bytes.name,
      ...stored,
      addedAt: nowIso(),
      notes: null,
      deletedAt: null,
    });
  },

  /** Each file on its own: a failure never undoes the others (drag and drop). */
  async uploadMany(
    files: readonly NamedBlob[],
    options: { folderId?: string | null } = {},
  ): Promise<{ ok: DocumentRow[]; failed: { name: string; error: Error }[] }> {
    const ok: DocumentRow[] = [];
    const failed: { name: string; error: Error }[] = [];
    for (const f of files) {
      try {
        ok.push(await documentRepo.upload(f, options));
      } catch (error) {
        failed.push({ name: f.name, error: error as Error });
      }
    }
    return { ok, failed };
  },

  async rename(id: string, name: string): Promise<DocumentRow> {
    await requireDocument(id);
    return (await documentCrud.update(id, { name: name.trim() }))!;
  },

  async move(id: string, folderId: string | null): Promise<DocumentRow> {
    await requireDocument(id);
    if (folderId !== null) await requireFolder(folderId);
    return (await documentCrud.update(id, { folderId }))!;
  },

  /** New bytes for a document: a new version. History keeps the old sha, and its blob stays. */
  async replaceBytes(id: string, bytes: NamedBlob): Promise<DocumentRow> {
    await requireDocument(id);
    const stored = await storeBytes(bytes);
    return (await documentCrud.update(id, stored))!;
  },

  async listInFolder(folderId: string | null): Promise<DocumentRow[]> {
    const db = getDb();
    return (await db
      .select()
      .from(document)
      .where(
        and(
          isNull(document.deletedAt),
          folderId === null ? isNull(document.folderId) : eq(document.folderId, folderId),
        ),
      )
      .orderBy(document.name)) as DocumentRow[];
  },

  /** Live documents whose name or notes contain `query` (case-insensitive). */
  async search(query: string): Promise<DocumentRow[]> {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    return (await documentCrud.list()).filter(
      (d) => d.name.toLowerCase().includes(q) || (d.notes ?? "").toLowerCase().includes(q),
    );
  },

  /** The current bytes, typed with the row's mime. Throws DocumentBytesMissingError. */
  async readBytes(id: string): Promise<Blob> {
    const d = await requireDocument(id);
    const blob = await getBlobStore().get(d.sha256);
    if (!blob) throw new DocumentBytesMissingError();
    return new Blob([blob], { type: d.mime });
  },

  /** An object URL for preview. The caller revokes it (URL.revokeObjectURL). */
  async objectUrl(id: string): Promise<string> {
    return URL.createObjectURL(await documentRepo.readBytes(id));
  },

  /** Every version of the bytes, oldest first, from history; `available` = this device has them. */
  async versions(
    id: string,
  ): Promise<
    { at: string; sha256: string; sizeBytes: number; name: string; available: boolean }[]
  > {
    const db = getDb();
    const rows = await db
      .select()
      .from(historyTable)
      .where(and(eq(historyTable.entity, "document"), eq(historyTable.entityId, id)))
      .orderBy(historyTable.at);
    const out: {
      at: string;
      sha256: string;
      sizeBytes: number;
      name: string;
      available: boolean;
    }[] = [];
    for (const h of rows) {
      if (!h.afterJson) continue;
      const after = JSON.parse(h.afterJson) as DocumentRow;
      if (out.at(-1)?.sha256 === after.sha256) continue;
      out.push({
        at: h.at,
        sha256: after.sha256,
        sizeBytes: after.sizeBytes,
        name: after.name,
        available: await getBlobStore().has(after.sha256),
      });
    }
    return out;
  },
};

// ─── Links ──────────────────────────────────────────────────────────────────

export type LinkedRecord = {
  recordType: string;
  id: string;
  date: string;
  label: string;
  amountCents?: number;
};

/** A record by type and id, live or deleted, with its label ("2026-03-16 · Equipment · $129.99"). */
const recordFor = async (
  recordType: string,
  id: string,
): Promise<(LinkedRecord & { deletedAt: string | null }) | undefined> => {
  const db = getDb();
  const money = (c: number) => formatUSD(c as Cents);
  if (recordType === "expense") {
    const [r] = await db.select().from(expense).where(eq(expense.id, id)).limit(1);
    if (!r) return undefined;
    return {
      recordType,
      id,
      date: r.date,
      label: `${r.date} · ${labelFor(EXPENSE_CATEGORY_LABELS, r.category)} · ${money(r.amountCents)}`,
      amountCents: r.amountCents,
      deletedAt: r.deletedAt,
    };
  }
  if (recordType === "income") {
    const [r] = await db.select().from(income).where(eq(income.id, id)).limit(1);
    if (!r) return undefined;
    const [c] = r.clientId
      ? await db.select().from(client).where(eq(client.id, r.clientId)).limit(1)
      : [];
    const who = c?.name ?? labelFor(INCOME_SOURCE_TYPE_LABELS, r.sourceType);
    return {
      recordType,
      id,
      date: r.date,
      label: `${r.date} · ${who} · ${money(r.amountCents)}`,
      amountCents: r.amountCents,
      deletedAt: r.deletedAt,
    };
  }
  if (recordType === "mileage") {
    const [r] = await db.select().from(mileage).where(eq(mileage.id, id)).limit(1);
    if (!r) return undefined;
    const what = r.purpose ? ` · ${r.purpose}` : "";
    return {
      recordType,
      id,
      date: r.date,
      label: `${r.date}${what} · ${r.businessMiles} mi`,
      deletedAt: r.deletedAt,
    };
  }
  return undefined;
};

export const documentLinkRepo = {
  ...linkCrud,

  /** Link a document to a record. Idempotent: the live link with that triple comes back. Throws RecordNotFoundError. */
  async link(documentId: string, recordType: string, recordId: string): Promise<DocumentLinkRow> {
    await requireDocument(documentId);
    const record = await recordFor(recordType, recordId);
    if (!record || record.deletedAt !== null) throw new RecordNotFoundError();
    const db = getDb();
    const [existing] = (await db
      .select()
      .from(documentLink)
      .where(
        and(
          isNull(documentLink.deletedAt),
          eq(documentLink.documentId, documentId),
          eq(documentLink.recordType, recordType),
          eq(documentLink.recordId, recordId),
        ),
      )
      .limit(1)) as DocumentLinkRow[];
    if (existing) return existing;
    return linkCrud.create({ documentId, recordType, recordId, deletedAt: null });
  },

  /** Unlink: a soft delete (undo with revertTo). */
  async unlink(linkId: string): Promise<boolean> {
    return linkCrud.softDelete(linkId);
  },

  /** Live links to live documents for one record. */
  async forRecord(
    recordType: string,
    recordId: string,
  ): Promise<(DocumentLinkRow & { document: DocumentRow })[]> {
    const db = getDb();
    const rows = await db
      .select({ link: documentLink, document })
      .from(documentLink)
      .innerJoin(document, eq(document.id, documentLink.documentId))
      .where(
        and(
          isNull(documentLink.deletedAt),
          isNull(document.deletedAt),
          eq(documentLink.recordType, recordType),
          eq(documentLink.recordId, recordId),
        ),
      )
      .orderBy(document.name);
    return rows.map((r) => ({
      ...(r.link as DocumentLinkRow),
      document: r.document as DocumentRow,
    }));
  },

  /** Live links from one document, with each record's label. Links to deleted records are left out (and kept). */
  async forDocument(documentId: string): Promise<(DocumentLinkRow & { record: LinkedRecord })[]> {
    const db = getDb();
    const links = (await db
      .select()
      .from(documentLink)
      .where(and(isNull(documentLink.deletedAt), eq(documentLink.documentId, documentId)))
      .orderBy(documentLink.createdAt)) as DocumentLinkRow[];
    const out: (DocumentLinkRow & { record: LinkedRecord })[] = [];
    for (const l of links) {
      const r = await recordFor(l.recordType, l.recordId);
      if (!r || r.deletedAt !== null) continue;
      const { deletedAt: _d, ...record } = r;
      out.push({ ...l, record });
    }
    return out;
  },

  /** Live link counts per record id, for list badges. One query. Ids with none are absent. */
  async countsFor(recordType: string, ids: readonly string[]): Promise<Record<string, number>> {
    if (ids.length === 0) return {};
    const db = getDb();
    const rows = await db
      .select({ id: documentLink.recordId, n: sql<number>`count(*)` })
      .from(documentLink)
      .innerJoin(document, eq(document.id, documentLink.documentId))
      .where(
        and(
          isNull(documentLink.deletedAt),
          isNull(document.deletedAt),
          eq(documentLink.recordType, recordType),
          inArray(documentLink.recordId, [...ids]),
        ),
      )
      .groupBy(documentLink.recordId);
    return Object.fromEntries(rows.map((r) => [r.id, Number(r.n)]));
  },

  /** Live link counts per live document, for the document list. One query. Documents with none are absent. */
  async countsByDocument(): Promise<Map<string, number>> {
    const db = getDb();
    const rows = await db
      .select({ id: documentLink.documentId, n: sql<number>`count(*)` })
      .from(documentLink)
      .innerJoin(document, eq(document.id, documentLink.documentId))
      .where(and(isNull(documentLink.deletedAt), isNull(document.deletedAt)))
      .groupBy(documentLink.documentId);
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  },
};
