import { dollars, isoDate } from "@fiscode/core";
import type { YearConfig } from "../types.ts";

// Sources (each constant below names the one it comes from):
// - RP-2025-32: Rev. Proc. 2025-32, 2026 inflation adjustments after the
//   One, Big, Beautiful Bill Act. https://www.irs.gov/pub/irs-drop/rp-25-32.pdf
// - 1040-ES-2026: 2026 Form 1040-ES. https://www.irs.gov/pub/irs-pdf/f1040es.pdf
// - SE-INSTR: Instructions for Schedule SE (2026). https://www.irs.gov/instructions/i1040sse
export const config2026: YearConfig = {
  year: 2026,
  // RP-2025-32 §4.14(1).
  standardDeduction: {
    single: dollars(16_100),
    mfj: dollars(32_200),
    mfs: dollars(16_100),
    hoh: dollars(24_150),
  },
  // SE-INSTR: "For 2026, the maximum amount of self-employment income subject
  // to social security tax is $184,500." Also 1040-ES-2026 worksheet line 5.
  ssWageBase: dollars(184_500),
  // Rates: 1040-ES-2026 SE tax worksheet (lines 3, 4, 9). Additional Medicare
  // thresholds: SE-INSTR; statutory, not indexed.
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
  // RP-2025-32 §4.01, Tables 1 (mfj), 2 (hoh), 3 (single), 4 (mfs).
  brackets: {
    mfj: [
      { upTo: dollars(24_800), rate: 0.1 },
      { upTo: dollars(100_800), rate: 0.12 },
      { upTo: dollars(211_400), rate: 0.22 },
      { upTo: dollars(403_550), rate: 0.24 },
      { upTo: dollars(512_450), rate: 0.32 },
      { upTo: dollars(768_700), rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
    single: [
      { upTo: dollars(12_400), rate: 0.1 },
      { upTo: dollars(50_400), rate: 0.12 },
      { upTo: dollars(105_700), rate: 0.22 },
      { upTo: dollars(201_775), rate: 0.24 },
      { upTo: dollars(256_225), rate: 0.32 },
      { upTo: dollars(640_600), rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
    mfs: [
      { upTo: dollars(12_400), rate: 0.1 },
      { upTo: dollars(50_400), rate: 0.12 },
      { upTo: dollars(105_700), rate: 0.22 },
      { upTo: dollars(201_775), rate: 0.24 },
      { upTo: dollars(256_225), rate: 0.32 },
      { upTo: dollars(384_350), rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
    hoh: [
      { upTo: dollars(17_700), rate: 0.1 },
      { upTo: dollars(67_450), rate: 0.12 },
      { upTo: dollars(105_700), rate: 0.22 },
      { upTo: dollars(201_750), rate: 0.24 },
      { upTo: dollars(256_200), rate: 0.32 },
      { upTo: dollars(640_600), rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
  },
  qbi: {
    // https://www.irs.gov/newsroom/qualified-business-income-deduction
    rate: 0.2,
    // RP-2025-32 §4.26 threshold amounts. (The MFJ QBI threshold, $403,500,
    // is not the MFJ 24% bracket top, $403,550; both are quoted from RP.)
    taxableIncomeLimit: {
      single: dollars(201_750),
      mfj: dollars(403_500),
      mfs: dollars(201_775),
      hoh: dollars(201_750),
    },
    // RP-2025-32 §4.26 phase-in range amounts minus the thresholds: $276,750 /
    // $553,500 / $276,775. IRC §199A(b)(3)(B): "$75,000 ($150,000 in the case
    // of a joint return)".
    phaseInRange: {
      single: dollars(75_000),
      mfj: dollars(150_000),
      mfs: dollars(75_000),
      hoh: dollars(75_000),
    },
    // IRC §199A(i) (https://www.law.cornell.edu/uscode/text/26/199A): the
    // deduction is "the greater of (A) the amount of such deduction determined
    // without regard to this subsection, or (B) $400" for a taxpayer with at
    // least $1,000 of active QBI. RP-2025-32 §2.12: years after Dec 31, 2025.
    minimum: { deduction: dollars(400), qbiFloor: dollars(1_000) },
  },
  // Business rate changed mid-year.
  // 72.5 cents: Notice 2026-10, https://www.irs.gov/pub/irs-drop/n-26-10.pdf
  // 76 cents from July 1, 2026: Announcement 2026-11, IRB 2026-29,
  // https://www.irs.gov/irb/2026-29_irb (also
  // https://www.irs.gov/tax-professionals/standard-mileage-rates).
  mileageRates: [
    { from: isoDate("2026-01-01"), ratePerMile: 0.725 },
    { from: isoDate("2026-07-01"), ratePerMile: 0.76 },
  ],
  // https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction
  homeOffice: {
    simplifiedRatePerSqft: dollars(5),
    simplifiedMaxSqft: 300,
    simplifiedCap: dollars(1_500),
  },
  // 1040-ES-2026, General Rule and Higher income taxpayers: "more than
  // $150,000 ($75,000 if your filing status for 2026 is married filing
  // separately)".
  safeHarbor: {
    currentYearFraction: 0.9,
    priorYearDefault: 1.0,
    priorYearHighIncome: 1.1,
    priorYearAgiThreshold: dollars(150_000),
    priorYearAgiThresholdMfs: dollars(75_000),
  },
  // Instructions for Schedule C (2025 edition), https://www.irs.gov/instructions/i1040sc
  meals: { deductibleFraction: 0.5 },
  // 1040-ES-2026, Payment Due Dates.
  quarterlyDueDates: [
    isoDate("2026-04-15"),
    isoDate("2026-06-15"),
    isoDate("2026-09-15"),
    isoDate("2027-01-15"),
  ],
  stateRates: {
    // Utah Code 59-10-104 (effective 1/1/2026), "(b) 4.45%."
    // https://le.utah.gov/xcode/title59/chapter10/C59-10-S104_2026050620260506.pdf
    UT: 0.0445,
  },
  // DRAFT: 2026 TC-40 dated 10/20/26, lines 9-18 (could change before the final
  // form): https://files.tax.utah.gov/tax/forms/drafts/tc-40.pdf
  // Formula: Utah Code 59-10-1018 (effective 1/1/2026),
  // https://le.utah.gov/xcode/Title59/Chapter10/C59-10-S1018_2026050620260506.pdf
  // The form's base amounts are the statute's, indexed by the Tax Commission.
  utahTaxpayerCredit: {
    creditRate: 0.06,
    personalExemptionPerDependent: dollars(2_167),
    phaseOutRate: 0.013,
    phaseOutBase: {
      single: dollars(18_696),
      mfs: dollars(18_696),
      hoh: dollars(28_045),
      mfj: dollars(37_392),
    },
    draft: true,
  },
};
