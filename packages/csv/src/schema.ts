import { z } from "zod";

// Single flat column set for the entire export. Every row carries
// `record_type` and `id`; empty fields are serialized as empty strings.
// Adding new fields = new optional columns; existing exports still parse.

export const CSV_SCHEMA_VERSION = "v1" as const;

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
]);
export type RecordType = z.infer<typeof recordTypeSchema>;

const optStr = z.string().optional();
const optBool = z.union([z.literal("0"), z.literal("1"), z.literal("")]).optional();
const optInt = z.string().optional();

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
});
export type CsvRow = z.infer<typeof csvRowSchema>;

// The canonical column order for exports. New columns are appended at the end
// to preserve diff stability across versions.
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
];
