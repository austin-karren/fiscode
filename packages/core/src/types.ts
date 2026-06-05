import { z } from "zod";

// Per-enum custom `message` overrides zod 4's default
// `Invalid option: expected one of "A"|"B"|…`, which overflows the form
// for long enums like stateCodeSchema. Pick short, user-facing copy.

export const filingStatusSchema = z.enum(["single", "mfj", "mfs", "hoh"], {
  message: "Pick a filing status",
});
export type FilingStatus = z.infer<typeof filingStatusSchema>;

export const entityTypeSchema = z.enum(["sole_prop", "single_member_llc", "s_corp"], {
  message: "Pick an entity type",
});
export type EntityType = z.infer<typeof entityTypeSchema>;

// US states + DC. Validation only, not exhaustive policy enforcement.
export const stateCodeSchema = z.enum(
  [
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "DC",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY",
  ],
  { message: "Pick a US state" },
);
export type StateCode = z.infer<typeof stateCodeSchema>;

export const incomeSourceTypeSchema = z.enum(["1099", "w2"], {
  message: "Pick an income source type",
});
export type IncomeSourceType = z.infer<typeof incomeSourceTypeSchema>;

export const incomeKindSchema = z.enum(["recurring", "bonus", "consulting", "other"], {
  message: "Pick an income kind",
});
export type IncomeKind = z.infer<typeof incomeKindSchema>;

export const expenseCategorySchema = z.enum(
  [
    "health_insurance",
    "phone_internet",
    "software_subs",
    "professional_services",
    "meals",
    "equipment",
    "home_office",
    "vehicle",
    "supplies",
    "travel",
    "advertising",
    "other",
  ],
  { message: "Pick an expense category" },
);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const homeOfficeMethodSchema = z.enum(["simplified", "actual"], {
  message: "Pick a home-office method",
});
export type HomeOfficeMethod = z.infer<typeof homeOfficeMethodSchema>;

export const vehicleMethodSchema = z.enum(["standard_mileage", "actual"], {
  message: "Pick a vehicle method",
});
export type VehicleMethod = z.infer<typeof vehicleMethodSchema>;

export const quarterlyMethodSchema = z.enum(["even", "annualized"], {
  message: "Pick a quarterly method",
});
export type QuarterlyMethod = z.infer<typeof quarterlyMethodSchema>;

export const historyOpSchema = z.enum(["insert", "update", "delete", "revert"], {
  message: "Pick a history op",
});
export type HistoryOp = z.infer<typeof historyOpSchema>;
