import { describeEntityPeriod, findEntityOverlap } from "@fiscode/core";
import { fieldsOf, updateTakesFileRow, withFileFields, type ImportMode } from "./apply-import.ts";
import type { Bundle } from "./bundle-types.ts";
import { formRangeProblems, TABLE_RECORD_TYPES } from "./form-ranges.ts";
import { parseCsv, rowLineKey, type ImportError } from "./import.ts";

// What the import screen needs to know before anything is written: whether the
// file can be imported at all, and what each mode would do, in numbers the
// user can check against the app and the file.

/** Rows by what the user sees: live rows show in the app, deleted ones do not. */
export type RowCounts = { live: number; deleted: number; history: number };

const ROW_TABLES = [
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

/** Count a bundle's rows. The profile is one live row. */
export const countRows = (bundle: Bundle): RowCounts => {
  const counts: RowCounts = {
    live: bundle.profile ? 1 : 0,
    deleted: 0,
    history: bundle.history.length,
  };
  for (const table of ROW_TABLES) {
    for (const row of bundle[table]) {
      if (row.deletedAt === null) counts.live++;
      else counts.deleted++;
    }
  }
  return counts;
};

export type ImportFile =
  | {
      ok: true;
      bundle: Bundle;
      /** From the file's first line. Undefined when the line is missing. */
      scope: "full" | "yearly" | undefined;
      year: number | undefined;
      counts: RowCounts;
      /** The spreadsheet row of each row (see `ImportResult.rowLines`). */
      rowLines: Map<string, number>;
      /** The columns each record type's header had (see `ImportResult.columns`). */
      columns: Map<string, Set<string>>;
    }
  | {
      ok: false;
      /** One sentence saying the file was refused and why. */
      headline: string;
      /** What to do about it, when there are no row errors to list. */
      detail?: string;
      /** The rows that need fixing. Empty when the whole file is refused. */
      errors: ImportError[];
    };

/**
 * Read a file the user picked and decide whether it can be imported. A file is
 * refused when it is not a fiscode CSV, when any row is rejected, or when it
 * holds no rows: importing "nothing" would otherwise offer to replace the
 * user's data with zero rows.
 */
export const readImportFile = (raw: string): ImportFile => {
  const { bundle, provenance, validationErrors, tables, rowLines, columns } = parseCsv(raw);
  // An error with no row number is about the whole file, e.g. a schema marker
  // from a newer fiscode. That message already says what to do.
  const wholeFile = validationErrors.find((e) => e.line === 0);
  if (wholeFile) {
    return { ok: false, headline: "This file cannot be imported.", errors: [wholeFile] };
  }
  // An export of an empty app is only the two comment lines: a fiscode file
  // with nothing in it, which the "no rows" message below describes better.
  const marked = provenance.schema !== undefined || provenance.scope !== undefined;
  if (tables === 0 && !(marked && validationErrors.length === 0)) {
    return {
      ok: false,
      headline: "This is not a fiscode file. Nothing was imported.",
      detail:
        "It has no header row (a row that starts with record_type). Choose a CSV you downloaded from fiscode.",
      errors: [],
    };
  }
  if (validationErrors.length > 0) {
    const n = validationErrors.length;
    return {
      ok: false,
      headline: `Nothing was imported. ${n} ${n === 1 ? "row needs" : "rows need"} fixing.`,
      errors: validationErrors,
    };
  }
  const counts = countRows(bundle);
  if (counts.live + counts.deleted + counts.history === 0) {
    return {
      ok: false,
      headline: "This file has no rows. Nothing was imported.",
      detail: "It was exported from an app that held no data, or its rows were removed.",
      errors: [],
    };
  }
  return {
    ok: true,
    bundle,
    scope: provenance.scope,
    year: provenance.year,
    counts,
    rowLines,
    columns,
  };
};

export type ImportPlan = {
  mode: ImportMode;
  /** What is in the database now. */
  current: RowCounts;
  /** Rows this import writes. `history` counts only entries that are not here yet. */
  written: RowCounts;
  /**
   * Append: entity periods among the added rows. An import writes them as the
   * file has them, without the app's check for overlapping periods.
   */
  addedEntityPeriods: number;
  /** Append: rows in the file whose id is already here. They are left as they are. */
  skipped: number;
  /** Restore: rows here that are not in the file, so they are gone afterwards. */
  removed: { live: number; deleted: number };
  /** True when one history entry is added that records the state before the import. */
  snapshot: boolean;
  /** Set when this mode must not be offered for this file; says why. */
  refusal: string | undefined;
  /** Update: rows here that take the file's different values (the profile counts as one). */
  changed: number;
  /** Update: rows in the file that are here with the same values. */
  unchanged: number;
  /** Update: rows deleted here that the file has. They stay deleted. */
  keptDeleted: number;
  /** Update: rows the file marks deleted that are live here. They stay as they are here. */
  keptLive: number;
  /** Add rows and Update rows: what the rows they write would trip. Restore never warns. */
  warnings: ImportWarnings;
};

/** How many rows that break a form's range are listed before the rest become a count. */
export const RANGE_WARNING_LIMIT = 5;

export type ImportWarnings = {
  outOfRange: {
    /** Rows written with at least one value a form would refuse. */
    count: number;
    /** One sentence for the warning's heading, naming the kinds of value. */
    summary: string;
    /** The first `RANGE_WARNING_LIMIT` rows: "Row 12 (expense): amount -$45.00 is negative. …" */
    rows: string[];
  };
  /** One sentence per pair of live entity periods that would overlap, naming both. */
  overlaps: string[];
};

const NO_WARNINGS: ImportWarnings = {
  outOfRange: { count: 0, summary: "", rows: [] },
  overlaps: [],
};

/**
 * Work out what importing `incoming` over `existing` would do in one mode.
 * `existing` must be the whole state: deleted rows and history included.
 */
export const planImport = (
  existing: Bundle,
  incoming: Bundle,
  mode: ImportMode,
  file: {
    scope?: "full" | "yearly";
    year?: number;
    rowLines?: Map<string, number>;
    columns?: Map<string, Set<string>>;
  } = {},
): ImportPlan => {
  const current = countRows(existing);
  const existingHistory = new Set(existing.history.map((h) => h.id));
  const newHistory = incoming.history.filter((h) => !existingHistory.has(h.id)).length;
  const snapshot = current.live + current.deleted + current.history > 0;

  if (mode === "append") {
    const written: RowCounts = { live: 0, deleted: 0, history: newHistory };
    let skipped = 0;
    let addedEntityPeriods = 0;
    if (incoming.profile) {
      if (existing.profile) skipped++;
      else written.live++;
    }
    for (const table of ROW_TABLES) {
      const here = new Set(existing[table].map((r) => r.id));
      for (const row of incoming[table]) {
        if (here.has(row.id)) {
          skipped++;
          continue;
        }
        if (row.deletedAt === null) written.live++;
        else written.deleted++;
        if (table === "entities" && row.deletedAt === null) addedEntityPeriods++;
      }
    }
    return {
      mode,
      current,
      written,
      addedEntityPeriods,
      skipped,
      removed: { live: 0, deleted: 0 },
      snapshot,
      refusal: undefined,
      changed: 0,
      unchanged: 0,
      keptDeleted: 0,
      keptLive: 0,
      warnings: warningsFor(existing, incoming, mode, file.rowLines, file.columns),
    };
  }

  if (mode === "update") {
    const written: RowCounts = { live: 0, deleted: 0, history: newHistory };
    let changed = 0;
    let unchanged = 0;
    let keptDeleted = 0;
    let keptLive = 0;
    let addedEntityPeriods = 0;
    if (incoming.profile) {
      if (!existing.profile) written.live++;
      else if (
        sameRow(
          existing.profile,
          withFileFields(
            existing.profile,
            incoming.profile,
            fieldsOf(file.columns, "profile", incoming.profile.id),
          ),
        )
      )
        unchanged++;
      else changed++;
    }
    for (const table of ROW_TABLES) {
      const here = new Map(existing[table].map((r) => [r.id, r]));
      for (const row of incoming[table]) {
        const mine = here.get(row.id);
        if (!mine) {
          if (row.deletedAt === null) written.live++;
          else written.deleted++;
          if (table === "entities" && row.deletedAt === null) addedEntityPeriods++;
        } else if (
          sameRow(
            mine,
            withFileFields(mine, row, fieldsOf(file.columns, TABLE_RECORD_TYPES[table], row.id)),
          )
        )
          unchanged++;
        else if (mine.deletedAt !== null) keptDeleted++;
        else if (!updateTakesFileRow(mine, row)) keptLive++;
        else changed++;
      }
    }
    return {
      mode,
      current,
      written,
      addedEntityPeriods,
      skipped: 0,
      removed: { live: 0, deleted: 0 },
      snapshot,
      refusal: undefined,
      changed,
      unchanged,
      keptDeleted,
      keptLive,
      warnings: warningsFor(existing, incoming, mode, file.rowLines, file.columns),
    };
  }

  const removed = { live: 0, deleted: 0 };
  if (existing.profile && !incoming.profile) removed.live++;
  for (const table of ROW_TABLES) {
    const inFile = new Set(incoming[table].map((r) => r.id));
    for (const row of existing[table]) {
      if (inFile.has(row.id)) continue;
      if (row.deletedAt === null) removed.live++;
      else removed.deleted++;
    }
  }
  const fileCounts = countRows(incoming);
  const lost = removed.live + removed.deleted;
  // A yearly file is one year of live rows for an accountant. Restoring from
  // it would drop every other year, every deleted row and every archived
  // client or vehicle. On an empty database there is nothing to lose.
  const refusal =
    file.scope === "yearly" && current.live + current.deleted > 0
      ? `This is a yearly file${file.year === undefined ? "" : ` for ${file.year}`}, not a backup. It holds one year and leaves out deleted rows and archived clients and vehicles.${lost === 0 ? "" : ` Restoring from it would remove ${lost} ${lost === 1 ? "row that is" : "rows that are"} here and not in the file.`} Restore from a full backup instead.`
      : undefined;
  return {
    mode,
    current,
    written: { live: fileCounts.live, deleted: fileCounts.deleted, history: newHistory },
    addedEntityPeriods: 0,
    skipped: 0,
    removed,
    snapshot,
    refusal,
    changed: 0,
    unchanged: 0,
    keptDeleted: 0,
    keptLive: 0,
    warnings: NO_WARNINGS,
  };
};

/** Same values in every field. Key order does not matter. */
const sameRow = (a: object, b: object): boolean => {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if ((x[k] ?? null) !== (y[k] ?? null)) return false;
  return true;
};

/**
 * The file's rows a mode writes: Add rows writes rows whose id is not here; Update rows also
 * writes rows here that take the file's different values. Each with its record type.
 */
const writtenRows = (
  existing: Bundle,
  incoming: Bundle,
  mode: "append" | "update",
  columns: Map<string, Set<string>> | undefined,
): { recordType: string; row: { id: string } }[] => {
  const out: { recordType: string; row: { id: string } }[] = [];
  if (incoming.profile) {
    if (!existing.profile) out.push({ recordType: "profile", row: incoming.profile });
    else if (mode === "update") {
      const merged = withFileFields(
        existing.profile,
        incoming.profile,
        fieldsOf(columns, "profile", incoming.profile.id),
      );
      if (!sameRow(existing.profile, merged)) out.push({ recordType: "profile", row: merged });
    }
  }
  for (const table of ROW_TABLES) {
    const here = new Map(existing[table].map((r) => [r.id, r]));
    for (const row of incoming[table]) {
      const mine = here.get(row.id);
      if (!mine) {
        out.push({ recordType: TABLE_RECORD_TYPES[table], row });
        continue;
      }
      if (mode !== "update" || !updateTakesFileRow(mine, row)) continue;
      const merged = withFileFields(
        mine,
        row,
        fieldsOf(columns, TABLE_RECORD_TYPES[table], row.id),
      );
      if (!sameRow(mine, merged)) out.push({ recordType: TABLE_RECORD_TYPES[table], row: merged });
    }
  }
  return out;
};

const warningsFor = (
  existing: Bundle,
  incoming: Bundle,
  mode: "append" | "update",
  rowLines: Map<string, number> | undefined,
  columns?: Map<string, Set<string>>,
): ImportWarnings => {
  const rows = writtenRows(existing, incoming, mode, columns);

  const bad: string[] = [];
  for (const { recordType, row } of rows) {
    const problems = formRangeProblems(recordType, row);
    if (problems.length === 0) continue;
    const line = rowLines?.get(rowLineKey(recordType, row.id));
    bad.push(
      `${line === undefined ? "A row" : `Row ${line}`} (${recordType}): ${problems.join(" ")}`,
    );
  }
  const outOfRange = {
    count: bad.length,
    summary:
      bad.length === 0
        ? ""
        : `${bad.length} ${bad.length === 1 ? "row has a value" : "rows have values"} the app's forms would not accept: negative amounts, negative miles, $0 where more than $0 is needed, amounts of $100,000,000 or more, or whole numbers out of range. ${bad.length === 1 ? "It imports" : "They import"} as written; check ${bad.length === 1 ? "it" : "them"} afterwards.`,
    rows: bad.slice(0, RANGE_WARNING_LIMIT),
  };

  // The entity periods after the import: the file's written ones replace or join these.
  const writtenEntities = new Map(
    rows
      .filter((r) => r.recordType === "entity")
      .map((r) => [r.row.id, r.row as Bundle["entities"][number]]),
  );
  const written = new Set(writtenEntities.keys());
  const after = [
    ...existing.entities.map((e) => writtenEntities.get(e.id) ?? e),
    ...incoming.entities.filter(
      (e) => written.has(e.id) && !existing.entities.some((x) => x.id === e.id),
    ),
  ];
  const overlaps: string[] = [];
  const named = new Set<string>();
  for (const e of after) {
    if (!written.has(e.id) || e.deletedAt !== null) continue;
    const other = findEntityOverlap(after, e);
    if (!other) continue;
    const pair = [e.id, other.id].sort().join("|");
    if (named.has(pair)) continue;
    named.add(pair);
    overlaps.push(
      `The file's ${describeEntityPeriod(e)} overlaps your ${describeEntityPeriod(other)}.`,
    );
  }
  return { outOfRange, overlaps };
};
