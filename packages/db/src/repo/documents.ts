import {
  DocumentBytesMissingError,
  DocumentNotFoundError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
  EXPENSE_CATEGORY_LABELS,
  FILING_STATUS_LABELS,
  HOME_OFFICE_METHOD_LABELS,
  FolderCycleError,
  FolderNameTakenError,
  FolderNotFoundError,
  FolderTooDeepError,
  INCOME_SOURCE_TYPE_LABELS,
  MAX_DOCUMENT_BYTES,
  MAX_FOLDER_DEPTH,
  RecordNotFoundError,
  YEAR_DEFAULT_FOLDERS,
  YEAR_DEFAULT_FOLDER_KEYS,
  YEAR_ROOT_KEY,
  FolderFixedError,
  vaultFolderRules,
  validDocumentName,
  freeFolderName,
  documentMimeFor,
  formatUSD,
  validFolderName,
  labelFor,
  newId,
  type Cents,
} from "@fiscode/core";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getVaultStore, sha256Hex } from "../vault/store.ts";
import { assertVaultWritable } from "../vault/state.ts";
import {
  changeTree,
  previewDocumentPath,
  previewFolderPath,
  type DocumentChange,
  type PathPreview,
  type RunHooks,
  type ShortenedFolder,
} from "./document-tree.ts";
import { historyQuery } from "../vault/tree.ts";
import { getDb, runAtomic, type AtomicQuery } from "../client.ts";
import {
  client,
  document,
  documentFolder,
  documentLink,
  expense,
  history as historyTable,
  homeOffice,
  income,
  mileage,
  profile,
  vehicle,
  type DocumentFolderInsert,
  type DocumentFolderRow,
  type DocumentInsert,
  type DocumentLinkInsert,
  type DocumentLinkRow,
  type DocumentRow,
} from "../schema/index.ts";
import { changesNothing } from "./base.ts";
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
    const at = nowIso();
    const row: DocumentFolderRow = {
      id: newId(),
      name,
      parentId,
      taxYear: input.taxYear ?? null,
      sortOrder: 0,
      defaultKey: null,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    // No file moves, but the path budget (§ 3.8) is checked against the tree as it will be.
    await changeTree({ folders: [{ next: row, insert: true, op: "insert" }] }, strict);
    return row;
  },

  /**
   * Where a folder would be on disk if saved now (new when `id` is absent), by the same rules as
   * the save: read-only. `fits` is false when it or a file it relocates would be over budget.
   */
  async previewPath(input: {
    id?: string;
    parentId: string | null;
    name: string;
  }): Promise<PathPreview> {
    const name = validFolderName(input.name);
    const existing = input.id ? await requireFolder(input.id) : undefined;
    const at = nowIso();
    const next: DocumentFolderRow = existing
      ? { ...existing, parentId: input.parentId, name, updatedAt: at }
      : {
          id: newId(),
          name,
          parentId: input.parentId,
          taxYear: null,
          sortOrder: 0,
          defaultKey: null,
          deletedAt: null,
          createdAt: at,
          updatedAt: at,
        };
    return previewFolderPath(next, !existing, linkedDates);
  },

  /**
   * Throws FolderFixedError (a year folder), FolderNameTakenError, VaultPathTooLongError (a file
   * below would be over budget), OperationCancelledError (`hooks.signal`, before the commit).
   */
  async rename(id: string, rawName: string, hooks: RunHooks = {}): Promise<DocumentFolderRow> {
    const name = validFolderName(rawName);
    const folder = await requireFolder(id);
    if (!vaultFolderRules(folder.defaultKey).rename) {
      throw new FolderFixedError(folder.defaultKey);
    }
    assertNameFree(name, folder.parentId ?? null, await liveFolders(), id);
    return folderUpdate(folder, { name }, hooks);
  },

  /**
   * Move under `newParentId` (null = root). Throws FolderFixedError (a year or default folder),
   * FolderCycleError, FolderNameTakenError, FolderTooDeepError, OperationCancelledError.
   */
  async move(
    id: string,
    newParentId: string | null,
    hooks: RunHooks = {},
  ): Promise<DocumentFolderRow> {
    const folder = await requireFolder(id);
    if (!vaultFolderRules(folder.defaultKey).move) {
      throw new FolderFixedError(folder.defaultKey);
    }
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
    return folderUpdate(folder, { parentId: newParentId }, hooks);
  },

  /**
   * Field changes through the tree, so a name or parent change moves the files below (§ 6). A
   * name or parent change goes through `rename` / `move`, so it has their rules and errors
   * (FolderFixedError and the rest). Revert, restore and import never come through here.
   */
  async update(
    id: string,
    patch: Partial<DocumentFolderInsert>,
  ): Promise<DocumentFolderRow | undefined> {
    const folder = await folderCrud.get(id);
    if (!folder) return undefined;
    const { name, parentId, ...rest } = patch as Partial<DocumentFolderRow>;
    if (name !== undefined && name !== folder.name) await folderRepo.rename(id, name);
    if (parentId !== undefined && parentId !== folder.parentId) {
      await folderRepo.move(id, parentId);
    }
    return folderUpdate(await requireFolder(id), rest);
  },

  /** A folder never goes alone: its subtree and documents go with it (`softDeleteTree`). */
  async softDelete(id: string): Promise<boolean> {
    if (!(await folderCrud.get(id))) return false;
    await folderRepo.softDeleteTree(id);
    return true;
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
    // Each document's bytes go to _fiscode/trash/ (copy rule), then its file leaves the tree.
    await changeTree(
      {
        folders: folders
          .filter((f) => folderIds.includes(f.id))
          .map((f) => ({ next: { ...f, deletedAt: at, updatedAt: at }, op: "delete" as const })),
        documents: docs.map((d) => ({
          next: { ...d, deletedAt: at, updatedAt: at },
          op: "delete" as const,
        })),
      },
      lenient,
    );
    return { folderIds, documentIds: docs.map((d) => d.id) };
  },

  /** Undo `softDeleteTree`: bring back exactly what it deleted, in one transaction. */
  async restoreTree(result: {
    folderIds: string[];
    documentIds: string[];
  }): Promise<{ shortened: ShortenedFolder[] }> {
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
    // The folders whose parent isn't coming back with them get a place like revertTo's: a name
    // now taken comes back as "Name (2)". The rest come back under their parent, as they were.
    const coming = new Set(folders.map((f) => f.id));
    const live = await liveFolders();
    // Never refuses: a folder path over budget is shortened (§ 3.8) and reported.
    const { shortened } = await changeTree(
      {
        folders: folders.map((f) => ({
          next: {
            ...f,
            deletedAt: null,
            updatedAt: at,
            ...(f.parentId !== null && coming.has(f.parentId) ? {} : placeFor(f, live)),
          },
          op: "revert" as const,
        })),
        documents: docs.map((d) => ({
          next: { ...d, deletedAt: null, updatedAt: at },
          op: "revert" as const,
        })),
      },
      lenient,
    );
    return { shortened };
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
   * Tax forms and Other. Idempotent, and safe to call twice at once (one in flight per year).
   * Each is known by its `default_key`: a key that has ever existed for the year, under any name,
   * live or deleted, is never made again (a renamed, moved or deleted default stays as the user
   * left it). A folder the user made with the same name (any case) in that place is adopted.
   * Every write runs in one transaction (all or nothing). Returns the live ones, root first.
   *
   * Concurrency: within a tab, calls at once share one run (the in-flight guard). Across tabs, the
   * partial unique index on document_folder (tax_year, default_key) refuses a second folder with a
   * year's key, so the tab that writes second has its whole transaction rolled back; it then reads
   * again and adopts the folders the other tab made (`ensureYearDefaultsNow`). One set, no error.
   */
  ensureYearDefaults(taxYear: number): Promise<DocumentFolderRow[]> {
    const running = ensuring.get(taxYear);
    if (running) return running;
    const run = ensureYearDefaultsNow(taxYear).finally(() => ensuring.delete(taxYear));
    ensuring.set(taxYear, run);
    return run;
  },

  /**
   * Restore a folder from History (also the undo of a single delete). Never refuses: a name now
   * taken by a live sibling comes back as "Name (2)" (or the next free number), and a folder whose
   * parent is gone comes back under its tax year's root, or at the top level.
   */
  async revertTo(id: string, snapshot: DocumentFolderRow): Promise<DocumentFolderRow | undefined> {
    const exists = (await folderCrud.listIncludingDeleted()).some((f) => f.id === id);
    const live = (await liveFolders()).filter((f) => f.id !== id);
    const next: DocumentFolderRow = {
      ...snapshot,
      id,
      ...(snapshot.deletedAt !== null ? {} : placeFor(snapshot, live)),
      updatedAt: nowIso(),
    };
    // Its live documents move with it; a path over budget is shortened, never refused (§ 3.8).
    const { folders } = await changeTree(
      { folders: [{ next, insert: !exists, op: "revert" }] },
      lenient,
    );
    return folders.get(id);
  },
};

