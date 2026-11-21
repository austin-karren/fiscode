import {
  AMOUNT_CEILING_CENTS,
  WHOLE_RANGES,
  checkAmountRange,
  formatUSD,
  inWholeRange,
  vehicleYearRange,
  type AmountFloor,
  type Cents,
  type WholeRange,
} from "@fiscode/core";
import type { Bundle } from "./bundle-types.ts";

// The ranges the app's forms enforce (#22, #32), checked on rows a file brings in. A file may
// hold values a form would refuse (a spreadsheet edit, an older export); the import warns
// about them and still writes them as they are. Restore never checks: a backup comes back
// exactly.

type MoneyRule = { column: string; key: string; floor: AmountFloor; optional?: boolean };
type WholeRule = { column: string; key: string; range: () => WholeRange; optional?: boolean };
type Rules = { money: MoneyRule[]; whole: WholeRule[] };

const fixed = (range: WholeRange) => () => range;

/** Per record type, the fields a form checks, by the CSV column a person sees. */
export const FORM_RULES: Record<string, Rules> = {
  profile: {
    money: [
      {
        column: "prior_year_total_tax",
        key: "priorYearTotalTaxCents",
        floor: "nonNegative",
        optional: true,
      },
      { column: "prior_year_agi", key: "priorYearAgiCents", floor: "nonNegative", optional: true },
      {
        column: "prior_year_state_tax",
        key: "priorYearStateTaxCents",
        floor: "nonNegative",
        optional: true,
      },
    ],
    whole: [
      { column: "dependents", key: "dependents", range: fixed(WHOLE_RANGES.dependents) },
      { column: "prep_lead_days", key: "prepLeadDays", range: fixed(WHOLE_RANGES.leadDays) },
    ],
  },
  spouse: {
    money: [
      { column: "annual_w2_wages", key: "annualW2WagesCents", floor: "nonNegative" },
      {
        column: "annual_federal_withholding",
        key: "annualFederalWithholdingCents",
        floor: "nonNegative",
      },
      {
        column: "annual_state_withholding",
        key: "annualStateWithholdingCents",
        floor: "nonNegative",
      },
    ],
    whole: [],
  },
  client: {
    money: [
      { column: "default_hourly_rate", key: "defaultRateCents", floor: "positive", optional: true },
    ],
    whole: [],
  },
  income: { money: [{ column: "amount", key: "amountCents", floor: "positive" }], whole: [] },
  // The time form takes more than 0 and at most 24 hours.
  time_entry: {
    money: [],
    whole: [{ column: "minutes", key: "minutes", range: fixed({ min: 1, max: 24 * 60 }) }],
  },
  vehicle: {
    money: [],
    whole: [
      { column: "model_year", key: "year", range: () => vehicleYearRange(), optional: true },
      { column: "mpg", key: "mpg", range: fixed(WHOLE_RANGES.mpg), optional: true },
    ],
  },
  mileage: {
    money: [],
    whole: [
      { column: "business_miles", key: "businessMiles", range: fixed(WHOLE_RANGES.tripMiles) },
    ],
  },
  home_office: {
    money: [
      {
        column: "monthly_rent_mortgage",
        key: "monthlyRentMortgageCents",
        floor: "nonNegative",
        optional: true,
      },
      {
        column: "monthly_utilities",
        key: "monthlyUtilitiesCents",
        floor: "nonNegative",
        optional: true,
      },
      {
        column: "monthly_insurance",
        key: "monthlyInsuranceCents",
        floor: "nonNegative",
        optional: true,
      },
    ],
    whole: [
      { column: "office_sqft", key: "officeSqft", range: fixed(WHOLE_RANGES.sqft), optional: true },
      { column: "home_sqft", key: "homeSqft", range: fixed(WHOLE_RANGES.sqft), optional: true },
    ],
  },
  expense: { money: [{ column: "amount", key: "amountCents", floor: "positive" }], whole: [] },
  // Retirement contributions have no form yet, so nothing to match.
  retirement_contribution: { money: [], whole: [] },
  entity: { money: [], whole: [] },
};

const range = ({ min, max }: WholeRange) =>
  `${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}`;

/**
 * What is wrong with one row by the forms' rules, one sentence per field ("amount -$45.00 is
 * negative. The form needs more than $0."). Empty when the row is in range.
 */
export const formRangeProblems = (recordType: string, row: object): string[] => {
  const rules = FORM_RULES[recordType];
  if (!rules) return [];
  const values = row as Record<string, unknown>;
  const problems: string[] = [];
  for (const rule of rules.money) {
    const v = values[rule.key];
    if (v === null || v === undefined) continue;
    const c = v as Cents;
    const verdict = checkAmountRange(c, rule.floor);
    if (verdict === null) continue;
    const shown = `${rule.column} ${formatUSD(c)}`;
    if (verdict === "too_large") {
      problems.push(
        `${shown} is ${formatUSD(AMOUNT_CEILING_CENTS).replace(".00", "")} or more. The form needs less than that.`,
      );
    } else {
      const what = c < 0 ? "is negative" : "is $0";
      const needs = rule.floor === "positive" ? "more than $0" : "$0 or more";
      problems.push(`${shown} ${what}. The form needs ${needs}.`);
    }
  }
  for (const rule of rules.whole) {
    const v = values[rule.key];
    if (v === null || v === undefined) continue;
    const n = v as number;
    const r = rule.range();
    if (inWholeRange(n, r)) continue;
    const what = n < 0 ? "is negative" : `is outside ${range(r)}`;
    problems.push(`${rule.column} ${n} ${what}. The form needs ${range(r)}.`);
  }
  return problems;
};

/** The record type of each bundle table, as the CSV names it. */
export const TABLE_RECORD_TYPES = {
  entities: "entity",
  spouses: "spouse",
  clients: "client",
  income: "income",
  timeEntries: "time_entry",
  vehicles: "vehicle",
  mileage: "mileage",
  homeOffice: "home_office",
  expenses: "expense",
  retirementContributions: "retirement_contribution",
} as const satisfies Partial<Record<keyof Bundle, string>>;
