import { dollars, isoDate } from "@fiscode/core";
import type { YearConfig } from "../types.ts";

// All figures are SEEDS. Every annually-changing tax figure must be verified
// against the IRS / SSA before relying on this for a real estimate.
export const config2026: YearConfig = {
  year: 2026,
  // todo: verify against IRS Rev. Proc. for 2026
  standardDeduction: {
    single: dollars(15_000),
    mfj: dollars(30_000),
    mfs: dollars(15_000),
    hoh: dollars(22_500),
  },
  // todo: verify against SSA for 2026 (~$184,500 projected)
  ssWageBase: dollars(184_500),
  seTax: {
    netEarningsFactor: 0.9235,
    ssRate: 0.124,
    medicareRate: 0.029,
    addlMedicareRate: 0.009,
    // Statutory; not inflation-indexed.
    addlMedicareThreshold: {
      single: dollars(200_000),
      mfj: dollars(250_000),
      mfs: dollars(125_000),
      hoh: dollars(200_000),
    },
  },
  // todo: verify against IRS Rev. Proc. for 2026
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
    // todo: verify against IRS for 2026
    taxableIncomeLimit: {
      single: dollars(197_300),
      mfj: dollars(394_600),
      mfs: dollars(197_300),
      hoh: dollars(197_300),
    },
  },
  // todo: verify against IRS for 2026 — mileage rate changes every year
  mileageRatePerMile: 0.725,
  homeOffice: {
    simplifiedRatePerSqft: dollars(5),
    simplifiedMaxSqft: 300,
    simplifiedCap: dollars(1_500),
  },
  safeHarbor: {
    currentYearFraction: 0.9,
    priorYearDefault: 1.0,
    priorYearHighIncome: 1.1,
    // todo: verify; the 150k AGI threshold (75k MFS) has been stable but confirm
    priorYearAgiThreshold: dollars(150_000),
  },
  meals: { deductibleFraction: 0.5 },
  // Quarterly due dates: 15th of the month after the quarter ends, rolled
  // to next business day at runtime. Q4 falls in the *next* calendar year.
  quarterlyDueDates: [
    isoDate("2026-04-15"),
    isoDate("2026-06-15"),
    isoDate("2026-09-15"),
    isoDate("2027-01-15"),
  ],
  stateRates: {
    // todo: verify Utah flat rate for 2026 (trending down)
    UT: 0.0455,
  },
};
