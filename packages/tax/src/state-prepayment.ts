import {
  type Cents,
  clampMinZero,
  isoDate,
  mulRate,
  shiftToBusinessDay,
  subCents,
} from "@fiscode/core";
import type { StatePrepayment, TaxEstimate, TaxInput, YearConfig } from "./types.ts";

/**
 * Utah's prepayment minimum. Utah has no quarterly schedule and no $1,000
 * test. TC-546 (Rev. 10/26), https://files.tax.utah.gov/tax/forms/current/tc-546.pdf:
 *   line 3: 90% of the tax "you expect to owe this year"
 *   line 4: "Last year's Utah tax liability"
 *   line 5: "Minimum tax due by original due date - enter the lesser of line 3
 *           or line 4"
 *   line 8: line 5 − this year's Utah withholding − prepayments; "If less than
 *           zero, a payment is not due at this time."
 * Unpaid by then: "a penalty equal to 2 percent of the unpaid tax for each
 * month of the extension period".
 *
 * fiscode has no input for last year's Utah tax or Utah prepayments, so it
 * uses line 3 (90% of this year's) and no prepayments.
 *
 * Due date: "on or before the return due date"; the Utah return is due "on or
 * before the day on which a federal individual income tax return is due"
 * (Utah Code 59-10-514(1)(a)(i),
 * https://le.utah.gov/xcode/Title59/Chapter10/59-10-S514.html), April 15 of
 * the next year, moved to the next business day.
 */
export const computeStatePrepayment = (
  input: TaxInput,
  estimate: TaxEstimate,
  cfg: YearConfig,
): StatePrepayment | undefined => {
  if (input.state !== "UT") return undefined;
  const line3: Cents = mulRate(estimate.state.stateIncomeTax, cfg.safeHarbor.currentYearFraction);
  return {
    state: "UT",
    dueDate: shiftToBusinessDay(isoDate(`${input.year + 1}-04-15`)),
    minimum: clampMinZero(subCents(line3, estimate.stateWithholding)),
    basis: "currentYear90",
  };
};
