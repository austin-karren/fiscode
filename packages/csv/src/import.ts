import Papa from "papaparse";
import {
  type Bundle,
  emptyBundle,
  type ClientRow,
  type EntityRow,
  type ExpenseRow,
  type HistoryRow,
  type HomeOfficeRow,
  type IncomeRow,
  type MileageRow,
  type ProfileRow,
  type RetirementContributionRow,
  type SpouseRow,
  type TimeEntryRow,
  type VehicleRow,
} from "./bundle-types.ts";
import { csvRowSchema, READABLE_SCHEMA_VERSIONS, type CsvRow } from "./schema.ts";
import { BOM, parseProvenanceLines, type Provenance } from "./provenance.ts";
import { decodeCell, HEADER_LOOKUP } from "./sections.ts";

// The schema (csvRowSchema in schema.ts) has already validated that numeric
// columns are either empty/undefined OR parse to a finite integer. So by the
// time we reach these helpers we don't need defensive fallbacks — a non-empty
// value is guaranteed numeric. We still keep the `fallback` for `num` because
// some columns are conceptually required-but-defaulted (e.g., dependents=0
// when blank); the `numOrNull` form is used for genuinely-optional columns.
// A cell of only spaces (a spreadsheet hand edit) is blank, like an empty one.
const num = (v: string | undefined, fallback = 0): number => {
  if (v === undefined || v.trim() === "") return fallback;
  return Number(v.trim());
};

const numOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  return Number(v.trim());
};

const strOrNull = (v: string | undefined): string | null =>
  v === undefined || v === "" ? null : v;

const bool = (v: string | undefined): boolean => v === "1";