/**
 * Where a folder coming back to life goes, so a restore never refuses: under its old parent if
 * that is live, else under its tax year's root, else at the top; and under its old name, or
 * "Name (2)" (the next free number) when a live sibling has it, matched without case.
 */
const placeFor = (
  folder: Pick<DocumentFolderRow, "name" | "parentId" | "taxYear">,
  live: readonly DocumentFolderRow[],
): { parentId: string | null; name: string } => {
  let parentId = folder.parentId ?? null;
  if (parentId !== null && !live.some((f) => f.id === parentId)) {
    const root = live.find(
      (f) =>
        f.defaultKey === YEAR_ROOT_KEY && folder.taxYear !== null && f.taxYear === folder.taxYear,
    );
    parentId = root?.id ?? null;
  }
  const siblings = live.filter((f) => (f.parentId ?? null) === parentId).map((f) => f.name);
  return { parentId, name: freeFolderName(folder.name, siblings) };
};

const ensuring = new Map<number, Promise<DocumentFolderRow[]>>();

let ensureRaceHook: (() => Promise<void>) | undefined;
/** For tests: run `hook` between ensureYearDefaults' read and its write (another tab's write). */
export const __setEnsureRaceHookForTests = (hook: (() => Promise<void>) | undefined) => {
  ensureRaceHook = hook;
};

