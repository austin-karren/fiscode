import { type Cents, minCents, mulRate } from "@fiscode/core";
import type { SafeHarborResult, TaxEstimate, YearConfig } from "./types.ts";

/**
 * Safe-harbor floor: meeting this avoids the underpayment penalty.
 *
 * Either pay 90% of current-year tax, OR 100% of prior-year tax (110% if
 * prior-year AGI exceeded the threshold). True exemption requires a zero-tax
 * prior year. First-year filers fall back to the 90%-of-current target.
 */
export const computeSafeHarbor = (
  estimate: TaxEstimate,
  priorYearTotalTax: Cents | undefined,
  priorYearAgi: Cents | undefined,
  cfg: YearConfig,
): SafeHarborResult => {
  const currentYearTarget = mulRate(estimate.totalLiability, cfg.safeHarbor.currentYearFraction);
  if (priorYearTotalTax === undefined) {
    return {
      currentYearTarget,
      priorYearTarget: undefined,
      floor: currentYearTarget,
      multiplierUsed: undefined,
      firstYear: true,
    };
  }
  const highIncome =
    priorYearAgi !== undefined && priorYearAgi > cfg.safeHarbor.priorYearAgiThreshold;
  const multiplier = highIncome
    ? cfg.safeHarbor.priorYearHighIncome
    : cfg.safeHarbor.priorYearDefault;
  const priorYearTarget = mulRate(priorYearTotalTax, multiplier);
  const floor = minCents(currentYearTarget, priorYearTarget);
  return {
    currentYearTarget,
    priorYearTarget,
    floor,
    multiplierUsed: multiplier,
    firstYear: false,
  };
};
