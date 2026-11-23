import { folderPathFits, titleHasDate, VaultPathTooLongError } from "@fiscode/core";
import { eq } from "drizzle-orm";
import { getDb, type AtomicQuery } from "../client.ts";
import {
  document,
  documentFolder,
  type DocumentFolderRow,
  type DocumentRow,
} from "../schema/index.ts";
import {
  byAdded,
  extForMime,
  withoutSuffix,
  documentVaultPath,
  fitFolders,
  type ShortenedFolder,
  folderDir,
  folderSegments,
  pathContext,
  pathTaken,
  type PathContext,
} from "../vault/paths.ts";
import { isVaultMigrated, placeUnplacedDocuments } from "../vault/migrate.ts";
import { historyQuery, runTreeChange, type PlanBuilder } from "../vault/tree.ts";
import type { RunHooks } from "../vault/journal.ts";

export type { ShortenedFolder };
export type { RunHooks, TreeProgress } from "../vault/journal.ts";

// The one engine behind every document and folder write that moves files (ADR 0001 § 6): it
// applies the row changes in memory, works out every affected document's new path, plans the file
// ops, and commits the rows with the plan. Paths are recomputed for every file a folder change
// relocates: a folder that fits doesn't mean every long title below it does.

type HistoryOp = "insert" | "update" | "delete" | "revert";

/** A document write: the row as it should be (vault_path is worked out here), and its bytes. */
export type DocumentChange = {
  next: DocumentRow;
  /** A new row (upload) rather than an update. */
  insert?: boolean;
  /** New bytes (upload, replace), already validated. */
  bytes?: Blob;
  /**
   * The document's linked-record dates after this change, when its links change (link, unlink,
   * a link's revert). Only then is the D2 date prefix worked out again; every other change keeps
   * the date the file has, so an unrelated write never re-dates it.
   */
  dates?: readonly string[];
  /** Only the place changes (a link changed): no document row edit and no History row for it. */
  placeOnly?: boolean;
  op: HistoryOp;
};

export type FolderChange = { next: DocumentFolderRow; insert?: boolean; op: HistoryOp };

export type TreeChangeOptions = {
  /** User actions refuse an over-budget path (VaultPathTooLongError); restore and revert never do. */
  strict: boolean;
  /** The date(s) of each document's live linked records, for the date prefix (D2). */
  datesFor: (documentIds: readonly string[]) => Promise<Map<string, string[]>>;
};

export type TreeChangeResult = {
  documents: Map<string, DocumentRow>;
  folders: Map<string, DocumentFolderRow>;
  shortened: ShortenedFolder[];
};

/** History's copy of a document row: without `vaultPath`, which is this device's (ADR § 8). */
const forHistory = (row: DocumentRow | undefined) => {
  if (!row) return undefined;
  const { vaultPath: _devicePath, ...rest } = row;
  return rest;
};

