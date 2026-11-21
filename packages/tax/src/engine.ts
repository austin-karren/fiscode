import type { EntityType, QuarterlyMethod } from "@fiscode/core";
import { type Cents, cents, clampMinZero, defaultAppliedQuarter, subCents } from "@fiscode/core";
import { computeStatePrepayment } from "./state-prepayment.ts";
import { getYearConfig } from "./config/index.ts";
import { estimatesByDueDate, installmentsRequired, regularInstallments } from "./installments.ts";
import { computeSafeHarbor } from "./safe-harbor.ts";
import { strategyFor } from "./strategy/index.ts";
import type {
  AnnualizedInput,
  PaymentsResult,
  QuarterPaid,
  QuarterlyPlan,
  SafeHarborResult,
  StatePrepayment,
  TaxEstimate,
  TaxInput,
} from "./types.ts";

export type EstimateResult = {
  estimate: TaxEstimate;
  quarterly: QuarterlyPlan;
  safeHarbor: SafeHarborResult;
  /** Utah's prepayment minimum (separate from the IRS quarterly plan). */
  statePrepayment: StatePrepayment | undefined;
  /** What has been paid (withholding and estimated payments) against what is required. */
  payments: PaymentsResult;
};

export type EstimateArgs = {
  entity: EntityType;
  method: QuarterlyMethod;
  input: TaxInput | AnnualizedInput;
};

/**
 * A spouse's W-2 wages and withholding belong on a joint return only. A
 * single, head-of-household or married-filing-separately return reports the
 * filer's own income and withholding (each spouse files their own when
 * married filing separately). This is the one place the engine takes its
 * input, so the 1040 estimate, the Form 2210 installments (both methods),
 * the safe harbor and Utah's prepayment all see the same amounts.
 */
const spouseOnJointReturn = <T extends TaxInput>(input: T): T =>
  input.filingStatus === "mfj"
    ? input
    : {
        ...input,
        spouseW2Wages: cents(0),
        spouseFederalWithholding: cents(0),
        spouseStateWithholding: cents(0),
      };

/**
 * No return filed for last year: the prior-year amount does not exist (Form 2210 line 8, "If you
 * didn't file a return for 2024 or your 2024 tax year was less than 12 months, don't complete
 * line 8", https://www.irs.gov/instructions/i2210). Federal and Utah figures are ignored.
 */
const withoutPriorYearIfNotFiled = <T extends TaxInput>(input: T): T =>
  input.priorYearNotFiled
    ? {
        ...input,
        priorYearTotalTax: undefined,
        priorYearAgi: undefined,
        priorYearStateTax: undefined,
      }
    : input;

export const estimateYear = ({ entity, method, input: given }: EstimateArgs): EstimateResult => {
  const input = withoutPriorYearIfNotFiled(spouseOnJointReturn(given));
  const cfg = getYearConfig(input.year);
  const strategy = strategyFor(entity);
  const estimate = strategy.compute(input, cfg);
  const safeHarbor = computeSafeHarbor(
    estimate,
    input.priorYearTotalTax,
    input.priorYearAgi,
    cfg,
    input.filingStatus,
  );
  // Form 2210 line 9: the required annual payment is the safe-harbor floor.
  // Under $1,000 left after withholding, none is required (lines 4 and 7).
  // Federal tax after federal withholding only (Form 2210 lines 4, 6, 7).
  const required = installmentsRequired(
    clampMinZero(subCents(estimate.federalLiability, estimate.federalWithholding)),
  );
  const plan = strategy.quarterly(input, cfg, method, required ? safeHarbor.floor : cents(0));
  const quarterly = { ...plan, noInstallmentsRequired: !required };
  const statePrepayment = computeStatePrepayment(input, estimate, cfg);
  const priorYearBasis = given.priorYearNotFiled
    ? "not_filed"
    : input.priorYearTotalTax === undefined
      ? "not_entered"
      : "entered";
  return {
    estimate,
    quarterly,
    safeHarbor: { ...safeHarbor, priorYearBasis },
    statePrepayment,
    payments: paymentsFor(input, estimate, quarterly, safeHarbor.floor, statePrepayment),
  };
};

const sumOf = (ps: readonly { amount: Cents }[]): Cents =>
  ps.reduce((s, p) => cents(s + p.amount), cents(0));

/**
 * Paid so far against what is required (DF-07). Federal: withholding counts a quarter on each due
 * date (Form 2210 instructions: "considered to have paid one-fourth of these amounts on each
 * payment due date") and estimates on the date paid; each quarter's shortfall is the cumulative
 * required less the cumulative paid by its due date. No penalty is figured.
 */
const paymentsFor = (
  input: TaxInput,
  estimate: TaxEstimate,
  quarterly: QuarterlyPlan,
  floor: Cents,
  statePrepayment: StatePrepayment | undefined,
): PaymentsResult => {
  const federal = input.estimatedPayments?.federal ?? [];
  const dues = quarterly.payments.map((p) => p.dueDate) as unknown as [
    string,
    string,
    string,
    string,
  ];
  const withholdingShare = regularInstallments(estimate.federalWithholding);
  const byDue = estimatesByDueDate(federal, dues);
  let required = cents(0);
  let paid = cents(0);
  const quarters = quarterly.payments.map((p, i): QuarterPaid => {
    required = cents(required + (quarterly.noInstallmentsRequired ? 0 : p.requiredInstallment));
    paid = cents(paid + withholdingShare[i]! + byDue[i]!);
    return {
      quarter: p.quarter,
      dueDate: p.dueDate,
      requiredThrough: required,
      paidByDueDate: paid,
      shortfall: clampMinZero(subCents(required, paid)),
      paidAppliedHere: sumOf(
        federal.filter(
          (e) => (e.appliedQuarter ?? defaultAppliedQuarter(e.date, input.year)) === p.quarter,
        ),
      ),
    };
  }) as PaymentsResult["federal"]["quarters"];
  const estimates = sumOf(federal);
  const totalPaid = cents(estimate.federalWithholding + estimates);
  const target = quarterly.noInstallmentsRequired ? cents(0) : floor;
  const stateEstimates = sumOf(input.estimatedPayments?.state ?? []);
  return {
    federal: {
      withholding: estimate.federalWithholding,
      estimates,
      totalPaid,
      target,
      remaining: clampMinZero(subCents(target, totalPaid)),
      quarters,
      safeHarborMet: quarters.every((q) => q.shortfall === 0),
    },
    state: statePrepayment
      ? {
          withholding: estimate.stateWithholding,
          estimates: stateEstimates,
          totalPaid: cents(estimate.stateWithholding + stateEstimates),
          minimumBeforePayments: statePrepayment.line5 ?? cents(0),
          remaining: statePrepayment.minimum,
          dueDate: statePrepayment.dueDate,
        }
      : undefined,
  };
};
