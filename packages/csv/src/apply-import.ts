import type { Bundle } from "./bundle-types.ts";
import { emptyBundle } from "./bundle-types.ts";

export type ImportMode = "overwrite" | "append" | "restore";

export type ImportConflict = {
  table: string;
  id: string;
};

export type AppliedImport = {
  next: Bundle;
  conflicts: ImportConflict[];
  replaced: Bundle;
};

/**
 * Pure merge logic for CSV import. Takes the current in-memory bundle plus
 * the incoming bundle from a CSV, returns what the DB should look like after
 * applying the import (plus conflicts the caller can surface).
 *
 * - `overwrite` / `restore`: `next = incoming`. Wholesale replace.
 *   `replaced` captures `existing` for the caller to put into history.
 * - `append`: keep existing rows; add only non-colliding incoming rows.
 *   Colliding ids go into `conflicts` (existing-wins).
 *   Profile is treated as a singleton: keep existing if present, else use
 *   incoming.
 */
export const applyImport = (
  existing: Bundle,
  incoming: Bundle,
  mode: ImportMode,
): AppliedImport => {
  if (mode === "overwrite" || mode === "restore") {
    return { next: { ...incoming }, conflicts: [], replaced: existing };
  }
  const conflicts: ImportConflict[] = [];
  const next: Bundle = {
    ...emptyBundle(),
    profile: existing.profile ?? incoming.profile,
    entities: mergeRows("entity", existing.entities, incoming.entities, conflicts),
    spouses: mergeRows("spouse", existing.spouses, incoming.spouses, conflicts),
    clients: mergeRows("client", existing.clients, incoming.clients, conflicts),
    income: mergeRows("income", existing.income, incoming.income, conflicts),
    timeEntries: mergeRows("time_entry", existing.timeEntries, incoming.timeEntries, conflicts),
    vehicles: mergeRows("vehicle", existing.vehicles, incoming.vehicles, conflicts),
    mileage: mergeRows("mileage", existing.mileage, incoming.mileage, conflicts),
    homeOffice: mergeRows("home_office", existing.homeOffice, incoming.homeOffice, conflicts),
    expenses: mergeRows("expense", existing.expenses, incoming.expenses, conflicts),
    retirementContributions: mergeRows(
      "retirement_contribution",
      existing.retirementContributions,
      incoming.retirementContributions,
      conflicts,
    ),
  };
  return { next, conflicts, replaced: existing };
};

const mergeRows = <T extends { id: string }>(
  tableLabel: string,
  existingRows: T[],
  incomingRows: T[],
  conflicts: ImportConflict[],
): T[] => {
  const existingIds = new Set(existingRows.map((r) => r.id));
  const merged: T[] = [...existingRows];
  for (const row of incomingRows) {
    if (existingIds.has(row.id)) {
      conflicts.push({ table: tableLabel, id: row.id });
    } else {
      merged.push(row);
    }
  }
  return merged;
};
