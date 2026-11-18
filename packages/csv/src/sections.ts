import { CSV_COLUMNS, type CsvRow, type RecordType } from "./schema.ts";

// The v2 layout: one small table per record type instead of one 50-column
// sheet. Each section lists its own columns, readable ones first, ids and
// timestamps last. `bundleToRows` still produces the flat v1-keyed row; this
// file only decides how a flat row is laid out and how each cell is written
// and read back.

type Key = keyof CsvRow;

/** A flat row keyed by the v1 column names in `CSV_COLUMNS`. */
export type FlatRow = Record<string, string>;

/**
 * How a stored cell is written and read:
 * - `text`    free text, ids and codes; guarded against formula injection
 * - `date`    ISO `YYYY-MM-DD`, checked on import
 * - `int`     plain integer
 * - `bool`    `yes` / `no` (import also takes `1` / `0`)
 * - `money`   dollars with two decimals; the flat row holds integer cents
 * - `percent` percent with two decimals; the flat row holds basis points
 */
export type CellKind = "text" | "date" | "int" | "bool" | "money" | "percent";

export type StoredColumn = { name: string; key: Key; kind: CellKind };

/** What a derived column may look up besides its own row. */
export type Lookup = {
  clientNames: ReadonlyMap<string, string>;
  vehicleNames: ReadonlyMap<string, string>;
};

/** Export-only column, computed from stored ones and ignored on import. */
export type DerivedColumn = { name: string; derive: (row: FlatRow, lookup: Lookup) => string };

export type Column = StoredColumn | DerivedColumn;

export type Section = { recordType: RecordType; title: string; columns: Column[] };

export const isStored = (c: Column): c is StoredColumn => "key" in c;

const LABELS: Record<string, Record<string, string>> = {
  "profile.filing_status": {
    single: "Single",
    mfj: "Married filing jointly",
    mfs: "Married filing separately",
    hoh: "Head of household",
  },
  "profile.quarterly_method": {
    annualized: "Annualized installment",
    even: "Even split (annual / 4)",
  },
  "entity.type": {
    sole_prop: "Sole proprietor",
    single_member_llc: "Single-member LLC",
    s_corp: "S corp",
  },
  "income.source_type": { "1099": "1099 self-employment", w2: "W-2 wages" },
  "income.kind": {
    recurring: "Recurring",
    bonus: "Bonus",
    consulting: "Consulting",
    other: "Other",
  },
  "vehicle.method": { standard_mileage: "Standard mileage", actual: "Actual expenses" },
  "home_office.method": { simplified: "Simplified", actual: "Actual expenses" },
  "expense.category": {
    health_insurance: "Self-employed health insurance",
    phone_internet: "Phone / internet",
    software_subs: "Software & subscriptions",
    professional_services: "Professional services",
    meals: "Business meals (50%)",
    equipment: "Equipment",
    home_office: "Home office",
    vehicle: "Vehicle",
    supplies: "Supplies",
    travel: "Travel",
    advertising: "Advertising",
    other: "Other",
  },
  "retirement_contribution.account": {
    sep: "SEP IRA",
    solo_401k: "Solo 401(k)",
    roth_ira: "Roth IRA",
    trad_ira: "Traditional IRA",
  },
};

const text = (key: Key): StoredColumn => ({ name: key, key, kind: "text" });
const date = (key: Key): StoredColumn => ({ name: key, key, kind: "date" });
const int = (key: Key): StoredColumn => ({ name: key, key, kind: "int" });
const bool = (key: Key): StoredColumn => ({ name: key, key, kind: "bool" });
/** Dollars column `amount` for the cents key `amount_cents`. */
const money = (key: Key): StoredColumn => ({
  name: key.replace(/_cents$/, ""),
  key,
  kind: "money",
});

/** `<code>_label`: the human name of a code. Blank for a code we don't know. */
const label = (key: Key): DerivedColumn => ({
  name: `${key}_label`,
  derive: (row) => LABELS[`${row.record_type}.${key}`]?.[row[key] ?? ""] ?? "",
});

const clientName: DerivedColumn = {
  name: "client_name",
  derive: (row, lookup) => lookup.clientNames.get(row.client_id ?? "") ?? "",
};

const vehicleName: DerivedColumn = {
  name: "vehicle_name",
  derive: (row, lookup) => lookup.vehicleNames.get(row.vehicle_id ?? "") ?? "",
};

