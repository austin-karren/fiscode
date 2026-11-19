import { type Cents, cents, clampMinZero, mulRate, subCents } from "@fiscode/core";

// Required estimated-tax installments and what is left to pay after
// withholding, following Form 2210. The 2026 edition is not posted yet; the
// line numbers and wording are from the 2025 edition:
//   Form:         https://www.irs.gov/pub/irs-pdf/f2210.pdf
//   Instructions: https://www.irs.gov/pub/irs-pdf/i2210.pdf

export type Four<T> = [T, T, T, T];

/** Schedule AI line 20: the cumulative share required by each due date. */
export const APPLICABLE_PERCENTAGES: Four<number> = [0.225, 0.45, 0.675, 0.9];

/**
 * Regular installments, Form 2210 line 10: "enter 25% (0.25) of line 9 ... in
 * each column", line 9 being the required annual payment. The last quarter
 * takes the rounding so the four add up to line 9 exactly.
 */
export const regularInstallments = (requiredAnnualPayment: Cents): Four<Cents> => {
  const quarter = mulRate(requiredAnnualPayment, 0.25);
  const last = subCents(requiredAnnualPayment, cents(quarter * 3));
  return [quarter, quarter, quarter, clampMinZero(last)];
};

/**
 * Annualized income installments, Schedule AI lines 21-27, for each period:
 *   21 = annualized tax × applicable percentage
 *   22 = total of line 27 in all previous columns
 *   23 = line 21 − line 22, not below zero (an earlier reduction is recaptured)
 *   24 = 25% of the required annual payment
 *   25 = line 26 − line 27 of the previous column (the unused regular amount)
 *   26 = line 24 + line 25
 *   27 = "the smaller of line 23 or line 26"
 * `annualizedTax` is line 19 for each period: the year's tax figured on the
 * period's income annualized, before withholding.
 */
export const scheduleAiInstallments = (
  annualizedTax: Four<Cents>,
  requiredAnnualPayment: Cents,
): Four<Cents> => {
  const line24 = regularInstallments(requiredAnnualPayment);
  const out: Cents[] = [];
  let paidSoFar = cents(0);
  let prev26 = cents(0);
  let prev27 = cents(0);
  for (let i = 0; i < 4; i++) {
    const line21 = mulRate(annualizedTax[i]!, APPLICABLE_PERCENTAGES[i]!);
    const line23 = clampMinZero(subCents(line21, paidSoFar));
    const line25 = i === 0 ? cents(0) : subCents(prev26, prev27);
    const line26 = cents(line24[i]! + line25);
    const line27 = line23 < line26 ? line23 : line26;
    out.push(line27);
    paidSoFar = cents(paidSoFar + line27);
    prev26 = line26;
    prev27 = line27;
  }
  return out as Four<Cents>;
};

/**
 * What is left to pay each quarter once withholding is counted, following
 * Form 2210 Part III lines 11-18: withholding is "considered to have paid
 * one-fourth of these amounts on each payment due date" (instructions), and
 * any amount paid beyond an installment carries to the next one.
 */
export const paymentsAfterWithholding = (
  installments: Four<Cents>,
  withholding: Cents,
): Four<Cents> => {
  const perQuarter = regularInstallments(withholding);
  const out: Cents[] = [];
  let carry = cents(0);
  for (let i = 0; i < 4; i++) {
    const available = cents(perQuarter[i]! + carry);
    const due = installments[i]!;
    out.push(clampMinZero(subCents(due, available)));
    carry = clampMinZero(subCents(available, due));
  }
  return out as Four<Cents>;
};
