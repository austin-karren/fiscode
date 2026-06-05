import { z } from "zod";

export const filingStatusSchema = z.enum(["single", "mfj", "mfs", "hoh"]);
export type FilingStatus = z.infer<typeof filingStatusSchema>;

export const entityTypeSchema = z.enum(["sole_prop", "single_member_llc", "s_corp"]);
export type EntityType = z.infer<typeof entityTypeSchema>;

// US states + DC. Validation only, not exhaustive policy enforcement.
export const stateCodeSchema = z.enum([
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
]);
export type StateCode = z.infer<typeof stateCodeSchema>;

export const incomeSourceTypeSchema = z.enum(["1099", "w2"]);
export type IncomeSourceType = z.infer<typeof incomeSourceTypeSchema>;

export const incomeKindSchema = z.enum(["recurring", "bonus", "consulting", "other"]);
export type IncomeKind = z.infer<typeof incomeKindSchema>;

export const expenseCategorySchema = z.enum([
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
]);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const homeOfficeMethodSchema = z.enum(["simplified", "actual"]);
export type HomeOfficeMethod = z.infer<typeof homeOfficeMethodSchema>;

export const vehicleMethodSchema = z.enum(["standard_mileage", "actual"]);
export type VehicleMethod = z.infer<typeof vehicleMethodSchema>;

export const quarterlyMethodSchema = z.enum(["even", "annualized"]);
export type QuarterlyMethod = z.infer<typeof quarterlyMethodSchema>;

export const historyOpSchema = z.enum(["insert", "update", "delete", "revert"]);
export type HistoryOp = z.infer<typeof historyOpSchema>;
