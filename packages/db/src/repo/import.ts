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
  }

  await insertAllRows(bundle);
};

const insertAllRows = async (bundle: Bundle): Promise<void> => {
  const db = getDb();
  if (bundle.profile) {
    await db.insert(profile).values(bundle.profile);
  }
  for (const row of bundle.entities) await db.insert(entity).values(row);
  for (const row of bundle.spouses) await db.insert(spouse).values(row);
  for (const row of bundle.clients) await db.insert(client).values(row);
  for (const row of bundle.income) await db.insert(income).values(row);
  for (const row of bundle.timeEntries) await db.insert(timeEntry).values(row);
  for (const row of bundle.vehicles) await db.insert(vehicle).values(row);
  for (const row of bundle.mileage) await db.insert(mileage).values(row);
  for (const row of bundle.homeOffice) await db.insert(homeOffice).values(row);
  for (const row of bundle.expenses) await db.insert(expense).values(row);
  for (const row of bundle.retirementContributions) {
    await db.insert(retirementContribution).values(row);
  }
};
