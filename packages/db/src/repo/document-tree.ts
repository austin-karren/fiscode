import { folderPathFits, sameName, VaultPathTooLongError } from "@fiscode/core";
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
import { placeUnplacedDocuments } from "../vault/migrate.ts";
import { historyQuery, runTreeChange, type PlanBuilder } from "../vault/tree.ts";

export type { ShortenedFolder };

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

/** A document's place, keeping its " (n)" when its name is otherwise unchanged (§ 4: no renumbering). */
const placeDocument = (
  doc: DocumentRow,
  ctx: PathContext,
  dates: readonly string[],
  taken: readonly string[],
) => {
  const want = documentVaultPath(doc, ctx, dates, taken);
  const cur = doc.vaultPath;
  if (
    cur &&
    cur !== want.path &&
    sameName(withoutSuffix(cur), withoutSuffix(want.path)) &&
    !pathTaken(cur, taken)
  ) {
    return { ...want, path: cur };
  }
  return want;
};

/**
 * Apply folder and document changes as one tree change: the rows and their history in one
 * transaction with the plan, every affected file moved, copied or removed by the journal.
 */
export const changeTree = (
  changes: { folders?: FolderChange[]; documents?: DocumentChange[] },
  options: TreeChangeOptions,
): Promise<TreeChangeResult> =>
  runTreeChange(async (plan) => {
    const db = getDb();
    // The backstop (§ 10 step 5): rows without a place (e.g. after an import) get one first, so
    // this change sees the tree as it should be.
    await placeUnplacedDocuments(plan.store, options.datesFor, { oldBytes: false });
    const folderRows = (await db.select().from(documentFolder)) as DocumentFolderRow[];
    const before = new Map(folderRows.map((f) => [f.id, f]));
    const folders = new Map(before);
    for (const c of changes.folders ?? []) folders.set(c.next.id, c.next);
    const docRows = (await db.select().from(document)) as DocumentRow[];
    const docsBefore = new Map(docRows.map((d) => [d.id, d]));
    const docChanges = new Map((changes.documents ?? []).map((c) => [c.next.id, c]));

    const changedFolderIds = (changes.folders ?? []).map((c) => c.next.id);
    let live = [...folders.values()].filter((f) => f.deletedAt === null);
    const affectedFolders = subtrees(
      changedFolderIds.filter((id) => folders.get(id)!.deletedAt === null),
      live,
    );
    // Deleted folders take their documents with them only when the caller says so (softDeleteTree
    // passes those documents as changes), so only live subtrees relocate here.
    const shortened = options.strict ? [] : fitFolders(folders, affectedFolders);
    live = [...folders.values()].filter((f) => f.deletedAt === null);
    const ctx = pathContext(live);

    if (options.strict) {
      for (const id of affectedFolders) {
        const segments = folderSegments(id, ctx.folders, ctx.disk);
        const dir = folderDir(segments ?? null);
        if (!folderPathFits(dir).fits) throw new VaultPathTooLongError(dir);
      }
    }

    // Documents to place: the changed ones, and every live one in a relocated folder.
    const affected = new Map<string, DocumentChange | undefined>();
    for (const [id, c] of docChanges) affected.set(id, c);
    for (const d of docRows) {
      if (d.deletedAt === null && d.folderId !== null && affectedFolders.has(d.folderId)) {
        if (!affected.has(d.id)) affected.set(d.id, undefined);
      }
    }
    const dates = await options.datesFor([...affected.keys()]);

    // Taken: every folder's directory, and every live document not being placed.
    const taken: string[] = live.map((f) =>
      folderDir(folderSegments(f.id, ctx.folders, ctx.disk) ?? null),
    );
    for (const d of docRows) {
      if (d.deletedAt === null && d.vaultPath && !affected.has(d.id)) taken.push(d.vaultPath);
    }

    const queries: AtomicQuery[] = [];
    const docsOut = new Map<string, DocumentRow>();
    const order = [...affected.keys()]
      .map((id) => docChanges.get(id)?.next ?? docsBefore.get(id)!)
      .toSorted(byAdded);
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
      if (change?.insert) {
        queries.push(db.insert(document).values(placed.row));
        queries.push(
          historyQuery("document", next.id, change.op, undefined, forHistory(placed.row)),
        );
      } else if (change) {
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
  });

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
  // Place it as if at its old path, so an unchanged name keeps its suffix.
  const placed = placeDocument({ ...next, vaultPath: prev?.vaultPath ?? null }, ctx, dates, taken);
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
