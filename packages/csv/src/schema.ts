import { parseWholeNumber } from "@fiscode/core";
import { z } from "zod";

// The flat row: every stored field of every record type, keyed by its v1
// column name. Every row carries `record_type` and `id`; empty fields are
// empty strings. Adding new fields = new optional columns; existing exports
// still parse.
//
// v1 files wrote this row as is, one 50-column table. v2 files (sections.ts)
// lay the same fields out as one table per record type, with money in
// dollars. The importer maps both back to this flat row before validating.

export const CSV_SCHEMA_VERSION = "v4" as const;

export const recordTypeSchema = z.enum([
  "profile",
  "entity",
  "spouse",
  "client",
  "income",
  "time_entry",
  "vehicle",
  "mileage",
  "home_office",
  "expense",
  "retirement_contribution",
  "history",
]);
export type RecordType = z.infer<typeof recordTypeSchema>;

const optStr = z.string().optional();
const optBool = z.union([z.literal("0"), z.literal("1"), z.literal("")]).optional();

// Numeric cells: empty or spaces → blank; non-empty → plain ASCII digits with an
// optional minus, within the safe-integer range (`parseWholeNumber` in
// @fiscode/core). No exponent, hex, `+` or decimal point. Ranges are not
// checked: Restore must take back any value the app's own export writes.
// The row-mapper then reads the validated string with `Number`.
const optInt = z
  .string()
  .optional()
  .refine(
    (s) => {
      if (s === undefined) return true;
      const parsed = parseWholeNumber(s, { signed: true });
      return parsed.ok || parsed.reason === "empty";
    },
    { message: "Expected an integer" },
  );

// One zod object for the row shape. Per-record validation happens after parse.
export const csvRowSchema = z.object({
  record_type: recordTypeSchema,
  id: z.string(),
  created_at: optStr,
  updated_at: optStr,
  deleted_at: optStr,

  // profile
  filing_status: optStr,
  state: optStr,
  se_start_date: optStr,
  dependents: optInt,
  tracks_roth: optBool,
  uses_retirement: optBool,
  quarterly_method: optStr,
  prep_lead_days: optInt,
  prior_year_total_tax_cents: optInt,
  prior_year_agi_cents: optInt,
  prior_year_state_tax_cents: optInt,

  // entity / spouse / home_office shared dated range
  start_date: optStr,
  end_date: optStr,

  // entity
  type: optStr,

  // spouse
  annual_w2_wages_cents: optInt,
  annual_federal_withholding_cents: optInt,
  annual_state_withholding_cents: optInt,

  // client
  name: optStr,
  default_rate_cents: optInt,
  default_commission_rate_basis_points: optInt,

  // income / expense / time / mileage
  date: optStr,
  client_id: optStr,
  amount_cents: optInt,
  source_type: optStr,
  kind: optStr,
  description: optStr,
  notes: optStr,
  category: optStr,
  reason: optStr,
  flag_for_section_179: optBool,
  startup_expense: optBool,
  placed_in_service_date: optStr,

  // time
  minutes: optInt,

  // vehicle
  make: optStr,
  model: optStr,
  year: optInt,
  mpg: optInt,
  method: optStr,
  in_service_date: optStr,

  // mileage
  vehicle_id: optStr,
  business_miles: optInt,
  purpose: optStr,

  // home_office
  office_sqft: optInt,
  home_sqft: optInt,
  monthly_rent_mortgage_cents: optInt,
  monthly_utilities_cents: optInt,
  monthly_insurance_cents: optInt,
  regular_exclusive_ack: optBool,

  // retirement_contribution
  account: optStr,

  // history (the append-only edit log; one row per change)
  at: optStr,
  entity: optStr,
  entity_id: optStr,
  op: optStr,
  before_json: optStr,
  after_json: optStr,
});
export type CsvRow = z.infer<typeof csvRowSchema>;

// Every flat-row key, in the v1 column order. v1 exports used this as their
// one header; the importer still accepts each name. The v2 column order per
// record type lives in sections.ts.
export const CSV_COLUMNS: ReadonlyArray<keyof CsvRow> = [
  "record_type",
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "filing_status",
  "state",
  "se_start_date",
  "dependents",
  "tracks_roth",
  "uses_retirement",
  "quarterly_method",
  "prep_lead_days",
  "prior_year_total_tax_cents",
  "prior_year_agi_cents",
  "prior_year_state_tax_cents",
  "start_date",
  "end_date",
  "type",
  "annual_w2_wages_cents",
  "annual_federal_withholding_cents",
  "annual_state_withholding_cents",
  "name",
  "default_rate_cents",
  "default_commission_rate_basis_points",
  "date",
  "client_id",
  "amount_cents",
  "source_type",
  "kind",
  "description",
  "notes",
  "category",
  "reason",
  "flag_for_section_179",
  "startup_expense",
  "placed_in_service_date",
  "minutes",
  "make",
  "model",
  "year",
  "mpg",
  "method",
  "in_service_date",
  "vehicle_id",
  "business_miles",
  "purpose",
  "office_sqft",
  "home_sqft",
  "monthly_rent_mortgage_cents",
  "monthly_utilities_cents",
  "monthly_insurance_cents",
  "regular_exclusive_ack",
  "account",
  "at",
  "entity",
  "entity_id",
  "op",
  "before_json",
  "after_json",
];

/** Schema markers this build can read. A file with any other marker is refused. */
export const READABLE_SCHEMA_VERSIONS: readonly string[] = ["v1", "v2", "v3", "v4"];
