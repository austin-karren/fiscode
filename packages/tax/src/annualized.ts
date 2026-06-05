import {
  type Cents,
  type IsoDate,
  cents,
  clampMinZero,
  mulRate,
  shiftToBusinessDay,
  subCents,
} from "@fiscode/core";
import type {
  AnnualizedInput,
  IncomePeriod,
  QuarterPayment,
  QuarterlyPlan,
  TaxEstimate,
  YearConfig,
} from "./types.ts";
import type { TaxStrategy } from "./strategy/types.ts";

// IRS-style annualization fractions for sole props. Periods are cumulative:
// Q1: 3 mo, Q2: 5 mo, Q3: 8 mo, Q4: 12 mo. Annualize by 12/months. Required
// quarterly installments cumulate 22.5% / 45% / 67.5% / 90% of annual tax.
const ANNUALIZATION_FACTORS: [number, number, number, number] = [4, 2.4, 1.5, 1];
const CUMULATIVE_FRACTIONS: [number, number, number, number] = [0.225, 0.45, 0.675, 0.9];

const dueDates = (cfg: YearConfig): [IsoDate, IsoDate, IsoDate, IsoDate] => [
  shiftToBusinessDay(cfg.quarterlyDueDates[0]),
  shiftToBusinessDay(cfg.quarterlyDueDates[1]),
  shiftToBusinessDay(cfg.quarterlyDueDates[2]),
  shiftToBusinessDay(cfg.quarterlyDueDates[3]),
];

const periodsForYear = (year: number): Array<{ start: IsoDate; end: IsoDate }> => [
  { start: `${year}-01-01` as IsoDate, end: `${year}-03-31` as IsoDate },
  { start: `${year}-04-01` as IsoDate, end: `${year}-05-31` as IsoDate },
  { start: `${year}-06-01` as IsoDate, end: `${year}-08-31` as IsoDate },
  { start: `${year}-09-01` as IsoDate, end: `${year}-12-31` as IsoDate },
];

/**
 * Annualized income installment method. For each period, estimate the full-year
 * tax as-if income through that period continued at the same rate, then take
 * the cumulative-required fraction (22.5% / 45% / 67.5% / 90%) minus what was
 * already required in prior periods.
 *
 * `strategy.compute` is reused on a scaled TaxInput so the math is consistent
 * with the year-end calculation.
 */
export const annualizedQuarterly = (
  input: AnnualizedInput,
  cfg: YearConfig,
  strategy: TaxStrategy,
): QuarterlyPlan => {
  const dues = dueDates(cfg);
  const periods = periodsForYear(input.year);
  const requiredCumulative = input.periods.map((p: IncomePeriod, i: number): Cents => {
    const factor = ANNUALIZATION_FACTORS[i]!;
    const annualizedGross = mulRate(p.cumulativeGross1099, factor);
    const annualizedExpenses = mulRate(p.cumulativeDeductibleExpenses, factor);
    const annualizedEstimate: TaxEstimate = strategy.compute(
      {
        ...input,
        gross1099: annualizedGross,
        deductibleExpenses: annualizedExpenses,
      },
      cfg,
    );
    const requiredAnnual = annualizedEstimate.remainingOwed;
    return mulRate(requiredAnnual, CUMULATIVE_FRACTIONS[i]!);
  });
  let prior = cents(0);
  const payments: QuarterPayment[] = [];
  for (let i = 0; i < 4; i++) {
    const required = requiredCumulative[i]!;
    const installment = clampMinZero(subCents(required, prior));
    payments.push({
      quarter: (i + 1) as 1 | 2 | 3 | 4,
      periodStart: periods[i]!.start,
      periodEnd: periods[i]!.end,
      dueDate: dues[i]!,
      amount: installment,
    });
    prior = required;
  }
  return {
    method: "annualized",
    payments: payments as QuarterlyPlan["payments"],
  };
};