const hours: DerivedColumn = {
  name: "hours",
  derive: (row) => (row.minutes ? (Number(row.minutes) / 60).toFixed(2) : ""),
};

const RECORD_TYPE = text("record_type");
const TAIL = [text("created_at"), text("updated_at"), text("deleted_at")];

export const SECTIONS: readonly Section[] = [
  {
    recordType: "profile",
    title: "Profile",
    columns: [
      RECORD_TYPE,
      text("filing_status"),
      label("filing_status"),
      text("state"),
      date("se_start_date"),
      int("dependents"),
      text("quarterly_method"),
      label("quarterly_method"),
      int("prep_lead_days"),
      bool("tracks_roth"),
      bool("uses_retirement"),
      text("id"),
      text("created_at"),
      text("updated_at"),
    ],
  },
  {
    recordType: "entity",
    title: "Business entity",
    columns: [
      RECORD_TYPE,
      text("type"),
      label("type"),
      date("start_date"),
      date("end_date"),
      text("notes"),
      text("id"),
      ...TAIL,
    ],
  },
  {
    recordType: "spouse",
    title: "Spouse W-2 income",
    columns: [
      RECORD_TYPE,
      date("start_date"),
      date("end_date"),
      money("annual_w2_wages_cents"),
      money("annual_federal_withholding_cents"),
      money("annual_state_withholding_cents"),
      text("notes"),
      text("id"),
      ...TAIL,
    ],
  },
  {
    recordType: "client",
    title: "Clients",
    columns: [
      RECORD_TYPE,
      text("name"),
      text("type"),
      money("default_rate_cents"),
      {
        name: "default_commission_rate_percent",
        key: "default_commission_rate_basis_points",
        kind: "percent",
      },
      text("notes"),
      text("id"),
      ...TAIL,
    ],
  },
  {
    recordType: "income",
    title: "Income",
    columns: [
      RECORD_TYPE,
      date("date"),
      clientName,
      money("amount_cents"),
      text("source_type"),
      label("source_type"),
      text("kind"),
      label("kind"),
      text("description"),
      text("notes"),
      text("id"),
      text("client_id"),
      ...TAIL,
    ],
  },
  {
    recordType: "time_entry",
    title: "Time",
    columns: [
      RECORD_TYPE,
      date("date"),
      clientName,
      int("minutes"),
      hours,
      text("description"),
      text("notes"),
      text("id"),
      text("client_id"),
      ...TAIL,
    ],
  },
  {
    recordType: "vehicle",
    title: "Vehicles",
    columns: [
      RECORD_TYPE,
      text("make"),
      text("model"),
      int("year"),
      int("mpg"),
      text("method"),
      label("method"),
      date("in_service_date"),
      text("notes"),
      text("id"),
      ...TAIL,
    ],
  },
  {
    recordType: "mileage",
    title: "Mileage",
    columns: [
      RECORD_TYPE,
      date("date"),
      vehicleName,
      int("business_miles"),
      text("purpose"),
      text("notes"),
      text("id"),
      text("vehicle_id"),
      ...TAIL,
    ],
  },
  {
    recordType: "home_office",
    title: "Home office",
    columns: [
      RECORD_TYPE,
      date("start_date"),
      date("end_date"),
      text("method"),
      label("method"),
      int("office_sqft"),
      int("home_sqft"),
      money("monthly_rent_mortgage_cents"),
      money("monthly_utilities_cents"),
      money("monthly_insurance_cents"),
      bool("regular_exclusive_ack"),
      text("notes"),
      text("id"),
      ...TAIL,
    ],
  },
  {
    recordType: "expense",
    title: "Expenses",
    columns: [
      RECORD_TYPE,
      date("date"),
      text("category"),
      label("category"),
      text("description"),
      money("amount_cents"),
      clientName,
      text("reason"),
      bool("flag_for_section_179"),
      bool("startup_expense"),
      text("notes"),
      text("id"),
      text("client_id"),
      ...TAIL,
    ],
  },
  {
    recordType: "retirement_contribution",
    title: "Retirement contributions",
    columns: [
      RECORD_TYPE,
      date("date"),
      text("account"),
      label("account"),
      money("amount_cents"),
      text("notes"),
      text("id"),
      ...TAIL,
    ],
  },
];

// ---------------------------------------------------------------------------
// Cell codecs
// ---------------------------------------------------------------------------