/** Every live folder at or below the given ones. */
const subtrees = (ids: Iterable<string>, live: readonly DocumentFolderRow[]) => {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of live) {
      if (f.parentId !== null && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
};

/** The "YYYY-MM-DD" a placed file's name starts with, or undefined. */
const keptDate = (path: string | null): string | undefined =>
  path?.slice(path.lastIndexOf("/") + 1).match(/^(\d{4}-\d{2}-\d{2}) /)?.[1];

/** A document's place, keeping its " (n)" when its name is otherwise unchanged (§ 4: no renumbering). */
const placeDocument = (
  doc: DocumentRow,
  ctx: PathContext,
  dates: readonly string[],
  taken: readonly string[],
) => {
  const want = documentVaultPath(doc, ctx, dates, taken);
  const cur = doc.vaultPath;
  // Kept only when the paths differ by nothing but the " (n)": a case- or accent-only rename is
  // a real change and moves the file (sameName is for collisions, not for "unchanged").
  if (
    cur &&
    cur !== want.path &&
    withoutSuffix(cur).normalize("NFC") === withoutSuffix(want.path).normalize("NFC") &&
    !pathTaken(cur, taken)
  ) {
    return { ...want, path: cur };
  }
  return want;
};

/**
 * The planning half of a tree change, shared by `changeTree` and the previews: the folders as they
 * will be (shortened when not strict), the path context, the folders that relocate, the documents
 * to place in upload order with their dates, and the paths already taken.
 */
const layoutTree = async (
  folderRows: readonly DocumentFolderRow[],
  docRows: readonly DocumentRow[],
  changes: { folders?: FolderChange[]; documents?: DocumentChange[] },
  options: TreeChangeOptions,
) => {
  const folders = new Map(folderRows.map((f) => [f.id, f]));
  for (const c of changes.folders ?? []) folders.set(c.next.id, c.next);
  const docsBefore = new Map(docRows.map((d) => [d.id, d]));
  const docChanges = new Map((changes.documents ?? []).map((c) => [c.next.id, c]));

  const changedFolderIds = (changes.folders ?? []).map((c) => c.next.id);
  const affectedFolders = subtrees(
    changedFolderIds.filter((id) => folders.get(id)!.deletedAt === null),
    [...folders.values()].filter((f) => f.deletedAt === null),
  );
  // Deleted folders take their documents with them only when the caller says so (softDeleteTree
  // passes those documents as changes), so only live subtrees relocate here.
  const shortened = options.strict ? [] : fitFolders(folders, affectedFolders);
  const live = [...folders.values()].filter((f) => f.deletedAt === null);
  const ctx = pathContext(live);
  const dirOf = (id: string) => folderDir(folderSegments(id, ctx.folders, ctx.disk) ?? null);

  // Documents to place: the changed ones, and every live one in a relocated folder.
  const affected = new Set(docChanges.keys());
  for (const d of docRows) {
    if (d.deletedAt === null && d.folderId !== null && affectedFolders.has(d.folderId)) {
      affected.add(d.id);
    }
  }
  const dates = await options.datesFor([...affected]);

  // Taken: every folder's directory, and every live document not being placed.
  const taken: string[] = live.map((f) => dirOf(f.id));
  for (const d of docRows) {
    if (d.deletedAt === null && d.vaultPath && !affected.has(d.id)) taken.push(d.vaultPath);
  }
  const order = [...affected]
    .map((id) => docChanges.get(id)?.next ?? docsBefore.get(id)!)
    .toSorted(byAdded);
  return {
    folders,
    before: new Map(folderRows.map((f) => [f.id, f])),
    docsBefore,
    docChanges,
    affectedFolders,
    shortened,
    ctx,
    dirOf,
    dates,
    taken,
    order,
  };
};

/** Where a live document goes: the D2 date prefix changes only with its links, else it keeps its own. */
const targetFor = (
  prev: DocumentRow | undefined,
  next: DocumentRow,
  change: DocumentChange | undefined,
  ctx: PathContext,
  dates: readonly string[],
  taken: readonly string[],
) => {
  // A file named after a dated title has no prefix of its own to keep.
  const kept =
    prev && !titleHasDate(prev.name, extForMime(prev.mime)) ? keptDate(prev.vaultPath) : undefined;
  const useDates = change?.dates ?? (kept ? [kept] : dates);
  // Place it as if at its old path, so an unchanged name keeps its suffix.
  return placeDocument({ ...next, vaultPath: prev?.vaultPath ?? null }, ctx, useDates, taken);
};

export type PathPreview = { path: string; fits: boolean; overBy: number };

const currentRows = async () => {
  const db = getDb();
  return {
    folderRows: (await db.select().from(documentFolder)) as DocumentFolderRow[],
    docRows: (await db.select().from(document)) as DocumentRow[],
  };
};

/**
 * Where a document would go if saved now, by the rules a strict `changeTree` uses, without writing
 * anything. Before the migration is done, unplaced documents aren't counted as taken (they have no
 * place yet); the save places them first, so a rare preview can miss one " (n)".
 */
export const previewDocumentPath = async (
  next: DocumentRow,
  insert: boolean,
  datesFor: TreeChangeOptions["datesFor"],
): Promise<PathPreview> => {
  const { folderRows, docRows } = await currentRows();
  const change: DocumentChange = { next, insert, op: insert ? "insert" : "update" };
  const plan = await layoutTree(
    folderRows,
    docRows,
    { documents: [change] },
    {
      strict: true,
      datesFor,
    },
  );
  const prev = plan.docsBefore.get(next.id);
  const placed = targetFor(prev, next, change, plan.ctx, plan.dates.get(next.id) ?? [], plan.taken);
  return { path: placed.path, fits: placed.fits, overBy: placed.overBy };
};

/**
 * A folder's directory if saved now, as `previewDocumentPath`. It fits only when the directory and
 * every file it would relocate fit; `overBy` is the most any of them is over.
 */
export const previewFolderPath = async (
  next: DocumentFolderRow,
  insert: boolean,
  datesFor: TreeChangeOptions["datesFor"],
): Promise<PathPreview> => {
  const { folderRows, docRows } = await currentRows();
  const plan = await layoutTree(
    folderRows,
    docRows,
    { folders: [{ next, insert, op: insert ? "insert" : "update" }] },
    { strict: true, datesFor },
  );
  const path = plan.dirOf(next.id);
  let { overBy } = folderPathFits(path);
  for (const id of plan.affectedFolders)
    overBy = Math.max(overBy, folderPathFits(plan.dirOf(id)).overBy);
  const taken = [...plan.taken];
  for (const doc of plan.order) {
    const placed = targetFor(doc, doc, undefined, plan.ctx, plan.dates.get(doc.id) ?? [], taken);
    taken.push(placed.path);
    // A name that can't fit even at its shortest title can be under the path length (overBy 0).
    overBy = Math.max(overBy, placed.overBy, placed.fits ? 0 : 1);
  }
  return { path, fits: overBy === 0, overBy };
};

/**
 * Apply folder and document changes as one tree change: the rows and their history in one
 * transaction with the plan, every affected file moved, copied or removed by the journal.
 * `hooks` reports progress and takes a cancel, honoured until the commit (§ 11.3).
 */
export const changeTree = (
  changes: {
    folders?: FolderChange[];
    documents?: DocumentChange[];
    /** Other rows that commit with the plan (a link row and its History). */
    queries?: AtomicQuery[];
  },
  options: TreeChangeOptions,
  hooks: RunHooks = {},
): Promise<TreeChangeResult> =>
  runTreeChange(async (plan) => {
    const db = getDb();
    // The backstop (§ 10 step 5): rows without a place (e.g. after an import) get one first, so
    // this change sees the tree as it should be. Only once the migration is done: before that,
    // only the migration job places documents (it reports and verifies what it does).
    if (await isVaultMigrated()) {
      await placeUnplacedDocuments(plan.store, options.datesFor, { oldBytes: false });
    }
    const { folderRows, docRows } = await currentRows();
    const {
      folders,
      before,
      docsBefore,
      docChanges,
      affectedFolders,
      shortened,
      ctx,
      dirOf,
      dates,
      taken,
      order,
    } = await layoutTree(folderRows, docRows, changes, options);

    if (options.strict) {
      for (const id of affectedFolders) {
        const dir = dirOf(id);
        if (!folderPathFits(dir).fits) throw new VaultPathTooLongError(dir);
      }
    }

    const queries: AtomicQuery[] = [...(changes.queries ?? [])];
    const docsOut = new Map<string, DocumentRow>();
    for (const next of order) {
      const change = docChanges.get(next.id);
      const prev = docsBefore.get(next.id);
      const placed = await placeOne(
        plan,
        prev,
        next,
        change,
        ctx,
        dates.get(next.id) ?? [],
        taken,
        options,
      );
      if (placed.taken) taken.push(placed.taken);
      docsOut.set(next.id, placed.row);
      if (change?.insert && !change.placeOnly) {
        queries.push(db.insert(document).values(placed.row));
        queries.push(
          historyQuery("document", next.id, change.op, undefined, forHistory(placed.row)),
        );
      } else if (change && !change.placeOnly) {
        queries.push(db.update(document).set(placed.row).where(eq(document.id, next.id)));
        queries.push(
          historyQuery("document", next.id, change.op, forHistory(prev), forHistory(placed.row)),
        );
      } else if (placed.row.vaultPath !== prev?.vaultPath) {
        // Only the place changed (its folder moved): no History row, the user didn't edit it.
        queries.push(
          db
            .update(document)
            .set({ vaultPath: placed.row.vaultPath })
            .where(eq(document.id, next.id)),
        );
      }
    }

    const foldersOut = new Map<string, DocumentFolderRow>();
    const shortenedIds = new Set(shortened.map((s) => s.folderId));
    const folderChanges = new Map((changes.folders ?? []).map((c) => [c.next.id, c]));
    for (const id of new Set([...folderChanges.keys(), ...shortenedIds])) {
      const row = folders.get(id)!;
      const prev = before.get(id);
      const c = folderChanges.get(id);
      foldersOut.set(id, row);
      if (c?.insert) {
        queries.push(db.insert(documentFolder).values(row));
        queries.push(historyQuery("document_folder", id, c.op, undefined, row));
      } else {
        queries.push(db.update(documentFolder).set(row).where(eq(documentFolder.id, id)));
        queries.push(historyQuery("document_folder", id, c?.op ?? "update", prev, row));
      }
    }
    return { queries, result: { documents: docsOut, folders: foldersOut, shortened } };
  }, hooks);

const placeOne = async (
  plan: PlanBuilder,
  prev: DocumentRow | undefined,
  next: DocumentRow,
  change: DocumentChange | undefined,
  ctx: PathContext,
  dates: readonly string[],
  taken: readonly string[],
  options: TreeChangeOptions,
): Promise<{ row: DocumentRow; taken?: string }> => {
  const cur = {
    path: prev ? await plan.heldPath(prev) : null,
    sha256: prev?.sha256 ?? next.sha256,
  };
  if (next.deletedAt !== null) {
    const kept = await plan.document(cur, { live: false, path: "", sha256: next.sha256 });
    return { row: { ...next, vaultPath: kept ?? prev?.vaultPath ?? null } };
  }
  const placed = targetFor(prev, next, change, ctx, dates, taken);
  if (!placed.fits) {
    // A user action refuses (§ 3.8), including a file its folder change would push over budget.
    if (options.strict) throw new VaultPathTooLongError(placed.path);
    // Restore and revert never refuse: the item stays where it is when it has a place.
    if (cur.path && cur.sha256 === next.sha256) {
      return { row: { ...next, vaultPath: cur.path }, taken: cur.path };
    }
  }
  const source = change?.bytes ? await plan.stage(change.bytes) : undefined;
  const vaultPath = await plan.document(cur, {
    live: true,
    path: placed.path,
    sha256: next.sha256,
    ...(source ? { source } : {}),
  });
  return { row: { ...next, vaultPath }, taken: placed.path };
};
