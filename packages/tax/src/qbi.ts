import { type Cents, cents, clampMinZero, minCents, mulRate } from "@fiscode/core";
import type { FilingStatus } from "@fiscode/core";
import type { YearConfig } from "./types.ts";

/**
 * QBI deduction (sole-prop, non-SSTB).
 *
 * Standard 20% of QBI, capped at 20% of (taxable income before QBI).
 * When taxable income exceeds the limit, wage/W-2 + UBIA limits kick in — we
 * skip that complexity for now and use the unphased deduction. At the threshold
 * the user is well under, so this is conservative-accurate; the seam exists.
 *
 * todo: handle full SSTB / wage-limit phase-in when income exceeds threshold.
 */
export const computeQbi = (
  qualifiedBusinessIncome: Cents,
  taxableIncomeBeforeQbi: Cents,
  filingStatus: FilingStatus,
  cfg: YearConfig,
): Cents => {
  if (qualifiedBusinessIncome <= 0) return cents(0);
  const limit = cfg.qbi.taxableIncomeLimit[filingStatus];
  // 20% of QBI
  const qbiPortion = mulRate(qualifiedBusinessIncome, cfg.qbi.rate);
  // 20% of taxable income (before QBI deduction itself)
  const taxableIncomePortion = mulRate(clampMinZero(taxableIncomeBeforeQbi), cfg.qbi.rate);
  const baseDeduction = minCents(qbiPortion, taxableIncomePortion);
  if (taxableIncomeBeforeQbi <= limit) return baseDeduction;
  // Over the threshold: same baseline for now; the wage/UBIA phase-in is the
  // todo above. Leaving the conservative answer.
  return baseDeduction;
};
