import { type Cents, cents, clampMinZero, mulRate, subCents } from "@fiscode/core";

// Required estimated-tax installments and what is left to pay after
// withholding, following Form 2210. Every line used here reads the same in
// the 2025 final form and the 2026 draft (created 4/16/26; Schedule AI's QBI
// line is renumbered 9 → 9a, no other change to these lines):
//   2025 form:         https://www.irs.gov/pub/irs-pdf/f2210.pdf
//   2026 draft form:   https://www.irs.gov/pub/irs-dft/f2210--dft.pdf
//   Instructions:      https://www.irs.gov/pub/irs-pdf/i2210.pdf (2025; the
//                      posted draft instructions are still the 2025 edition)

/**
 * Form 2210 line 7: "Subtract line 6 from line 4. If less than $1,000, stop;
 * you don't owe a penalty." (Line 4 says the same of the tax before
 * withholding, which line 7 already covers.) Under it, no installment is
 * required. It counts federal tax and federal withholding only, as the form
 * does; Utah's prepayment is separate (state-prepayment.ts).
 */
export const NO_PENALTY_THRESHOLD = cents(1_000_00);

export const installmentsRequired = (taxAfterWithholding: Cents): boolean =>
  taxAfterWithholding >= NO_PENALTY_THRESHOLD;

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
  /** Estimated payments credited at each due date (`estimatesByDueDate`). */
  estimates: Four<Cents> = [cents(0), cents(0), cents(0), cents(0)],
): Four<Cents> => {
  const perQuarter = regularInstallments(withholding);
  const out: Cents[] = [];
  let carry = cents(0);
  for (let i = 0; i < 4; i++) {
    const available = cents(perQuarter[i]! + estimates[i]! + carry);
    const due = installments[i]!;
    out.push(clampMinZero(subCents(due, available)));
    carry = clampMinZero(subCents(available, due));
  }
  return out as Four<Cents>;
};

/**
 * Estimated payments by the due date they count toward: each at the first due date on or after
 * the day it was paid. Pub 505 (https://www.irs.gov/publications/p505): "If a payment is mailed,
 * the date of the U.S. postmark is considered the date of payment." A payment after the last due
 * date counts toward none (it is still paid; see `PaymentsResult.federal.totalPaid`).
 */
export const estimatesByDueDate = (
  payments: readonly { date: string; amount: Cents }[],
  dueDates: readonly [string, string, string, string],
): Four<Cents> => {
  const out: Four<Cents> = [cents(0), cents(0), cents(0), cents(0)];
  for (const p of payments) {
    const i = dueDates.findIndex((due) => p.date <= due);
    if (i >= 0) out[i] = cents(out[i]! + p.amount);
  }
  return out;
};
