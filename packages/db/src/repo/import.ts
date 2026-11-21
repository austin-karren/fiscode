import { newId } from "@fiscode/core";

import type { Bundle } from "../bundle.ts";
import { getDb, runAtomic, type AtomicQuery } from "../client.ts";
import {
  client,
  entity,
  expense,
  history as historyTable,
  homeOffice,
  income,
  mileage,
  profile,
  retirementContribution,
  w2Job,
  estimatedPayment,
  documentFolder,
  document,
  documentLink,
  spouse,
  timeEntry,
  vehicle,
} from "../schema/index.ts";
import { buildBundle } from "./index.ts";

export type ImportReason =
  | "import-restore"
  | "import-append"
  | "import-update"
  | "history-restore"
  | "backup-restore";

/**
 * Apply a Bundle to the DB, all or nothing.
 *
 * - `import-restore`: every data table is emptied and reloaded from the bundle.
 * - `history-restore`: the same as `import-restore`, for a past snapshot put
 *   back from the History screen, so the log can tell it from a file restore.
 * - `backup-restore`: the same as `import-restore`, for a full backup (@fiscode/backup).
 *   `options.backup.createdAt` (the backup's time) is kept in the snapshot's `afterJson`
 *   as `backup`, for History to name the backup.
 * - `import-append`: nothing is removed. The caller (CSV's `applyImport`) has
 *   already resolved id collisions, so rows that are not here yet are inserted.
 * - `import-update`: the bundle is CSV's `applyImport(…, "update")`, which holds
 *   every row here (none removed) with the file's values for matching ids. It is
 *   written like a restore: every data table emptied and reloaded from it, in the
 *   same transaction, so the result is exactly that bundle.
 *
 * Every write runs in one transaction (`runAtomic`). If any of them fails, or
 * the page goes away before the commit, the database is exactly as it was.
 *
 * History is preserved across imports; a snapshot entry records the full
 * pre-import bundle so a future revert UI can restore it. The bundle's own
 * history entries are added to the log.
 */
export const importBundle = async (
  bundle: Bundle,
  reason: ImportReason,
  options: { backup?: { createdAt: string } } = {},
): Promise<void> => {
  const db = getDb();
  // The snapshot holds everything a restore removes, deleted rows too.
  //
  // Limit: these two reads happen before the batch, not inside it, because a
  // batch cannot read and then decide. fiscode is one user in one tab; a
  // write from a second tab between the reads and the batch would be missing
  // from the snapshot (the import itself would still be all or nothing).
  const before = await buildBundle({ includeDeleted: true });
  const hadHistory = (await db.select({ id: historyTable.id }).from(historyTable).limit(1)).length;

  const queries: AtomicQuery[] = [];

  // A database that holds nothing has no prior state to snapshot. Skipping the
  // snapshot there is what makes a restore exact: export -> restore into an
  // empty database -> export gives the same bytes, history included. Any
  // other import adds one snapshot entry, so it can be reverted.
  if (!isEmptyBundle(before) || hadHistory > 0) {
    queries.push(
      db.insert(historyTable).values({
        id: newId(),
        entity: "__import_snapshot",
        entityId: reason,
        op: "revert",
        // Without the logs: see `buildBundle` on why a snapshot never nests history.
        beforeJson: JSON.stringify({ ...before, history: [] }),
        afterJson: JSON.stringify(
          options.backup
            ? { ...bundle, history: [], backup: { createdAt: options.backup.createdAt } }
            : { ...bundle, history: [] },
        ),
        at: new Date().toISOString(),
      }),
    );
  }

  // History is append-only in every mode: entries the file brings are added,
  // entries already here are kept, and the same entry is never doubled.
  for (const row of bundle.history) {
    queries.push(db.insert(historyTable).values(row).onConflictDoNothing());
  }

  if (
    reason === "import-restore" ||
    reason === "history-restore" ||
    reason === "backup-restore" ||
    reason === "import-update"
  ) {
    // Empty every data table. History is intact.
    queries.push(
      db.delete(profile),
      db.delete(entity),
      db.delete(spouse),
      db.delete(client),
      db.delete(income),
      db.delete(timeEntry),
      db.delete(vehicle),
      db.delete(mileage),
      db.delete(homeOffice),
      db.delete(expense),
      db.delete(retirementContribution),
      db.delete(w2Job),
      db.delete(estimatedPayment),
      db.delete(documentFolder),
      db.delete(document),
      db.delete(documentLink),
    );
    queries.push(...insertQueries(bundle, "strict"));
  } else {
    // Append: applyImport returns the FULL merged bundle (existing ∪ new),
    // including rows already in the DB. Re-inserting those would trip the PK
    // UNIQUE constraint, so existing rows are left alone and only new ones land.
    queries.push(...insertQueries(bundle, "ignore-on-conflict"));
  }

  await runAtomic(queries);
};

const isEmptyBundle = (b: Bundle): boolean =>
  b.profile === undefined &&
  [
    b.entities,
    b.spouses,
    b.clients,
    b.income,
    b.timeEntries,
    b.vehicles,
    b.mileage,
    b.homeOffice,
    b.expenses,
    b.retirementContributions,
    b.w2Jobs,
    b.estimatedPayments,
    b.documentFolders,
    b.documents,
    b.documentLinks,
  ].every((rows) => rows.length === 0);

const insertQueries = (
  bundle: Bundle,
  conflictMode: "strict" | "ignore-on-conflict",
): AtomicQuery[] => {
  const db = getDb();
  const ignore = conflictMode === "ignore-on-conflict";
  const queries: AtomicQuery[] = [];
  const add = (q: AtomicQuery & { onConflictDoNothing(): AtomicQuery }) =>
    queries.push(ignore ? q.onConflictDoNothing() : q);
  if (bundle.profile) add(db.insert(profile).values(bundle.profile));
  for (const row of bundle.entities) add(db.insert(entity).values(row));
  for (const row of bundle.spouses) add(db.insert(spouse).values(row));
  for (const row of bundle.clients) add(db.insert(client).values(row));
  for (const row of bundle.income) add(db.insert(income).values(row));
  for (const row of bundle.timeEntries) add(db.insert(timeEntry).values(row));
  for (const row of bundle.vehicles) add(db.insert(vehicle).values(row));
  for (const row of bundle.mileage) add(db.insert(mileage).values(row));
  for (const row of bundle.homeOffice) add(db.insert(homeOffice).values(row));
  for (const row of bundle.expenses) add(db.insert(expense).values(row));
  for (const row of bundle.retirementContributions) {
    add(db.insert(retirementContribution).values(row));
  }
  for (const row of bundle.w2Jobs) add(db.insert(w2Job).values(row));
  for (const row of bundle.estimatedPayments) add(db.insert(estimatedPayment).values(row));
  // Document rows only: the bytes are blobs on this device (blob-store.ts), never in a CSV.
  for (const row of bundle.documentFolders) add(db.insert(documentFolder).values(row));
  for (const row of bundle.documents) add(db.insert(document).values(row));
  for (const row of bundle.documentLinks) add(db.insert(documentLink).values(row));
  return queries;
};
