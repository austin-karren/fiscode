import type { ImportMode } from "./apply-import.ts";
import type { Bundle } from "./bundle-types.ts";
import { parseCsv, type ImportError } from "./import.ts";

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
  const { bundle, provenance, validationErrors, tables } = parseCsv(raw);
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
  return { ok: true, bundle, scope: provenance.scope, year: provenance.year, counts };
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
};

/**
 * Work out what importing `incoming` over `existing` would do in one mode.
 * `existing` must be the whole state: deleted rows and history included.
 */
export const planImport = (
  existing: Bundle,
  incoming: Bundle,
  mode: ImportMode,
  file: { scope?: "full" | "yearly"; year?: number } = {},
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
  };
};
