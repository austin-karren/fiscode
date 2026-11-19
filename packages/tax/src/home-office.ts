import { cents, type Cents } from "@fiscode/core";

// Home-office actual-expense method, as Form 8829 figures it.
// Line numbers are from the 2026 draft (https://www.irs.gov/pub/irs-dft/f8829--dft.pdf,
// created 4/15/26), which match the 2025 instructions (https://www.irs.gov/instructions/i8829).

export type ActualHomeOfficeInput = {
  officeSqft: number | null;
  homeSqft: number | null;
  monthlyRentMortgageCents: number | null;
  monthlyUtilitiesCents: number | null;
  monthlyInsuranceCents: number | null;
  /** Fractional months the office is in business use within the year (or period). */
  monthsActive: number;
};

/**
 * Business share of the indirect expenses for the months in use.
 * - Line 3: "Divide line 1 by line 2" (office area / total area of home); line 7 is the business percentage.
 * - Lines 18 "Insurance", 19 "Rent", 21 "Utilities", column (b) indirect; line 24 "Multiply line 23,
 *   column (b), by line 7".
 * - Part-year use: "you can deduct only the expenses paid or incurred for the portion of the year you
 *   used your home for business" (i8829, Columns (a) and (b)).
 * An office larger than the home cannot be right, so the config is rejected ($0, flagged).
 */
export const actualHomeOfficeExpenses = (
  input: ActualHomeOfficeInput,
): { amount: Cents; areaRejected: boolean } => {
  const office = input.officeSqft ?? 0;
  const home = input.homeSqft ?? 0;
  if (office <= 0 || home <= 0 || input.monthsActive <= 0) {
    return { amount: cents(0), areaRejected: false };
  }
  if (office > home) return { amount: cents(0), areaRejected: true };
  const monthly =
    (input.monthlyRentMortgageCents ?? 0) +
    (input.monthlyUtilitiesCents ?? 0) +
    (input.monthlyInsuranceCents ?? 0);
  return {
    amount: cents(Math.round((monthly * input.monthsActive * office) / home)),
    areaRejected: false,
  };
};

/**
 * Gross income limit. Line 8: "the amount from Schedule C, line 29" (tentative profit before the
 * home office); line 15: "Subtract line 14 from line 8. If zero or less, enter -0-"; line 27:
 * "Allowable operating expenses. Enter the smaller of line 15 or line 26"; line 43: "Subtract
 * line 27 from line 26" is carried to next year. fiscode stores no carryover, so `disallowed` is
 * reported, not carried.
 */
export const limitToTentativeProfit = (
  expenses: number,
  tentativeProfit: number,
): { allowed: Cents; disallowed: Cents } => {
  const allowed = Math.min(expenses, Math.max(0, tentativeProfit));
  return { allowed: cents(allowed), disallowed: cents(expenses - allowed) };
};