/**
 * The unique violation of document_folder_default_key_idx only (another tab made that year's
 * folder), by index name or by its two columns in SQLite's message. Any other error, a unique
 * violation elsewhere included, is not ensureYearDefaults' to absorb (review #84 r3).
 */
export const isDefaultKeyViolation = (err: unknown): boolean => {
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
  return (
    /UNIQUE constraint failed/i.test(text) &&
    (text.includes("document_folder_default_key_idx") ||
      /document_folder\.tax_year,\s*document_folder\.default_key/.test(text))
  );
};

const sameName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" }) === 0;

/**
 * One attempt; when another tab made some of the year's folders between our read and our write,
 * the unique index refuses our whole transaction. Then they are "already made": read again and
 * adopt them. Never surfaces that error.
 */
const ensureYearDefaultsNow = async (taxYear: number): Promise<DocumentFolderRow[]> => {
  try {
    return await ensureYearDefaultsOnce(taxYear);
  } catch (err) {
    if (!isDefaultKeyViolation(err)) throw err;
    return ensureYearDefaultsOnce(taxYear);
  }
};

const ensureYearDefaultsOnce = async (taxYear: number): Promise<DocumentFolderRow[]> => {
  const db = getDb();
  const every = await folderCrud.listIncludingDeleted();
  const keyed = (key: string) => every.find((f) => f.taxYear === taxYear && f.defaultKey === key);
  const at = nowIso();
  const queries: AtomicQuery[] = [];
  const history = (id: string, op: "insert" | "update", before: unknown, after: unknown) =>
    db.insert(historyTable).values({
      id: newId(),
      entity: "document_folder",
      entityId: id,
      op,
      beforeJson: before === undefined ? null : JSON.stringify(before),
      afterJson: JSON.stringify(after),
      at,
    });
  // A live folder of the user's with this name in this place becomes the default; else a new one.
  const claim = (key: string, name: string, parentId: string | null): DocumentFolderRow => {
    const mine = every.find(
      (f) =>
        f.deletedAt === null &&
        f.defaultKey === null &&
        (f.parentId ?? null) === parentId &&
        sameName(f.name, name),
    );
    if (mine) {
      const after = { ...mine, defaultKey: key, taxYear, updatedAt: at };
      queries.push(
        db
          .update(documentFolder)
          .set({ defaultKey: key, taxYear, updatedAt: at })
          .where(eq(documentFolder.id, mine.id)),
        history(mine.id, "update", mine, after),
      );
      return after;
    }
    const row: DocumentFolderRow = {
      id: newId(),
      parentId,
      name,
      taxYear,
      sortOrder: 0,
      defaultKey: key,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    queries.push(db.insert(documentFolder).values(row), history(row.id, "insert", undefined, row));
    return row;
  };

  const existingRoot = keyed(YEAR_ROOT_KEY);
  if (existingRoot?.deletedAt) return [];
  const root = existingRoot ?? claim(YEAR_ROOT_KEY, String(taxYear), null);
  const out: DocumentFolderRow[] = [root];
  for (const name of YEAR_DEFAULT_FOLDERS) {
    const key = YEAR_DEFAULT_FOLDER_KEYS[name];
    const existing = keyed(key);
    if (existing) {
      if (existing.deletedAt === null) out.push(existing);
      continue;
    }
    out.push(claim(key, name, root.id));
  }
  await ensureRaceHook?.();
  await runAtomic(queries);
  return out;
};

// ─── Documents ──────────────────────────────────────────────────────────────

type NamedBlob = Blob & { name: string };

/**
 * Size, type and hash checks. The bytes also go to the by-sha store, which the backup (format 1)
 * reads until PR 5 moves it onto the tree; the vault copy is made by the tree change.
 */
const storeBytes = async (bytes: NamedBlob) => {
  assertVaultWritable();
  if (bytes.size > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError(bytes.name);
  const mime = documentMimeFor(bytes.name, bytes.type);
  if (!mime) throw new DocumentTypeNotAllowedError(bytes.name);
  const sha256 = await sha256Hex(bytes);
  await getVaultStore().put(sha256, bytes);
  return { mime, sha256, sizeBytes: bytes.size };
};

/** The dates of the live records these live links point at, per document. */
const datesOfLinks = async (links: readonly DocumentLinkRow[]) => {
  const out = new Map<string, string[]>();
  for (const l of links) {
    if (l.deletedAt !== null) continue;
    const r = await recordFor(l.recordType, l.recordId);
    if (!r || r.deletedAt !== null) continue;
    out.set(l.documentId, [...(out.get(l.documentId) ?? []), r.date]);
  }
  return out;
};

/** The live records' dates per document (D2: one linked record gives the date prefix). */
export const linkedDates = async (
  documentIds: readonly string[],
): Promise<Map<string, string[]>> => {
  if (documentIds.length === 0) return new Map();
  const links = (await getDb()
    .select()
    .from(documentLink)
    .where(
      and(isNull(documentLink.deletedAt), inArray(documentLink.documentId, [...documentIds])),
    )) as DocumentLinkRow[];
  return datesOfLinks(links);
};

/**
 * A link row change, through the tree: the link and its History commit with the plan that moves
 * the document's file to its new date prefix (D2: "the date follows the link"). A deleted
 * document has no file in the tree, so only the rows change.
 */
const linkChange = async (
  next: DocumentLinkRow,
  op: "insert" | "delete" | "revert",
  prev: DocumentLinkRow | undefined,
): Promise<DocumentLinkRow> => {
  assertVaultWritable();
  const db = getDb();
  const queries: AtomicQuery[] = [
    prev
      ? db.update(documentLink).set(next).where(eq(documentLink.id, next.id))
      : db.insert(documentLink).values(next),
    historyQuery("document_link", next.id, op, prev, next),
  ];
  const doc = await anyDocument(next.documentId);
  if (!doc || doc.deletedAt !== null) {
    await runAtomic(queries);
    return next;
  }
  const others = (await db
    .select()
    .from(documentLink)
    .where(
      and(isNull(documentLink.deletedAt), eq(documentLink.documentId, next.documentId)),
    )) as DocumentLinkRow[];
  const after = [...others.filter((l) => l.id !== next.id), next];
  const dates = (await datesOfLinks(after)).get(doc.id) ?? [];
  await changeTree(
    { documents: [{ next: doc, placeOnly: true, dates, op: "update" }], queries },
    lenient,
  );
  return next;
};

const strict = { strict: true, datesFor: linkedDates };
const lenient = { strict: false, datesFor: linkedDates };

/** A folder rename or move: every file below it moves, through the journal (§ 6). */
const folderUpdate = async (
  folder: DocumentFolderRow,
  patch: Partial<DocumentFolderRow>,
  hooks: RunHooks = {},
): Promise<DocumentFolderRow> => {
  const next = { ...folder, ...patch, updatedAt: nowIso() };
  if (changesNothing(folder, patch)) return folder;
  await changeTree({ folders: [{ next, op: "update" }] }, strict, hooks);
  return next;
};

/** One document write through the tree (§ 6). */
const documentChange = async (change: DocumentChange, options = strict): Promise<DocumentRow> => {
  const { documents } = await changeTree({ documents: [change] }, options);
  return documents.get(change.next.id)!;
};

const anyDocument = async (id: string): Promise<DocumentRow | undefined> =>
  ((await getDb().select().from(document).where(eq(document.id, id)).limit(1)) as DocumentRow[])[0];

const requireDocument = async (id: string): Promise<DocumentRow> => {
  const d = await documentCrud.get(id);
  if (!d) throw new DocumentNotFoundError();
  return d;
};

/** A document's field changes through the tree. A no-op save writes nothing (no History row). */
const documentUpdate = async (doc: DocumentRow, patch: Partial<DocumentRow>) => {
  if (changesNothing(doc, patch)) return doc;
  return documentChange({ next: { ...doc, ...patch, updatedAt: nowIso() }, op: "update" });
};

/**
 * Bytes by sha (ADR § 11.8): the live file at `path` when it holds them, else old bytes in
 * _fiscode/ (resolveOldBytes), else the pre-migration blob store (kept one release, D9).
 */
const readSha = async (sha256: string, path?: string | null): Promise<Blob | undefined> => {
  const store = getVaultStore();
  if (path) {
    const live = await store.read(path);
    if (live && (await sha256Hex(live)) === sha256) return live;
  }
  return (await store.resolveOldBytes(sha256))?.bytes ?? (await store.get(sha256));
};

export const documentRepo = {
  ...documentCrud,

  /** A row without its file would break the tree: add documents with `upload`. */
  async create(): Promise<never> {
    throw new Error("documentRepo.create: use upload, which writes the file through the vault");
  },

  /** Store a file and add a document row. Throws DocumentTooLargeError, DocumentTypeNotAllowedError, StorageQuotaError. */
  async upload(bytes: NamedBlob, options: { folderId?: string | null } = {}): Promise<DocumentRow> {
    const folderId = options.folderId ?? null;
    if (folderId !== null) await requireFolder(folderId);
    const stored = await storeBytes(bytes);
    const at = nowIso();
    return documentChange({
      next: {
        id: newId(),
        folderId,
        name: bytes.name,
        ...stored,
        addedAt: at,
        notes: null,
        vaultPath: null,
        deletedAt: null,
        createdAt: at,
        updatedAt: at,
      },
      insert: true,
      bytes,
      op: "insert",
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

  /**
   * Where a document would be in the vault if saved now (an upload when `id` is absent), by the
   * same rules as the save: read-only. `fits` false means the save would refuse it.
   */
  async previewPath(input: {
    id?: string;
    folderId: string | null;
    name: string;
  }): Promise<PathPreview> {
    // As the save: a rename validates the name; an upload keeps the file's own name.
    const name = input.id ? validDocumentName(input.name) : input.name;
    const at = nowIso();
    if (input.id) {
      const doc = await requireDocument(input.id);
      return previewDocumentPath(
        { ...doc, folderId: input.folderId, name, updatedAt: at },
        false,
        linkedDates,
      );
    }
    const next: DocumentRow = {
      id: newId(),
      folderId: input.folderId,
      name,
      mime: documentMimeFor(input.name, "") ?? "application/octet-stream",
      sizeBytes: 0,
      sha256: "",
      addedAt: at,
      notes: null,
      vaultPath: null,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    return previewDocumentPath(next, true, linkedDates);
  },

  /** Throws DocumentNameInvalidError for an empty, over-long or "/" name (as folders). */
  async rename(id: string, name: string): Promise<DocumentRow> {
    return documentUpdate(await requireDocument(id), { name: validDocumentName(name) });
  },

  async move(id: string, folderId: string | null): Promise<DocumentRow> {
    const doc = await requireDocument(id);
    if (folderId !== null) await requireFolder(folderId);
    return documentUpdate(doc, { folderId });
  },

  /** New bytes for a document: a new version. The old bytes are kept in _fiscode/versions/. */
  async replaceBytes(id: string, bytes: NamedBlob): Promise<DocumentRow> {
    const doc = await requireDocument(id);
    const stored = await storeBytes(bytes);
    if (stored.sha256 === doc.sha256) return doc;
    return documentChange({
      next: { ...doc, ...stored, updatedAt: nowIso() },
      bytes,
      op: "update",
    });
  },

  /** Notes and other fields that don't move a file still go through here, so nothing is row-only. */
  async update(id: string, patch: Partial<DocumentInsert>): Promise<DocumentRow | undefined> {
    const doc = await documentCrud.get(id);
    if (!doc) return undefined;
    const { vaultPath: _ignored, ...rest } = patch;
    return documentUpdate(doc, rest as Partial<DocumentRow>);
  },

  /** Moves its file to _fiscode/trash/ (the copy rule), then marks the row deleted. */
  async softDelete(id: string): Promise<boolean> {
    const doc = await anyDocument(id);
    if (!doc) return false;
    const at = nowIso();
    await documentChange({ next: { ...doc, deletedAt: at, updatedAt: at }, op: "delete" }, lenient);
    return true;
  },

  /**
   * History revert and Trash restore. Never refuses (§ 3.8). Its file follows: back from
   * _fiscode/ (resolveOldBytes) when it comes back or gets older bytes, moved when the name or
   * folder changes, to trash/ when the snapshot is deleted. The snapshot's vault_path is ignored:
   * the place is worked out from the tree as it is now.
   */
  async revertTo(
    id: string,
    snapshot: Omit<DocumentRow, "vaultPath"> & { vaultPath?: string | null },
  ): Promise<DocumentRow | undefined> {
    const prev = await anyDocument(id);
    const folderLive =
      snapshot.folderId === null || (await folderCrud.get(snapshot.folderId)) !== undefined;
    return documentChange(
      {
        next: {
          ...snapshot,
          id,
          // A snapshot from before the column existed has no vaultPath.
          vaultPath: prev?.vaultPath ?? null,
          folderId: folderLive ? snapshot.folderId : null,
          updatedAt: nowIso(),
        },
        insert: !prev,
        op: "revert",
      },
      lenient,
    );
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
    const blob = await readSha(d.sha256, d.vaultPath);
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
        available: (await readSha(after.sha256)) !== undefined,
      });
    }
    return out;
  },
};

// ─── Links ──────────────────────────────────────────────────────────────────

export type LinkedRecord = {
  recordType: string;
  id: string;
  /** ISO date, or "" for a record without one (client, profile, an undated vehicle). */
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
  if (recordType === "home_office") {
    const [r] = await db.select().from(homeOffice).where(eq(homeOffice.id, id)).limit(1);
    if (!r) return undefined;
    const size = r.officeSqft ? ` · ${r.officeSqft} sq ft` : "";
    return {
      recordType,
      id,
      date: r.startDate,
      label: `${r.startDate} · Home office · ${labelFor(HOME_OFFICE_METHOD_LABELS, r.method)}${size}`,
      deletedAt: r.deletedAt,
    };
  }
  if (recordType === "vehicle") {
    const [r] = await db.select().from(vehicle).where(eq(vehicle.id, id)).limit(1);
    if (!r) return undefined;
    const name = [r.year, r.make, r.model].filter((x) => x != null && x !== "").join(" ");
    const date = r.inServiceDate ?? "";
    return {
      recordType,
      id,
      date,
      label: date ? `${date} · ${name}` : name,
      deletedAt: r.deletedAt,
    };
  }
  if (recordType === "client") {
    const [r] = await db.select().from(client).where(eq(client.id, id)).limit(1);
    if (!r) return undefined;
    return { recordType, id, date: "", label: r.name, deletedAt: r.deletedAt };
  }
  if (recordType === "profile") {
    const [r] = await db.select().from(profile).where(eq(profile.id, id)).limit(1);
    if (!r) return undefined;
    return {
      recordType,
      id,
      date: "",
      label: `Tax profile · ${labelFor(FILING_STATUS_LABELS, r.filingStatus)} · ${r.state}`,
      deletedAt: null,
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
    const at = nowIso();
    const row: DocumentLinkRow = {
      id: newId(),
      documentId,
      recordType,
      recordId,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    return linkChange(row, "insert", undefined);
  },

  /** Unlink: a soft delete (undo with revertTo). The file's date prefix follows (D2). */
  async unlink(linkId: string): Promise<boolean> {
    const link = await linkCrud.get(linkId);
    if (!link) return false;
    const at = nowIso();
    await linkChange({ ...link, deletedAt: at, updatedAt: at }, "delete", link);
    return true;
  },

  async softDelete(linkId: string): Promise<boolean> {
    return documentLinkRepo.unlink(linkId);
  },

  /** History revert or undo of a link. The file's date prefix follows (D2). */
  async revertTo(id: string, snapshot: DocumentLinkRow): Promise<DocumentLinkRow | undefined> {
    const [prev] = (await getDb()
      .select()
      .from(documentLink)
      .where(eq(documentLink.id, id))
      .limit(1)) as DocumentLinkRow[];
    return linkChange({ ...snapshot, id, updatedAt: nowIso() }, "revert", prev);
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

  /**
   * Live link counts per live document, for the document list. One query. A link counts only when
   * its record is live too, as in `forDocument`. Documents with none are absent.
   */
  async countsByDocument(): Promise<Map<string, number>> {
    const db = getDb();
    const rows = await db
      .select({ id: documentLink.documentId, n: sql<number>`count(*)` })
      .from(documentLink)
      .innerJoin(document, eq(document.id, documentLink.documentId))
      .leftJoin(
        expense,
        and(eq(documentLink.recordType, "expense"), eq(expense.id, documentLink.recordId)),
      )
      .leftJoin(
        income,
        and(eq(documentLink.recordType, "income"), eq(income.id, documentLink.recordId)),
      )
      .leftJoin(
        mileage,
        and(eq(documentLink.recordType, "mileage"), eq(mileage.id, documentLink.recordId)),
      )
      .leftJoin(
        homeOffice,
        and(eq(documentLink.recordType, "home_office"), eq(homeOffice.id, documentLink.recordId)),
      )
      .leftJoin(
        vehicle,
        and(eq(documentLink.recordType, "vehicle"), eq(vehicle.id, documentLink.recordId)),
      )
      .leftJoin(
        client,
        and(eq(documentLink.recordType, "client"), eq(client.id, documentLink.recordId)),
      )
      .leftJoin(
        profile,
        and(eq(documentLink.recordType, "profile"), eq(profile.id, documentLink.recordId)),
      )
      .where(
        and(
          isNull(documentLink.deletedAt),
          isNull(document.deletedAt),
          or(
            and(isNotNull(expense.id), isNull(expense.deletedAt)),
            and(isNotNull(income.id), isNull(income.deletedAt)),
            and(isNotNull(mileage.id), isNull(mileage.deletedAt)),
            and(isNotNull(homeOffice.id), isNull(homeOffice.deletedAt)),
            and(isNotNull(vehicle.id), isNull(vehicle.deletedAt)),
            and(isNotNull(client.id), isNull(client.deletedAt)),
            // The profile has no soft delete: a row there is live.
            isNotNull(profile.id),
          ),
        ),
      )
      .groupBy(documentLink.documentId);
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  },
};
