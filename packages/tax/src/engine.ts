import type { EntityType, QuarterlyMethod } from "@fiscode/core";
import { cents, clampMinZero, subCents } from "@fiscode/core";
import { computeStatePrepayment } from "./state-prepayment.ts";
import { getYearConfig } from "./config/index.ts";
import { installmentsRequired } from "./installments.ts";
import { computeSafeHarbor } from "./safe-harbor.ts";
import { strategyFor } from "./strategy/index.ts";
import type {
  AnnualizedInput,
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
};

export type EstimateArgs = {
  entity: EntityType;
  method: QuarterlyMethod;
  input: TaxInput | AnnualizedInput;
};

export const estimateYear = ({ entity, method, input }: EstimateArgs): EstimateResult => {
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
  return { estimate, quarterly, safeHarbor, statePrepayment };
};
