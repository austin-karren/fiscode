import { type Cents, addCents, cents, mulRate, subCents } from "@fiscode/core";
import type { FilingStatus } from "@fiscode/core";
import type { Bracket, YearConfig } from "./types.ts";

/**
 * Walk progressive federal brackets and return total tax owed on taxableIncome.
 */
export const computeFederalBracketTax = (
  taxableIncome: Cents,
  filingStatus: FilingStatus,
  cfg: YearConfig,
): Cents => {
  if (taxableIncome <= 0) return cents(0);
  const brackets: Bracket[] = cfg.brackets[filingStatus];
  let tax = cents(0);
  let prevUpper = cents(0);
  for (const b of brackets) {
    const upper = b.upTo ?? (taxableIncome as Cents);
    const cap = upper > taxableIncome ? taxableIncome : upper;
    const slice = subCents(cap, prevUpper);
    if (slice > 0) tax = addCents(tax, mulRate(slice, b.rate));
    if (taxableIncome <= upper) break;
    prevUpper = upper as Cents;
  }
  return tax;
};
