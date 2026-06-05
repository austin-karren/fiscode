import { dollars, isoDate } from "@fiscode/core";
import type { YearConfig } from "../types.ts";

// 2025 seed values. todo: verify all figures against IRS / SSA for 2025.
export const config2025: YearConfig = {
  year: 2025,
  standardDeduction: {
    single: dollars(15_000),
    mfj: dollars(30_000),
    mfs: dollars(15_000),
    hoh: dollars(22_500),
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
    taxableIncomeLimit: {
      single: dollars(197_300),
      mfj: dollars(394_600),
      mfs: dollars(197_300),
      hoh: dollars(197_300),
    },
  },
  mileageRatePerMile: 0.7,
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
  },
  meals: { deductibleFraction: 0.5 },
  quarterlyDueDates: [
    isoDate("2025-04-15"),
    isoDate("2025-06-16"),
    isoDate("2025-09-15"),
    isoDate("2026-01-15"),
  ],
  stateRates: {
    UT: 0.0455,
  },
};
