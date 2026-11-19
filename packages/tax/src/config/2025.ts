import { dollars, isoDate } from "@fiscode/core";
import type { YearConfig } from "../types.ts";

// 2025 seed values. todo: verify all figures against IRS / SSA for 2025.
export const config2025: YearConfig = {
  year: 2025,
  // Rev. Proc. 2025-32 §3.01, https://www.irs.gov/pub/irs-drop/rp-25-32.pdf:
  // "Section 63(c)(7) as amended by the OBBBA provides the standard deduction
  // amounts under § 63(c)(2) for any taxable year beginning in 2025": $31,500
  // MFJ, $23,625 HOH, $15,750 single, $15,750 MFS. It replaces Rev. Proc.
  // 2024-40 §2.15(1). (§3.02, the §179 limit, has no key here.)
  standardDeduction: {
    single: dollars(15_750),
    mfj: dollars(31_500),
    mfs: dollars(15_750),
    hoh: dollars(23_625),
  },
  ssWageBase: dollars(176_100),
  seTax: {
    netEarningsFactor: 0.9235,
    ssRate: 0.124,
    medicareRate: 0.029,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: {
      single: dollars(200_000),
      mfj: dollars(250_000),
      mfs: dollars(125_000),
      hoh: dollars(200_000),
    },
  },
  brackets: {
    mfj: [
      { upTo: dollars(23_850), rate: 0.1 },
      { upTo: dollars(96_950), rate: 0.12 },
      { upTo: dollars(206_700), rate: 0.22 },
      { upTo: dollars(394_600), rate: 0.24 },
      { upTo: dollars(501_050), rate: 0.32 },
      { upTo: dollars(751_600), rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
    single: [
      { upTo: dollars(11_925), rate: 0.1 },
      { upTo: dollars(48_475), rate: 0.12 },
      { upTo: dollars(103_350), rate: 0.22 },
      { upTo: dollars(197_300), rate: 0.24 },
      { upTo: dollars(250_525), rate: 0.32 },
      { upTo: dollars(626_350), rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
    mfs: [
      { upTo: dollars(11_925), rate: 0.1 },
      { upTo: dollars(48_475), rate: 0.12 },
      { upTo: dollars(103_350), rate: 0.22 },
      { upTo: dollars(197_300), rate: 0.24 },
      { upTo: dollars(250_525), rate: 0.32 },
      { upTo: dollars(375_800), rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
    hoh: [
      { upTo: dollars(17_000), rate: 0.1 },
      { upTo: dollars(64_850), rate: 0.12 },
      { upTo: dollars(103_350), rate: 0.22 },
      { upTo: dollars(197_300), rate: 0.24 },
      { upTo: dollars(250_500), rate: 0.32 },
      { upTo: dollars(626_350), rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
  },
  qbi: {
    rate: 0.2,
    // Rev. Proc. 2024-40 §.27 (https://www.irs.gov/pub/irs-drop/rp-24-40.pdf):
    // thresholds $197,300 / $394,600 MFJ; phase-in range amounts $247,300 /
    // $494,600 MFJ, so the band is $50,000 / $100,000.
    taxableIncomeLimit: {
      single: dollars(197_300),
      mfj: dollars(394_600),
      mfs: dollars(197_300),
      hoh: dollars(197_300),
    },
    phaseInRange: {
      single: dollars(50_000),
      mfj: dollars(100_000),
      mfs: dollars(50_000),
      hoh: dollars(50_000),
    },
    // No §199A(i) minimum in 2025 (Rev. Proc. 2025-32 §2.12: years after
    // Dec 31, 2025).
    minimum: null,
  },
  mileageRates: [{ from: isoDate("2025-01-01"), ratePerMile: 0.7 }],
  homeOffice: {
    simplifiedRatePerSqft: dollars(5),
    simplifiedMaxSqft: 300,
    simplifiedCap: dollars(1_500),
  },
  safeHarbor: {
    currentYearFraction: 0.9,
    priorYearDefault: 1.0,
    priorYearHighIncome: 1.1,
    priorYearAgiThreshold: dollars(150_000),
    priorYearAgiThresholdMfs: dollars(75_000),
  },
  meals: { deductibleFraction: 0.5 },
  quarterlyDueDates: [
    isoDate("2025-04-15"),
    isoDate("2025-06-16"),
    isoDate("2025-09-15"),
    isoDate("2026-01-15"),
  ],
  stateRates: {
    // 2025 TC-40 (form headed "2025"), line 10: "Utah tax - multiply line 9 by
    // 4.5% (.045)". Read on 2026-11-18 at
    // https://files.tax.utah.gov/tax/forms/current/tc-40.pdf, which is the
    // current-year form and will show the 2026 form once Utah posts it.
    UT: 0.045,
  },
  // 2025 TC-40, lines 9-15: exemption "$2,111"; base "$18,213 (single or
  // married filing separately); $27,320 (head of household); or $36,426
  // (married filing jointly ...)". Read on 2026-11-18 at
  // https://files.tax.utah.gov/tax/forms/current/tc-40.pdf (the current-year
  // form; it will show 2026 once Utah posts it).
  utahTaxpayerCredit: {
    creditRate: 0.06,
    personalExemptionPerDependent: dollars(2_111),
    phaseOutRate: 0.013,
    phaseOutBase: {
      single: dollars(18_213),
      mfs: dollars(18_213),
      hoh: dollars(27_320),
      mfj: dollars(36_426),
    },
    draft: false,
  },
};
