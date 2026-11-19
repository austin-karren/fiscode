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

export const estimateYear = ({ entity, method, input: given }: EstimateArgs): EstimateResult => {
  const input = spouseOnJointReturn(given);
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
