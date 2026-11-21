// TEST FAKE of @fiscode/db's document repos (folderRepo, documentRepo, documentLinkRepo), in
// memory: jsdom has neither SQLite nor OPFS. Tests mock "@fiscode/db" with these. It keeps the real
// repos' rules the UI depends on and throws @fiscode/core's real errors. It was the stub the
// Documents screen was built against before d-data #84; the app now uses the real repos.
import {
  ALLOWED_DOCUMENT_MIMES,
  DocumentBytesMissingError,
  DocumentNotFoundError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
  FolderCycleError,
  FolderNameInvalidError,
  FolderNameTakenError,
  FolderNotFoundError,
  FolderTooDeepError,
  MAX_DOCUMENT_BYTES,
  RecordNotFoundError,
  YEAR_DEFAULT_FOLDER_KEYS,
  YEAR_ROOT_KEY,
  validDocumentName,
} from "@fiscode/core";
import type { DocumentFolderRow, DocumentLinkRow, DocumentRow } from "@fiscode/csv";
import type { FolderNode } from "@fiscode/db";

const MAX_FOLDER_DEPTH = 8;

// ─── In-memory store ────────────────────────────────────────────────────────

const folders = new Map<string, DocumentFolderRow>();
const documents = new Map<string, DocumentRow>();
const links = new Map<string, DocumentLinkRow>();
const blobs = new Map<string, Blob>();
const versionLog = new Map<
  string,
  { at: string; sha256: string; sizeBytes: number; name: string }[]
