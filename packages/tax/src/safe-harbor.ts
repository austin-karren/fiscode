import { type Cents, minCents, mulRate } from "@fiscode/core";
import type { FilingStatus } from "@fiscode/core";
import type { SafeHarborResult, TaxEstimate, YearConfig } from "./types.ts";

/**
 * Safe-harbor floor: meeting this avoids the underpayment penalty.
 *
 * Either pay 90% of current-year tax, OR 100% of prior-year tax (110% if
 * prior-year AGI exceeded the threshold: $150,000, or $75,000 when this
 * year's filing status is married filing separately). True exemption requires a zero-tax
 * prior year. First-year filers fall back to the 90%-of-current target.
 *
 * Pub 505 (https://www.irs.gov/publications/p505), Required Annual Payment, General rule:
 * "100% of the total tax shown on your 2025 return. Your 2025 tax return must cover all
 * 12 months." Higher Income Taxpayers: "If your AGI for 2025 was more than $150,000 ($75,000
 * if your filing status for 2026 is Married filing a separate return)", "substitute 110% for
 * 100%". AGI "is the amount shown on Form 1040 or 1040-SR, line 11b"; the total tax "is the
 * amount on Form 1040 or 1040–SR, line 24" (reduced by certain refundable credits).
 * Form 2210 instructions (https://www.irs.gov/instructions/i2210): the smaller of "90% of
 * your 2025 tax, or" "100% of your 2024 tax. Your 2024 tax return must cover a 12-month
 * period." `priorYearTotalTax` undefined means no such year: the first-year fallback.
 */
export const computeSafeHarbor = (
  estimate: TaxEstimate,
  priorYearTotalTax: Cents | undefined,
  priorYearAgi: Cents | undefined,
  cfg: YearConfig,
  filingStatus?: FilingStatus,
): SafeHarborResult => {
  // Form 2210 line 5: 90% of this year's federal tax (line 4). State tax has
  // its own rule (see state-prepayment.ts).
  const currentYearTarget = mulRate(estimate.federalLiability, cfg.safeHarbor.currentYearFraction);
  if (priorYearTotalTax === undefined) {
    return {
      currentYearTarget,
      priorYearTarget: undefined,
      floor: currentYearTarget,
      multiplierUsed: undefined,
      firstYear: true,
    };
  }
  const threshold =
    filingStatus === "mfs"
      ? cfg.safeHarbor.priorYearAgiThresholdMfs
      : cfg.safeHarbor.priorYearAgiThreshold;
  const highIncome = priorYearAgi !== undefined && priorYearAgi > threshold;
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
