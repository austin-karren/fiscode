import { type Cents, cents, clampMinZero, minCents, mulRate, subCents } from "@fiscode/core";
import type { FilingStatus } from "@fiscode/core";
import type { YearConfig } from "./types.ts";

/**
 * QBI deduction for a sole proprietor (non-SSTB) with no W-2 wages and no
 * qualified property, per 26 U.S.C. 199A, https://uscode.house.gov (release point through Pub. L. 119-142):
 *
 * - (b)(2): 20% of QBI, limited by the W-2 wage / property amount, which is $0
 *   here because fiscode models neither.
 * - (b)(3)(A): at or below the threshold that limit does not apply.
 * - (b)(3)(B): inside the phase-in band, 20% of QBI is reduced by its excess
 *   over the limit ($0) times (taxable income − threshold) / band. At or above
 *   the band's end the limit ($0) applies in full.
 * - (a): the result is at most 20% of taxable income before the deduction.
 * - (i), 2026 on: with at least $1,000 of QBI, the deduction is the greater of
 *   the above and $400 (it replaces the whole (a) amount, so the taxable-income
 *   cap does not lower it). The minimum counts only QBI from an "active"
 *   business, one the taxpayer materially participates in (§199A(i)(2),
 *   §469(h)); fiscode assumes the owner does.
 *
 * Not modelled: specified service businesses (§199A(d)), W-2 wages, property.
 * An SSTB above the band has no QBI from a qualified business, so it would get
 * $0 and no minimum; fiscode treats every business as non-SSTB.
 */
export const computeQbi = (
  qualifiedBusinessIncome: Cents,
  taxableIncomeBeforeQbi: Cents,
  filingStatus: FilingStatus,
  cfg: YearConfig,
): Cents => {
  if (qualifiedBusinessIncome <= 0) return cents(0);
  const { rate, taxableIncomeLimit, phaseInRange, minimum } = cfg.qbi;
  const threshold = taxableIncomeLimit[filingStatus];
  const band = phaseInRange[filingStatus];

  const twentyPercent = mulRate(qualifiedBusinessIncome, rate);
  const over = subCents(taxableIncomeBeforeQbi, threshold);
  let component: Cents;
  if (over <= 0) {
    component = twentyPercent;
  } else if (over < band) {
    const reduction = cents(Math.round((twentyPercent * over) / band));
    component = subCents(twentyPercent, reduction);
  } else {
    component = cents(0);
  }

  const deduction = minCents(component, mulRate(clampMinZero(taxableIncomeBeforeQbi), rate));

  if (minimum && qualifiedBusinessIncome >= minimum.qbiFloor && deduction < minimum.deduction) {
    return minimum.deduction;
  }
  return deduction;
};