>();
let seq = 0;
const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${(++seq).toString(36).padStart(4, "0")}`;
const live = <T extends { deletedAt: string | null }>(rows: Iterable<T>) =>
  [...rows].filter((r) => r.deletedAt === null);

const cleanName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) throw new FolderNameInvalidError("Enter a name.");
  if (trimmed.includes("/")) throw new FolderNameInvalidError("A name can't contain /.");
  return trimmed.slice(0, 120);
};
const depthOf = (id: string | null): number => {
  let depth = 0;
  for (let at = id; at; at = folders.get(at)?.parentId ?? null) depth++;
  return depth;
};
const assertNameFree = (parentId: string | null, name: string, exceptId?: string) => {
  const taken = live(folders.values()).some(
    (f) =>
      f.parentId === parentId && f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new FolderNameTakenError(name);
};
const subtreeIds = (id: string): string[] => [
  id,
  ...live(folders.values())
    .filter((f) => f.parentId === id)
    .flatMap((f) => subtreeIds(f.id)),
];

export const sha256Hex = async (blob: Blob) => {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const EXT_MIMES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  gif: "image/gif",
  txt: "text/plain",
};
const mimeOf = (file: Blob & { name: string }) =>
  file.type || EXT_MIMES[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";

async function storeBytes(file: Blob & { name: string }) {
  const mime = mimeOf(file);
  if (!(ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(mime)) {
    throw new DocumentTypeNotAllowedError(file.name);
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentTooLargeError(file.name);
  }
  const sha256 = await sha256Hex(file);
  const existed = blobs.has(sha256);
  if (!existed) blobs.set(sha256, new Blob([await file.arrayBuffer()], { type: mime }));
  return { mime, sha256, existed };
}

// ─── folderRepo ─────────────────────────────────────────────────────────────

export const folderRepo = {
  async list() {
    return live(folders.values());
  },
  async listIncludingDeleted() {
    return [...folders.values()];
  },
  async get(id: string) {
    return folders.get(id);
  },
  async create({
    name,
    parentId = null,
    taxYear = null,
    defaultKey = null,
  }: {
    name: string;
    parentId?: string | null;
    taxYear?: number | null;
    defaultKey?: string | null;
  }): Promise<DocumentFolderRow> {
    const clean = cleanName(name);
    if (parentId && !folders.get(parentId)) throw new FolderNotFoundError();
    if (depthOf(parentId) + 1 > MAX_FOLDER_DEPTH) {
      throw new FolderTooDeepError();
    }
    assertNameFree(parentId, clean);
    const t = now();
    const row: DocumentFolderRow = {
      id: newId("fld"),
      parentId,
      name: clean,
      taxYear: taxYear ?? (parentId ? (folders.get(parentId)?.taxYear ?? null) : null),
      sortOrder: 0,
      defaultKey,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    };
    folders.set(row.id, row);
    return row;
  },
  async rename(id: string, name: string): Promise<DocumentFolderRow> {
    const row = folders.get(id);
    if (!row) throw new FolderNotFoundError();
    const clean = cleanName(name);
    assertNameFree(row.parentId, clean, id);
    const next = { ...row, name: clean, updatedAt: now() };
    folders.set(id, next);
    return next;
  },
  async move(id: string, newParentId: string | null): Promise<DocumentFolderRow> {
    const row = folders.get(id);
    if (!row) throw new FolderNotFoundError();
    if (newParentId && subtreeIds(id).includes(newParentId)) {
      throw new FolderCycleError();
    }
    const height = Math.max(...subtreeIds(id).map((f) => depthOf(f) - depthOf(id) + 1));
    if (depthOf(newParentId) + height > MAX_FOLDER_DEPTH) {
      throw new FolderTooDeepError();
    }
    assertNameFree(newParentId, row.name, id);
    const next = { ...row, parentId: newParentId, updatedAt: now() };
    folders.set(id, next);
    return next;
  },
  async softDelete(id: string) {
    const row = folders.get(id);
    if (!row || row.deletedAt) return false;
    folders.set(id, { ...row, deletedAt: now() });
    return true;
  },
  /** Never refuses (#84): a taken name comes back as "Name (2)", a gone parent as the year root's
   * child, or the top. */
  async revertTo(id: string, snapshot: DocumentFolderRow) {
    const row = { ...snapshot };
    const parentLive = (pid: string | null) => !pid || folders.get(pid)?.deletedAt === null;
    if (!parentLive(row.parentId)) {
      const root = live(folders.values()).find(
        (f) => f.defaultKey === YEAR_ROOT_KEY && f.taxYear === row.taxYear && f.id !== id,
      );
      row.parentId = root?.id ?? null;
    }
    if (row.deletedAt === null) {
      const taken = (name: string) =>
        live(folders.values()).some(
          (f) =>
            f.id !== id &&
            f.parentId === row.parentId &&
            f.name.toLowerCase() === name.toLowerCase(),
        );
      for (let n = 2, base = row.name; taken(row.name); n++) row.name = `${base} (${n})`;
    }
    folders.set(id, row);
    return row;
  },
  async countTree(id: string) {
    const ids = subtreeIds(id);
    return {
      folders: ids.length,
      documents: live(documents.values()).filter((d) => d.folderId && ids.includes(d.folderId))
        .length,
    };
  },
  async softDeleteTree(id: string) {
    const folderIds = subtreeIds(id);
    const documentIds = live(documents.values())
      .filter((d) => d.folderId && folderIds.includes(d.folderId))
      .map((d) => d.id);
    const t = now();
    for (const f of folderIds) folders.set(f, { ...folders.get(f)!, deletedAt: t });
    for (const d of documentIds) documents.set(d, { ...documents.get(d)!, deletedAt: t });
    return { folderIds, documentIds };
  },
  async restoreTree({ folderIds, documentIds }: { folderIds: string[]; documentIds: string[] }) {
    const [top, ...rest] = folderIds;
    if (top) await folderRepo.revertTo(top, { ...folders.get(top)!, deletedAt: null });
    for (const f of rest) folders.set(f, { ...folders.get(f)!, deletedAt: null });
    for (const d of documentIds) documents.set(d, { ...documents.get(d)!, deletedAt: null });
  },
  async tree(): Promise<FolderNode[]> {
    const all = live(folders.values());
    const docs = live(documents.values());
    const build = (parentId: string | null): FolderNode[] =>
      all
        .filter((f) => f.parentId === parentId)
        .toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((folder) => ({
          folder,
          children: build(folder.id),
          documentCount: docs.filter((d) => d.folderId === folder.id).length,
        }));
    return build(null);
  },
  async ensureYearDefaults(taxYear: number): Promise<DocumentFolderRow[]> {
    // By default_key, so a renamed default folder is still the default; a deleted one stays
    // deleted (the contract tracks this through history).
    const byKey = (parentId: string | null, key: string) =>
      [...folders.values()].find(
        (f) => f.parentId === parentId && f.defaultKey === key && f.taxYear === taxYear,
      );
    const existing = byKey(null, YEAR_ROOT_KEY);
    if (existing?.deletedAt) return [];
    const year =
      existing ??
      (await folderRepo.create({ name: String(taxYear), taxYear, defaultKey: YEAR_ROOT_KEY }));
    const made = [year];
    for (const [name, key] of Object.entries(YEAR_DEFAULT_FOLDER_KEYS)) {
      if (!byKey(year.id, key)) {
        made.push(await folderRepo.create({ name, parentId: year.id, taxYear, defaultKey: key }));
      }
    }
    return made;
  },
};

// ─── documentRepo ───────────────────────────────────────────────────────────

export const documentRepo = {
  async list() {
    return live(documents.values());
  },
  async listIncludingDeleted() {
    return [...documents.values()];
  },
  async get(id: string) {
    return documents.get(id);
  },
  async update(id: string, patch: Partial<Pick<DocumentRow, "notes" | "name">>) {
    const row = documents.get(id);
    if (!row) throw new DocumentNotFoundError();
    const next = { ...row, ...patch, updatedAt: now() };
    documents.set(id, next);
    return next;
  },
  async softDelete(id: string) {
    const row = documents.get(id);
    if (!row || row.deletedAt) return false;
    documents.set(id, { ...row, deletedAt: now() });
    return true;
  },
  async revertTo(id: string, snapshot: DocumentRow) {
    documents.set(id, snapshot);
    return snapshot;
  },
  async upload(
    file: Blob & { name: string },
    { folderId = null }: { folderId?: string | null } = {},
  ): Promise<DocumentRow> {
    const { mime, sha256 } = await storeBytes(file);
    const t = now();
    const row: DocumentRow = {
      id: newId("doc"),
      folderId,
      name: file.name,
      mime,
      sizeBytes: file.size,
      sha256,
      addedAt: t,
      notes: null,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    };
    documents.set(row.id, row);
    versionLog.set(row.id, [{ at: t, sha256, sizeBytes: file.size, name: file.name }]);
    return row;
  },
  async uploadMany(files: (Blob & { name: string })[], opts: { folderId?: string | null } = {}) {
    const ok: DocumentRow[] = [];
    const failed: { name: string; error: Error }[] = [];
    for (const file of files) {
      try {
        ok.push(await documentRepo.upload(file, opts));
      } catch (error) {
        failed.push({ name: file.name, error: error as Error });
      }
    }
    return { ok, failed };
  },
  async rename(id: string, name: string) {
    return documentRepo.update(id, { name: validDocumentName(name) });
  },
  async move(id: string, folderId: string | null) {
    const row = documents.get(id);
    if (!row) throw new DocumentNotFoundError();
    const next = { ...row, folderId, updatedAt: now() };
    documents.set(id, next);
    return next;
  },
  async replaceBytes(id: string, file: Blob & { name: string }) {
    const { mime, sha256 } = await storeBytes(file);
    const row = documents.get(id)!;
    const t = now();
    const next = { ...row, mime, sha256, sizeBytes: file.size, updatedAt: t };
    documents.set(id, next);
    versionLog.get(id)?.push({ at: t, sha256, sizeBytes: file.size, name: row.name });
    return next;
  },
  async listInFolder(folderId: string | null) {
    return live(documents.values()).filter((d) => d.folderId === folderId);
  },
  async search(query: string) {
    const q = query.trim().toLowerCase();
    return live(documents.values()).filter(
      (d) => d.name.toLowerCase().includes(q) || (d.notes ?? "").toLowerCase().includes(q),
    );
  },
  async readBytes(id: string): Promise<Blob> {
    const row = documents.get(id);
    const blob = row && blobs.get(row.sha256);
    if (!blob) throw new DocumentBytesMissingError();
    return blob;
  },
  async objectUrl(id: string): Promise<string> {
    return URL.createObjectURL(await documentRepo.readBytes(id));
  },
  async versions(id: string) {
    return (
      (versionLog.get(id) ?? [])
        // Oldest first, as the real repo returns them.
        .map((v) => ({ ...v, available: blobs.has(v.sha256) }))
    );
  },
};

/** Stub only (tests and the missing-bytes walk): forget a document's bytes, as a CSV-only restore. */
export const dropBytesForStub = (sha256: string) => blobs.delete(sha256);

// ─── documentLinkRepo ───────────────────────────────────────────────────────

/** Stub only: records the real repo would find deleted, so `link` refuses them. */
const goneRecords = new Set<string>();
export const deleteRecordForStub = (recordId: string) => goneRecords.add(recordId);

export const documentLinkRepo = {
  async link(documentId: string, recordType: string, recordId: string): Promise<DocumentLinkRow> {
    if (!documents.get(documentId) || documents.get(documentId)?.deletedAt)
      throw new DocumentNotFoundError();
    if (goneRecords.has(recordId)) throw new RecordNotFoundError();
    const same = live(links.values()).find(
      (l) => l.documentId === documentId && l.recordType === recordType && l.recordId === recordId,
    );
    if (same) return same;
    const t = now();
    const row: DocumentLinkRow = {
      id: newId("lnk"),
      documentId,
      recordType,
      recordId,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    };
    links.set(row.id, row);
    return row;
  },
  async unlink(linkId: string) {
    const row = links.get(linkId);
    if (!row || row.deletedAt) return false;
    links.set(linkId, { ...row, deletedAt: now() });
    return true;
  },
  async revertTo(id: string, snapshot: DocumentLinkRow) {
    if (!links.has(id)) return undefined;
    links.set(id, { ...snapshot, updatedAt: now() });
    return links.get(id);
  },
  async forRecord(recordType: string, recordId: string) {
    return live(links.values())
      .filter((l) => l.recordType === recordType && l.recordId === recordId)
      .map((l) => ({ ...l, document: documents.get(l.documentId)! }))
      .filter((l) => l.document && l.document.deletedAt === null)
      .toSorted((a, b) => a.document.name.localeCompare(b.document.name));
  },
  async forDocument(documentId: string) {
    return live(links.values())
      .filter((l) => l.documentId === documentId)
      .map((l) => ({
        ...l,
        record: {
          recordType: l.recordType,
          id: l.recordId,
          date: "",
          label: `${l.recordType} ${l.recordId}`,
        },
      }));
  },
  async countsFor(recordType: string, ids: string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const l of live(links.values())) {
      if (l.recordType === recordType && ids.includes(l.recordId)) {
        counts[l.recordId] = (counts[l.recordId] ?? 0) + 1;
      }
    }
    return counts;
  },
  /** Links per document, for the list's link count in one query. */
  async countsByDocument(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const l of live(links.values()))
      counts.set(l.documentId, (counts.get(l.documentId) ?? 0) + 1);
    return counts;
  },
};
