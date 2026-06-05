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
 */
export const computeSeTax = (
  netProfit: Cents,
  filingStatus: FilingStatus,
  cfg: YearConfig,
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
  const ssBase = Math.min(netSeEarnings, cfg.ssWageBase) as Cents;
  const socialSecurityTax = mulRate(ssBase, cfg.seTax.ssRate);
  const medicareTax = mulRate(netSeEarnings, cfg.seTax.medicareRate);
  const addlThreshold = cfg.seTax.addlMedicareThreshold[filingStatus];
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
