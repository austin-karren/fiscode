import { newId } from "@fiscode/core";

import type { Bundle } from "../bundle.ts";
import { getDb } from "../client.ts";
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
  spouse,
  timeEntry,
  vehicle,
} from "../schema/index.ts";
import { buildBundle } from "./index.ts";

export type ImportReason = "import-overwrite" | "import-restore" | "import-append";

/**
 * Apply a Bundle to the DB. For `overwrite` / `restore`, the current state is
 * snapshotted into history then every data table is truncated and reloaded.
 * For `append`, no truncation — the caller (CSV's `applyImport`) has already
 * resolved id collisions, so we just insert rows that aren't present.
 *
 * History is preserved across imports; the snapshot row records the full
 * pre-import bundle so a future revert UI can restore it.
 */
export const importBundle = async (bundle: Bundle, reason: ImportReason): Promise<void> => {
  const db = getDb();
  const before = await buildBundle();
  const snapshotId = newId();
  const nowIso = new Date().toISOString();

  await db.insert(historyTable).values({
    id: snapshotId,
    entity: "__import_snapshot",
    entityId: reason,
    op: "revert",
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(bundle),
    at: nowIso,
  });

  if (reason !== "import-append") {
    // Overwrite / restore: purge all data tables. History is intact.
    await db.delete(profile);
    await db.delete(entity);
    await db.delete(spouse);
    await db.delete(client);
    await db.delete(income);
    await db.delete(timeEntry);
    await db.delete(vehicle);
    await db.delete(mileage);
    await db.delete(homeOffice);
    await db.delete(expense);
    await db.delete(retirementContribution);
    await insertAllRows(bundle, "strict");
    return;
  }

  // Append: applyImport returns the FULL merged bundle (existing ∪ new),
  // including rows already in the DB. We can't blindly re-insert those —
  // it would trip the PK UNIQUE constraint. Use INSERT OR IGNORE so existing
  // rows survive untouched and only genuinely new rows land.
  await insertAllRows(bundle, "ignore-on-conflict");
};

const insertAllRows = async (
  bundle: Bundle,
  conflictMode: "strict" | "ignore-on-conflict",
): Promise<void> => {
  const db = getDb();
  const ignore = conflictMode === "ignore-on-conflict";
  if (bundle.profile) {
    const q = db.insert(profile).values(bundle.profile);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.entities) {
    const q = db.insert(entity).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.spouses) {
    const q = db.insert(spouse).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.clients) {
    const q = db.insert(client).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.income) {
    const q = db.insert(income).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.timeEntries) {
    const q = db.insert(timeEntry).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.vehicles) {
    const q = db.insert(vehicle).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.mileage) {
    const q = db.insert(mileage).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.homeOffice) {
    const q = db.insert(homeOffice).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.expenses) {
    const q = db.insert(expense).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
  for (const row of bundle.retirementContributions) {
    const q = db.insert(retirementContribution).values(row);
    await (ignore ? q.onConflictDoNothing() : q);
  }
};
