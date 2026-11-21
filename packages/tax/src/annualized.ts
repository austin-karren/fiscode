import { type Cents, type IsoDate, mulRate, shiftToBusinessDay } from "@fiscode/core";
import {
  type Four,
  estimatesByDueDate,
  paymentsAfterWithholding,
  scheduleAiInstallments,
} from "./installments.ts";
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
// Q1: 3 mo, Q2: 5 mo, Q3: 8 mo, Q4: 12 mo. Annualize by 12/months (Schedule AI
// line 2: 4, 2.4, 1.5, 1).
const ANNUALIZATION_FACTORS: [number, number, number, number] = [4, 2.4, 1.5, 1];

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
 * Annualized income installment method (Form 2210 Schedule AI). For each
 * period, the year's tax is figured as if the income through that period
 * continued at the same rate (line 19, before withholding). Each required
 * installment is the smaller of the annualized amount, with any earlier
 * reduction recaptured, and the regular 25% installment plus what earlier
 * regular installments left unused (lines 21-27; see installments.ts). Then
 * withholding counts as paid one quarter per due date.
 *
 * `strategy.compute` is reused on a scaled TaxInput so the math is consistent
 * with the year-end calculation.
 */
export const annualizedQuarterly = (
  input: AnnualizedInput,
  cfg: YearConfig,
  strategy: TaxStrategy,
  requiredAnnualPayment: Cents,
): QuarterlyPlan => {
  const dues = dueDates(cfg);
  const periods = periodsForYear(input.year);
  const annualizedTax = input.periods.map((p: IncomePeriod, i: number): Cents => {
    const factor = ANNUALIZATION_FACTORS[i]!;
    const estimate: TaxEstimate = strategy.compute(
      {
        ...input,
        gross1099: mulRate(p.cumulativeGross1099, factor),
        deductibleExpenses: mulRate(p.cumulativeDeductibleExpenses, factor),
        selfEmployedHealthInsurance: mulRate(
          p.cumulativeSelfEmployedHealthInsurance ?? (0 as Cents),
          factor,
        ),
      },
      cfg,
    );
    // Schedule AI line 19 is federal: income tax + SE tax, no state tax.
    return estimate.federalLiability;
  }) as Four<Cents>;
  const required = scheduleAiInstallments(annualizedTax, requiredAnnualPayment);
  // Federal withholding: the spouse's (joint return only; see engine.ts) and the filer's own.
  // Estimated payments count from the date paid (DF-07).
  const withholding = (input.spouseFederalWithholding +
    (input.ownW2?.federalWithholding ?? 0)) as Cents;
  const toPay = paymentsAfterWithholding(
    required,
    withholding,
    estimatesByDueDate(input.estimatedPayments?.federal ?? [], dues),
  );
  const payments = periods.map((period, i): QuarterPayment => ({
    quarter: (i + 1) as 1 | 2 | 3 | 4,
    periodStart: period.start,
    periodEnd: period.end,
    dueDate: dues[i]!,
    requiredInstallment: required[i]!,
    amount: toPay[i]!,
  }));
  return {
    method: "annualized",
    noInstallmentsRequired: false,
    payments: payments as QuarterlyPlan["payments"],
  };
};