const rowToBundle = (rows: CsvRow[]): Bundle => {
  const b = emptyBundle();
  for (const r of rows) {
    switch (r.record_type) {
      case "profile":
        b.profile = {
          id: r.id,
          filingStatus: r.filing_status ?? "single",
          state: r.state ?? "UT",
          seStartDate: r.se_start_date ?? "",
          dependents: num(r.dependents),
          tracksRoth: bool(r.tracks_roth),
          usesRetirement: bool(r.uses_retirement),
          quarterlyMethod: r.quarterly_method ?? "annualized",
          prepLeadDays: num(r.prep_lead_days, 14),
          priorYearTotalTaxCents: numOrNull(r.prior_year_total_tax_cents),
          priorYearAgiCents: numOrNull(r.prior_year_agi_cents),
          priorYearStateTaxCents: numOrNull(r.prior_year_state_tax_cents),
          priorYearFiguresYear: numOrNull(r.prior_year_figures_year),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
        } satisfies ProfileRow;
        break;
      case "entity":
        b.entities.push({
          id: r.id,
          type: r.type ?? "sole_prop",
          startDate: r.start_date ?? "",
          endDate: strOrNull(r.end_date),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies EntityRow);
        break;
      case "spouse":
        b.spouses.push({
          id: r.id,
          startDate: r.start_date ?? "",
          endDate: strOrNull(r.end_date),
          annualW2WagesCents: num(r.annual_w2_wages_cents),
          annualFederalWithholdingCents: num(r.annual_federal_withholding_cents),
          annualStateWithholdingCents: num(r.annual_state_withholding_cents),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies SpouseRow);
        break;
      case "client":
        b.clients.push({
          id: r.id,
          name: r.name ?? "",
          type: strOrNull(r.type),
          notes: strOrNull(r.notes),
          defaultRateCents: numOrNull(r.default_rate_cents),
          defaultCommissionRate: numOrNull(r.default_commission_rate_basis_points),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies ClientRow);
        break;
      case "income":
        b.income.push({
          id: r.id,
          date: r.date ?? "",
          clientId: strOrNull(r.client_id),
          amountCents: num(r.amount_cents),
          sourceType: r.source_type ?? "1099",
          kind: r.kind ?? "recurring",
          description: strOrNull(r.description),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies IncomeRow);
        break;
      case "time_entry":
        b.timeEntries.push({
          id: r.id,
          date: r.date ?? "",
          clientId: strOrNull(r.client_id),
          minutes: num(r.minutes),
          description: strOrNull(r.description),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies TimeEntryRow);
        break;
      case "vehicle":
        b.vehicles.push({
          id: r.id,
          make: r.make ?? "",
          model: r.model ?? "",
          year: numOrNull(r.year),
          mpg: numOrNull(r.mpg),
          method: r.method ?? "standard_mileage",
          inServiceDate: strOrNull(r.in_service_date),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies VehicleRow);
        break;
      case "mileage":
        b.mileage.push({
          id: r.id,
          date: r.date ?? "",
          vehicleId: strOrNull(r.vehicle_id),
          businessMiles: num(r.business_miles),
          purpose: strOrNull(r.purpose),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies MileageRow);
        break;
      case "home_office":
        b.homeOffice.push({
          id: r.id,
          startDate: r.start_date ?? "",
          endDate: strOrNull(r.end_date),
          method: r.method ?? "simplified",
          officeSqft: numOrNull(r.office_sqft),
          homeSqft: numOrNull(r.home_sqft),
          monthlyRentMortgageCents: numOrNull(r.monthly_rent_mortgage_cents),
          monthlyUtilitiesCents: numOrNull(r.monthly_utilities_cents),
          monthlyInsuranceCents: numOrNull(r.monthly_insurance_cents),
          regularExclusiveAck: bool(r.regular_exclusive_ack),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies HomeOfficeRow);
        break;
      case "expense":
        b.expenses.push({
          id: r.id,
          date: r.date ?? "",
          amountCents: num(r.amount_cents),
          category: r.category ?? "other",
          clientId: strOrNull(r.client_id),
          description: strOrNull(r.description),
          reason: strOrNull(r.reason),
          notes: strOrNull(r.notes),
          flagForSection179: bool(r.flag_for_section_179),
          startupExpense: bool(r.startup_expense),
          placedInServiceDate: strOrNull(r.placed_in_service_date),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies ExpenseRow);
        break;
      case "retirement_contribution":
        b.retirementContributions.push({
          id: r.id,
          date: r.date ?? "",
          account: r.account ?? "",
          amountCents: num(r.amount_cents),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies RetirementContributionRow);
        break;
      case "history":
        b.history.push({
          id: r.id,
          entity: r.entity ?? "",
          entityId: r.entity_id ?? "",
          op: r.op ?? "",
          beforeJson: strOrNull(r.before_json),
          afterJson: strOrNull(r.after_json),
          at: r.at ?? "",
        } satisfies HistoryRow);
        break;
    }
  }
  return b;
};

export type ImportResult = {
  bundle: Bundle;
  provenance: Partial<Provenance>;
  validationErrors: ImportError[];
  /** How many header rows (rows starting with `record_type`) the file has. */
  tables: number;
};

export type ImportError = {
  /** Position among the data rows, from 0. -1 for an error about the whole file. */
  rowIndex: number;
  /**
   * The row as a spreadsheet numbers it, from 1: comment lines, blank lines
   * and headers all count, and a cell with line breaks is still one row.
   * 0 when the error is not about one row.
   */
  line: number;
  /** The row's first cell, e.g. `expense`. Empty when there is none. */
  recordType: string;
  message: string;
};

/** One error as a sentence a person can act on: `Row 50 (expense): amount: …`. */
export const describeImportError = (e: ImportError): string => {
  if (e.line === 0) return e.message;
  return `Row ${e.line}${e.recordType ? ` (${e.recordType})` : ""}: ${e.message}`;
};

/** The first few errors as sentences, plus a count of the rest. */
export const describeImportErrors = (errors: readonly ImportError[], limit = 5): string[] => {
  const shown = errors.slice(0, limit).map(describeImportError);
  const rest = errors.length - shown.length;
  return rest > 0 ? [...shown, `…and ${rest} more.`] : shown;
};

/**
 * Turn every record break (CRLF, LF or a lone CR) into LF, leaving line breaks
 * inside quoted cells exactly as written. Papa picks one line ending per file
 * from its first lines, so a file with mixed endings (an LF line typed above a
 * CRLF export) would otherwise keep a stray CR on the last cell of each row.
 * A quote opens a cell only at the start of a cell, as in Papa.
 *
 * Also drops a byte-order mark at the start of a record (the file's first, or
 * a later one when two exports were joined). A mark inside a quoted cell is
 * the user's text and stays.
 */
const normalizeRecordBreaks = (text: string): string => {
  let out = "";
  let inQuotes = false;
  let atCellStart = true;
  let atRecordStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (atRecordStart && ch === BOM) continue;
    atRecordStart = !inQuotes && (ch === "\r" || ch === "\n");
    if (inQuotes) {
      out += ch;
      if (ch === '"') {
        if (text[i + 1] === '"') out += text[++i];
        else inQuotes = false;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      out += "\n";
      atCellStart = true;
      continue;
    }
    if (ch === '"' && atCellStart) inQuotes = true;
    atCellStart = ch === ",";
    out += ch;
  }
  return out;
};

const isJson = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

const isBlank = (row: readonly string[]): boolean => row.every((cell) => cell.trim() === "");
const isComment = (row: readonly string[]): boolean => (row[0] ?? "").startsWith("#");

/**
 * Parse a fiscode CSV, old layout or new, with one set of rules:
 *
 * - A row whose first cell starts with `#` is a comment. The comments above
 *   the first table carry provenance; later ones are section titles.
 * - A row whose first cell is `record_type` is a header. It names the columns
 *   of the rows below it, until the next header.
 * - Any other non-blank row is data, read through the header above it.
 *
 * A v1 file is one header with every column and money in `*_cents` columns.
 * A v2 file has a header per record type and money in dollar columns. The
 * column name says which, so no version switch is needed to read amounts.
 * The `# schema:` marker matters for one thing only: see `unguard` below.
 */
export const parseCsv = (raw: string): ImportResult => {
  // Comments are dropped after parsing, not by Papa's `comments` option, so a
  // `#` at the start of a line inside a quoted multi-line note is kept, and a
  // comment line a spreadsheet has quoted or padded with commas still counts.
  const text = normalizeRecordBreaks(raw);
  // One entry per spreadsheet row, so index + 1 is the row number a person sees.
  const all = Papa.parse<string[]>(text, { header: false, newline: "\n" }).data;
  const firstBody = all.findIndex((row) => !isBlank(row) && !isComment(row));
  const provenance = parseProvenanceLines(
    all
      .slice(0, firstBody === -1 ? all.length : firstBody)
      .filter(isComment)
      .map((row) => row[0]!),
  );
  if (provenance.schema !== undefined && !READABLE_SCHEMA_VERSIONS.includes(provenance.schema)) {
    // A newer format may reuse a column name with a new meaning. Reading it
    // with today's rules could import wrong values without any error.
    return {
      bundle: emptyBundle(),
      provenance,
      tables: 0,
      validationErrors: [
        {
          rowIndex: -1,
          line: 0,
          recordType: "",
          message: `This file is marked schema ${provenance.schema}, which this version of fiscode cannot read. It was written by a newer fiscode: update the app, then import again.`,
        },
      ],
    };
  }
  // v1 exports never wrote the `'` formula guard, so a leading `'=` in a file
  // marked v1 is the user's own text. Anything else (v2, or a hand-written
  // file with no marker) has the guard stripped.
  const unguard = provenance.schema !== "v1";

  const validationErrors: ImportResult["validationErrors"] = [];
  const validated: CsvRow[] = [];
  let header: string[] | undefined;
  let tables = 0;
  let rowIndex = -1;
  let profileLine = 0;
  // Spreadsheet row of each id seen so far, per record type.
  const seenIds = new Map<string, number>();
  all.forEach((row, index) => {
    if (isBlank(row) || isComment(row)) return;
    // Header names are matched without regard to case or outer spaces.
    if (row[0]!.trim().toLowerCase() === "record_type") {
      header = row.map((name) => name.trim().toLowerCase());
      tables++;
      return;
    }
    rowIndex++;
    const where = { rowIndex, line: index + 1, recordType: row[0]!.trim() };
    if (!header) {
      validationErrors.push({
        ...where,
        message: "Row found before a header row (a header row starts with record_type)",
      });
      return;
    }
    const flat: Record<string, string> = {};
    const filledBy: Record<string, string> = {};
    const problems: string[] = [];
    header.forEach((name, i) => {
      const column = HEADER_LOOKUP.get(name);
      if (!column) return; // label column or a column we don't know
      const decoded = decodeCell(column.kind, row[i] ?? "", unguard);
      if (!decoded.ok) {
        problems.push(`${name}: ${decoded.message}`);
        return;
      }
      // Two headers can fill one field, e.g. `amount` and `amount_cents`.
      // An empty one gives way; two filled ones must agree.
      const earlier = filledBy[column.key];
      if (decoded.value === "") {
        flat[column.key] ??= "";
      } else if (earlier !== undefined && flat[column.key] !== decoded.value) {
        problems.push(`${name}: disagrees with ${earlier} in the same row. Keep one of them`);
      } else {
        flat[column.key] = decoded.value;
        filledBy[column.key] = name;
      }
    });
    if (problems.length > 0) {
      validationErrors.push({ ...where, message: problems.join("; ") });
      return;
    }
    if (flat.record_type === "history") {
      // A spreadsheet caps a cell at about 32,000 characters and cuts the rest
      // without a word. A cut-off JSON cell would import "fine" and leave a
      // history entry nothing can read, so check it parses.
      for (const name of ["before_json", "after_json"] as const) {
        if (flat[name] && !isJson(flat[name])) {
          problems.push(
            `${name}: This is not complete JSON. A spreadsheet probably cut the cell short when the file was saved. Import the original download instead`,
          );
        }
      }
      if (problems.length > 0) {
        validationErrors.push({ ...where, message: problems.join("; ") });
        return;
      }
    }
    const result = csvRowSchema.safeParse(flat);
    if (result.success) {
      // An id is the row's identity. Two rows of one type sharing an id cannot
      // both be stored: a restore would fail at the database and an append
      // would keep one and drop the other without a word. Refuse it here,
      // where both row numbers are known.
      const idKey = `${result.data.record_type}\u0000${result.data.id}`;
      const firstLine = seenIds.get(idKey);
      if (firstLine !== undefined) {
        validationErrors.push({
          ...where,
          message: `id: "${result.data.id}" is also used on row ${firstLine}. Each ${result.data.record_type} row needs its own id`,
        });
        return;
      }
      seenIds.set(idKey, index + 1);
      if (result.data.record_type === "profile") profileLine = index + 1;
      validated.push(result.data);
    } else {
      validationErrors.push({
        ...where,
        message: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
      });
    }
  });
  const bundle = rowToBundle(validated);
  // Post-pass invariants. se_start_date is required by the DB schema and
  // by the tax-engine SE-range filter; an empty value silently disables
  // the filter (every date is lexically > "") and would import without
  // complaint. Fail loudly here instead.
  if (bundle.profile && !bundle.profile.seStartDate) {
    validationErrors.push({
      rowIndex: -1,
      line: profileLine,
      recordType: "profile",
      message: "profile.se_start_date is required but missing or empty",
    });
  }
  return { bundle, provenance, validationErrors, tables };
};

export { rowToBundle };
