import {
  type Cents,
  type IsoDate,
  cents,
  isoDate,
  shiftToBusinessDay,
  yearOf,
} from "@fiscode/core";
import { paymentsAfterWithholding, regularInstallments } from "./installments.ts";
import type { QuarterPayment, QuarterlyPlan, TaxEstimate, YearConfig } from "./types.ts";

// Uneven IRS quarters: Q1 Jan-Mar, Q2 Apr-May, Q3 Jun-Aug, Q4 Sep-Dec.
export const quarterPeriods = (year: number): Array<{ start: IsoDate; end: IsoDate }> => [
  { start: isoDate(`${year}-01-01`), end: isoDate(`${year}-03-31`) },
  { start: isoDate(`${year}-04-01`), end: isoDate(`${year}-05-31`) },
  { start: isoDate(`${year}-06-01`), end: isoDate(`${year}-08-31`) },
  { start: isoDate(`${year}-09-01`), end: isoDate(`${year}-12-31`) },
];

/**
 * Regular installments (Form 2210 line 10): 25% of the required annual
 * payment each quarter, then what is left to pay after the year's withholding
 * (a quarter of it counted on each due date). See installments.ts.
 */
export const evenQuarterly = (
  estimate: TaxEstimate,
  cfg: YearConfig,
  requiredAnnualPayment: Cents,
): QuarterlyPlan => {
  const periods = quarterPeriods(estimate.year);
  const required = regularInstallments(requiredAnnualPayment);
  // Federal withholding only (Form 2210 line 6); state withholding never offsets IRS installments.
  const toPay = paymentsAfterWithholding(required, estimate.federalWithholding);
  const payments = periods.map((p, i): QuarterPayment => ({
    quarter: (i + 1) as 1 | 2 | 3 | 4,
    periodStart: p.start,
    periodEnd: p.end,
    dueDate: shiftToBusinessDay(cfg.quarterlyDueDates[i]!),
    requiredInstallment: required[i]!,
    amount: toPay[i]!,
  }));
  return {
    method: "even",
    noInstallmentsRequired: false,
    payments: payments as QuarterlyPlan["payments"],
  };
};

/** Next due quarter relative to `today`. Returns undefined when all are past. */
export const nextDueQuarter = (plan: QuarterlyPlan, today: IsoDate): QuarterPayment | undefined => {
  for (const p of plan.payments) {
    if (p.dueDate >= today) return p;
  }
  return undefined;
};

/** A recommended "start preparing" date = dueDate - leadDays. */
export const recommendedPrepDate = (due: IsoDate, leadDays: number): IsoDate => {
  const [y, m, d] = due.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! - leadDays);
  return isoDate(
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
  );
};

export const yearFromPlan = (plan: QuarterlyPlan): number => yearOf(plan.payments[0].periodStart);

export const zeroPayment = (year: number, q: 1 | 2 | 3 | 4, cfg: YearConfig): QuarterPayment => {
  const periods = quarterPeriods(year);
  const p = periods[q - 1]!;
  return {
    quarter: q,
    periodStart: p.start,
    periodEnd: p.end,
    dueDate: shiftToBusinessDay(cfg.quarterlyDueDates[q - 1]!),
    requiredInstallment: cents(0),
    amount: cents(0),
  };
};