// A spreadsheet runs a cell that starts with one of these as a formula. We
// prefix such text with `'`. A leading `'` is prefixed too, so stripping one
// `'` on import always gives back the original text.
const NEEDS_GUARD = /^[=+\-@\t\r']/;
const GUARDED = /^'[=+\-@\t\r']/;

export const guardText = (value: string): string => (NEEDS_GUARD.test(value) ? `'${value}` : value);

export const unguardText = (value: string): string =>
  GUARDED.test(value) ? value.slice(1) : value;

/** Integer hundredths ("123456") to a two-decimal string ("1234.56"). */
const hundredthsToDecimal = (raw: string, column: string): string => {
  if (raw === "") return "";
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) {
    // Rounding here would make the export lossy without anyone noticing.
    throw new Error(`Cannot export ${column}: "${raw}" is not a whole number`);
  }
  const abs = Math.abs(n);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}${whole}.${frac}`;
};

// Accepts what the export writes (`1234.56`) and what a spreadsheet may save
// back: `1234`, `1234.5`, `$1,234.56`, `-$12.30`. Never more than two decimals,
// because a third digit could not be stored exactly.
const DECIMAL = /^(-?)\$?(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

const decimalToHundredths = (cell: string): string | undefined => {
  const trimmed = cell.trim();
  if (trimmed === "") return "";
  const m = DECIMAL.exec(trimmed);
  if (!m || (m[1] && m[2])) return undefined;
  const value = Number(m[3]!.replace(/,/g, "")) * 100 + Number((m[4] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) return undefined;
  return String(m[1] || m[2] ? -value || 0 : value);
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Write one stored cell. `raw` is the flat row's v1 string. */
export const encodeCell = (column: StoredColumn, raw: string): string => {
  switch (column.kind) {
    case "money":
    case "percent":
      return hundredthsToDecimal(raw, column.name);
    case "bool":
      return raw === "1" ? "yes" : raw === "0" ? "no" : "";
    case "text":
      return guardText(raw);
    case "date":
    case "int":
      return raw;
  }
};

export type Decoded = { ok: true; value: string } | { ok: false; message: string };

/**
 * Read one cell back to the flat row's v1 string. `unguard` is false for a
 * file marked `schema: v1`, which never carried the formula guard.
 */
export const decodeCell = (kind: CellKind, cell: string, unguard: boolean): Decoded => {
  switch (kind) {
    case "money":
    case "percent": {
      const value = decimalToHundredths(cell);
      return value === undefined
        ? {
            ok: false,
            message: `Expected ${kind === "money" ? "a dollar amount" : "a percent"} with at most two decimals, like 1234.56, got "${cell}"`,
          }
        : { ok: true, value };
    }
    case "bool": {
      const v = cell.trim().toLowerCase();
      return { ok: true, value: v === "yes" ? "1" : v === "no" ? "0" : v };
    }
    case "date": {
      const v = cell.trim();
      return v === "" || ISO_DATE.test(v)
        ? { ok: true, value: v }
        : { ok: false, message: `Expected a date as YYYY-MM-DD, got "${cell}"` };
    }
    case "text":
      return { ok: true, value: unguard ? unguardText(cell) : cell };
    case "int":
      return { ok: true, value: cell };
  }
};

// ---------------------------------------------------------------------------
// Header lookup for import
// ---------------------------------------------------------------------------

const buildHeaderLookup = (): ReadonlyMap<string, { key: Key; kind: CellKind }> => {
  const stored = SECTIONS.flatMap((s) => s.columns.filter(isStored));
  const map = new Map<string, { key: Key; kind: CellKind }>();
  // v1 names: the key itself. Money and percent keys hold integers there.
  for (const key of CSV_COLUMNS) {
    const kind = stored.find((c) => c.key === key)?.kind ?? "text";
    map.set(key, { key, kind: kind === "money" || kind === "percent" ? "int" : kind });
  }
  // v2 names that differ from the key: `amount` for `amount_cents`, and so on.
  for (const c of stored) {
    if (c.name !== c.key) map.set(c.name, { key: c.key, kind: c.kind });
  }
  return map;
};

/**
 * Every header name the importer understands, old and new, mapped to the flat
 * key it fills and how to read the cell. The column name alone tells cents
 * from dollars: `amount_cents` is integer cents, `amount` is dollars. A name
 * that is not in here (a label column, a stray column) is ignored.
 */
export const HEADER_LOOKUP = buildHeaderLookup();
