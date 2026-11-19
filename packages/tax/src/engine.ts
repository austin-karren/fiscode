import type { EntityType, QuarterlyMethod } from "@fiscode/core";
import { cents } from "@fiscode/core";
import { getYearConfig } from "./config/index.ts";
import { installmentsRequired } from "./installments.ts";
import { computeSafeHarbor } from "./safe-harbor.ts";
import { strategyFor } from "./strategy/index.ts";
import type {
  AnnualizedInput,
  QuarterlyPlan,
  SafeHarborResult,
  TaxEstimate,
  TaxInput,
} from "./types.ts";

export type EstimateResult = {
  estimate: TaxEstimate;
  quarterly: QuarterlyPlan;
  safeHarbor: SafeHarborResult;
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
  const required = installmentsRequired(estimate.remainingOwed);
  const plan = strategy.quarterly(input, cfg, method, required ? safeHarbor.floor : cents(0));
  const quarterly = { ...plan, noInstallmentsRequired: !required };
  return { estimate, quarterly, safeHarbor };
};
