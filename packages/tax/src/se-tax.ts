import { type Cents, addCents, cents, clampMinZero, mulRate, subCents } from "@fiscode/core";
import type { SeTaxBreakdown, YearConfig } from "./types.ts";
import type { FilingStatus } from "@fiscode/core";

/**
 * Self-employment tax for a sole proprietor.
 *
 * Net SE earnings = net profit × 0.9235.
 * Social Security: 12.4% up to the SS wage base.
 * Medicare: 2.9% uncapped.
 * Additional Medicare: 0.9% on earnings over the filing-status threshold.
 * Half of (SS + Medicare) is deductible above the line; the 0.9% surtax is NOT.
 *
 * With W-2 wages of the filer's own (DF-07):
 * - Social Security: the wage base left for SE earnings is the base less Social Security wages
 *   and tips. 2026 Schedule SE (https://www.irs.gov/pub/irs-pdf/f1040sse.pdf): line 8a "Total
 *   social security wages and tips (total of boxes 3 and 7 on Form(s) W-2)"; line 9 "Subtract
 *   line 8d from line 7. If zero or less, enter -0-"; line 10 "Multiply the smaller of line 6 or
 *   line 9 by 12.4% (0.124)". Lines 8b-8c (Forms 4137, 8919) are not modelled.
 * - Additional Medicare: "the threshold amount for applying Additional Medicare Tax on the
 *   self-employment income is reduced (but not below zero) by the total amount of Medicare
 *   wages received" (https://www.irs.gov/instructions/i8959). The 0.9% on the wages themselves
 *   (Form 8959 Part I) is not modelled.
 */
export const computeSeTax = (
  netProfit: Cents,
  filingStatus: FilingStatus,
  cfg: YearConfig,
  w2: { ssWages?: Cents; medicareWages?: Cents } = {},
): SeTaxBreakdown => {
  if (netProfit <= 0) {
    return {
      netSeEarnings: cents(0),
      socialSecurityTax: cents(0),
      medicareTax: cents(0),
      additionalMedicareTax: cents(0),
      regularSeTax: cents(0),
      totalSeTax: cents(0),
      halfSeTaxDeduction: cents(0),
    };
  }
  const netSeEarnings = mulRate(netProfit, cfg.seTax.netEarningsFactor);
  const baseLeft = clampMinZero(subCents(cfg.ssWageBase, w2.ssWages ?? cents(0)));
  const ssBase = Math.min(netSeEarnings, baseLeft) as Cents;
  const socialSecurityTax = mulRate(ssBase, cfg.seTax.ssRate);
  const medicareTax = mulRate(netSeEarnings, cfg.seTax.medicareRate);
  const addlThreshold = clampMinZero(
    subCents(cfg.seTax.addlMedicareThreshold[filingStatus], w2.medicareWages ?? cents(0)),
  );
  const overThreshold = clampMinZero(subCents(netSeEarnings, addlThreshold));
  const additionalMedicareTax = mulRate(overThreshold, cfg.seTax.addlMedicareRate);
  const regularSeTax = addCents(socialSecurityTax, medicareTax);
  const totalSeTax = addCents(regularSeTax, additionalMedicareTax);
  const halfSeTaxDeduction = mulRate(regularSeTax, 0.5);
  return {
    netSeEarnings,
    socialSecurityTax,
    medicareTax,
    additionalMedicareTax,
    regularSeTax,
    totalSeTax,
    halfSeTaxDeduction,
  };
};
