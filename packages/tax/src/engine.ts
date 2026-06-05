import type { EntityType, QuarterlyMethod } from "@fiscode/core";
import { getYearConfig } from "./config/index.ts";
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
  const quarterly = strategy.quarterly(input, cfg, method);
  const safeHarbor = computeSafeHarbor(estimate, input.priorYearTotalTax, input.priorYearAgi, cfg);
  return { estimate, quarterly, safeHarbor };
};
