import type { Bundle } from "./bundle-types.ts";
import { emptyBundle } from "./bundle-types.ts";
import { TABLE_RECORD_TYPES } from "./form-ranges.ts";
import { rowLineKey } from "./import.ts";

/**
 * `restore` replaces everything with the file. `append` keeps what is here and
 * adds the file's rows that are not here yet. `update` is `append` that also
 * takes the file's values for rows already here (an accountant's amended file).
 */
export type ImportMode = "restore" | "append" | "update";

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
 * - `restore`: `next = incoming`. Wholesale replace.
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
  /** From `parseCsv`: the columns each row's header had. Update rows takes only those. */
  file: { columns?: Map<string, Set<string>> } = {},
): AppliedImport => {
  if (mode === "restore") {
    return { next: { ...incoming }, conflicts: [], replaced: existing };
  }
  if (mode === "update") {
    return {
      next: updateBundle(existing, incoming, file.columns),
      conflicts: [],
      replaced: existing,
    };
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
    w2Jobs: mergeRows("w2_job", existing.w2Jobs, incoming.w2Jobs, conflicts),
    estimatedPayments: mergeRows(
      "estimated_payment",
      existing.estimatedPayments,
      incoming.estimatedPayments,
      conflicts,
    ),
    documentFolders: mergeRows(
      "document_folder",
      existing.documentFolders,
      incoming.documentFolders,
      conflicts,
    ),
    documents: mergeRows("document", existing.documents, incoming.documents, conflicts),
    documentLinks: mergeRows(
      "document_link",
      existing.documentLinks,
      incoming.documentLinks,
      conflicts,
    ),
    // History is append-only: entries the file brings are added, and an entry
    // both sides already hold is the same entry, not a conflict to report.
    history: mergeRows("history", existing.history, incoming.history, []),
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

const DATA_TABLES = [
  "entities",
  "spouses",
  "clients",
  "income",
  "timeEntries",
  "vehicles",
  "mileage",
  "homeOffice",
  "expenses",
  "retirementContributions",
  "w2Jobs",
  "estimatedPayments",
  "documentFolders",
  "documents",
  "documentLinks",
] as const satisfies readonly (keyof Bundle)[];

/**
 * Whether `update` takes the file's row for a row already here. Only when both are live:
 * Update rows never removes a row, so a row the file marks deleted stays live here, and it
 * never brings one back, so a row deleted here stays deleted.
 */
export const updateTakesFileRow = (
  here: { deletedAt: string | null },
  file: { deletedAt: string | null },
): boolean => here.deletedAt === null && file.deletedAt === null;

/**
 * `update`: rows whose id is here take the file's values (see `updateTakesFileRow`), rows
 * with new ids are added, rows the file lacks are kept, and nothing is removed. The file's
 * profile replaces this one when the file has one. History is appended as in `append`.
 */
const updateBundle = (
  existing: Bundle,
  incoming: Bundle,
  columns: Map<string, Set<string>> | undefined,
): Bundle => {
  const next: Bundle = {
    ...emptyBundle(),
    profile:
      incoming.profile && existing.profile
        ? withFileFields(
            existing.profile,
            incoming.profile,
            fieldsOf(columns, "profile", incoming.profile.id),
          )
        : (incoming.profile ?? existing.profile),
    history: mergeRows("history", existing.history, incoming.history, []),
  };
  type Row = { id: string; deletedAt: string | null };
  // Every data table holds rows with an id and deletedAt; the merge never looks further.
  const rowsOf = (b: Bundle, table: (typeof DATA_TABLES)[number]) => b[table] as readonly Row[];
  for (const table of DATA_TABLES) {
    (next as Record<string, unknown>)[table] = updateRows(
      rowsOf(existing, table),
      rowsOf(incoming, table),
      (id) => fieldsOf(columns, TABLE_RECORD_TYPES[table], id),
    );
  }
  return next;
};

const updateRows = <T extends { id: string; deletedAt: string | null }>(
  existingRows: readonly T[],
  incomingRows: readonly T[],
  fieldsFor: (id: string) => Set<string> | undefined,
): T[] => {
  const fromFile = new Map(incomingRows.map((r) => [r.id, r]));
  const here = new Set(existingRows.map((r) => r.id));
  const kept = existingRows.map((row) => {
    const file = fromFile.get(row.id);
    return file && updateTakesFileRow(row, file)
      ? withFileFields(row, file, fieldsFor(row.id))
      : row;
  });
  return [...kept, ...incomingRows.filter((r) => !here.has(r.id))];
};

// A column whose bundle field is not its camelCased name.
const FIELD_FOR_COLUMN: Record<string, string> = {
  default_commission_rate_basis_points: "defaultCommissionRate",
};

const camel = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * The bundle fields one row's header carried, or undefined when unknown (a bundle not read from
 * a file: every field counts).
 */
export const fieldsOf = (
  columns: Map<string, Set<string>> | undefined,
  recordType: string,
  id: string,
): Set<string> | undefined => {
  if (!columns) return undefined;
  const keys = columns.get(rowLineKey(recordType, id)) ?? new Set<string>();
  return new Set([...keys].map((k) => FIELD_FOR_COLUMN[k] ?? camel(k)));
};

/**
 * Update rows: the row here with the file's value for each field the file's format has. A file
 * in an older format lacks newer columns; their values here stay (review #78 r1).
 */
export const withFileFields = <T extends object>(
  here: T,
  file: T,
  fields: Set<string> | undefined,
): T => {
  if (!fields) return file;
  const out: Record<string, unknown> = { ...(here as Record<string, unknown>) };
  for (const [k, v] of Object.entries(file)) if (fields.has(k)) out[k] = v;
  return out as T;
};
