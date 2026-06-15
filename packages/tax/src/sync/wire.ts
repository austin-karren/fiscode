import { z } from "zod";
import { dollars, isoDate } from "@fiscode/core";
import type { Bracket, YearConfig } from "../types.ts";

/**
 * Wire format for a remotely-published tax year config. This is what the IRS-
 * data mirror serves at `${base}/{year}.json`. It mirrors YearConfig but is
 * intentionally a SEPARATE shape — the wire format stays stable across
 * YearConfig internal refactors.
 *
 * All money values arrive as DOLLARS (numbers), not cents. This matches how
 * the IRS publishes figures and how a human-readable JSON should look. The
 * conversion to branded `Cents` happens at the parse boundary.
 */

const dollarsNumber = z.number().nonnegative();
const ratePct = z.number().min(0).max(1);

const wireBracketSchema = z.object({
  // Top of this bracket in DOLLARS. `null` = open-ended (top bracket).
  upTo: z.number().nullable(),
  rate: ratePct,
});

const filingStatusKeyed = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    single: value,
    mfj: value,
    mfs: value,
    hoh: value,
  });

export const TAX_YEAR_WIRE_SCHEMA_VERSION = "v1" as const;

export const taxYearWireSchema = z.object({
  schemaVersion: z.literal(TAX_YEAR_WIRE_SCHEMA_VERSION),
  year: z.number().int().min(2000).max(2100),
  // Free-text — surface in the UI so the user knows where the figures came
  // from (e.g., "IRS Rev. Proc. 2024-40 + SSA 2024-10-10").
  source: z.string().min(1),
  // ISO timestamp when the mirror generated this file.
  generatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T/, "Use ISO 8601 timestamp"),

  standardDeduction: filingStatusKeyed(dollarsNumber),
  ssWageBase: dollarsNumber,
  seTax: z.object({
    netEarningsFactor: ratePct,
    ssRate: ratePct,
    medicareRate: ratePct,
    addlMedicareRate: ratePct,
    addlMedicareThreshold: filingStatusKeyed(dollarsNumber),
  }),
  brackets: filingStatusKeyed(z.array(wireBracketSchema).min(1)),
  qbi: z.object({
    rate: ratePct,
    taxableIncomeLimit: filingStatusKeyed(dollarsNumber),
  }),
  mileageRatePerMile: z.number().nonnegative(),
  homeOffice: z.object({
    simplifiedRatePerSqft: dollarsNumber,
    simplifiedMaxSqft: z.number().int().nonnegative(),
    simplifiedCap: dollarsNumber,
  }),
  safeHarbor: z.object({
    currentYearFraction: ratePct,
    priorYearDefault: z.number().min(1).max(2),
    priorYearHighIncome: z.number().min(1).max(2),
    priorYearAgiThreshold: dollarsNumber,
  }),
  meals: z.object({ deductibleFraction: ratePct }),
  // 4 ISO YYYY-MM-DD strings in order Q1..Q4.
  quarterlyDueDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).length(4),
  // State -> flat rate. Sparse map — entries are 0..1.
  stateRates: z.record(z.string(), ratePct),
});

export type TaxYearWire = z.infer<typeof taxYearWireSchema>;

/**
 * Convert a parsed wire object into the internal `YearConfig`. Dollar fields
 * become branded `Cents`; ISO dates become branded `IsoDate`.
 */
export const wireToYearConfig = (wire: TaxYearWire): YearConfig => {
  const bracket = (b: { upTo: number | null; rate: number }): Bracket => ({
    upTo: b.upTo === null ? null : dollars(b.upTo),
    rate: b.rate,
  });
  return {
    year: wire.year,
    standardDeduction: {
      single: dollars(wire.standardDeduction.single),
      mfj: dollars(wire.standardDeduction.mfj),
      mfs: dollars(wire.standardDeduction.mfs),
      hoh: dollars(wire.standardDeduction.hoh),
    },
    ssWageBase: dollars(wire.ssWageBase),
    seTax: {
      netEarningsFactor: wire.seTax.netEarningsFactor,
      ssRate: wire.seTax.ssRate,
      medicareRate: wire.seTax.medicareRate,
      addlMedicareRate: wire.seTax.addlMedicareRate,
      addlMedicareThreshold: {
        single: dollars(wire.seTax.addlMedicareThreshold.single),
        mfj: dollars(wire.seTax.addlMedicareThreshold.mfj),
        mfs: dollars(wire.seTax.addlMedicareThreshold.mfs),
        hoh: dollars(wire.seTax.addlMedicareThreshold.hoh),
      },
    },
    brackets: {
      single: wire.brackets.single.map(bracket),
      mfj: wire.brackets.mfj.map(bracket),
      mfs: wire.brackets.mfs.map(bracket),
      hoh: wire.brackets.hoh.map(bracket),
    },
    qbi: {
      rate: wire.qbi.rate,
      taxableIncomeLimit: {
        single: dollars(wire.qbi.taxableIncomeLimit.single),
        mfj: dollars(wire.qbi.taxableIncomeLimit.mfj),
        mfs: dollars(wire.qbi.taxableIncomeLimit.mfs),
        hoh: dollars(wire.qbi.taxableIncomeLimit.hoh),
      },
    },
    mileageRatePerMile: wire.mileageRatePerMile,
    homeOffice: {
      simplifiedRatePerSqft: dollars(wire.homeOffice.simplifiedRatePerSqft),
      simplifiedMaxSqft: wire.homeOffice.simplifiedMaxSqft,
      simplifiedCap: dollars(wire.homeOffice.simplifiedCap),
    },
    safeHarbor: {
      currentYearFraction: wire.safeHarbor.currentYearFraction,
      priorYearDefault: wire.safeHarbor.priorYearDefault,
      priorYearHighIncome: wire.safeHarbor.priorYearHighIncome,
      priorYearAgiThreshold: dollars(wire.safeHarbor.priorYearAgiThreshold),
    },
    meals: { deductibleFraction: wire.meals.deductibleFraction },
    quarterlyDueDates: [
      isoDate(wire.quarterlyDueDates[0]!),
      isoDate(wire.quarterlyDueDates[1]!),
      isoDate(wire.quarterlyDueDates[2]!),
      isoDate(wire.quarterlyDueDates[3]!),
    ],
    stateRates: wire.stateRates as never,
  };
};

/** Inverse: render a YearConfig back to wire format (for self-publishing). */
export const yearConfigToWire = (
  cfg: YearConfig,
  source: string,
  generatedAt: string,
): TaxYearWire => ({
  schemaVersion: TAX_YEAR_WIRE_SCHEMA_VERSION,
  year: cfg.year,
  source,
  generatedAt,
  standardDeduction: {
    single: cfg.standardDeduction.single / 100,
    mfj: cfg.standardDeduction.mfj / 100,
    mfs: cfg.standardDeduction.mfs / 100,
    hoh: cfg.standardDeduction.hoh / 100,
  },
  ssWageBase: cfg.ssWageBase / 100,
  seTax: {
    netEarningsFactor: cfg.seTax.netEarningsFactor,
    ssRate: cfg.seTax.ssRate,
    medicareRate: cfg.seTax.medicareRate,
    addlMedicareRate: cfg.seTax.addlMedicareRate,
    addlMedicareThreshold: {
      single: cfg.seTax.addlMedicareThreshold.single / 100,
      mfj: cfg.seTax.addlMedicareThreshold.mfj / 100,
      mfs: cfg.seTax.addlMedicareThreshold.mfs / 100,
      hoh: cfg.seTax.addlMedicareThreshold.hoh / 100,
    },
  },
  brackets: {
    single: cfg.brackets.single.map((b) => ({
      upTo: b.upTo === null ? null : b.upTo / 100,
      rate: b.rate,
    })),
    mfj: cfg.brackets.mfj.map((b) => ({
      upTo: b.upTo === null ? null : b.upTo / 100,
      rate: b.rate,
    })),
    mfs: cfg.brackets.mfs.map((b) => ({
      upTo: b.upTo === null ? null : b.upTo / 100,
      rate: b.rate,
    })),
    hoh: cfg.brackets.hoh.map((b) => ({
      upTo: b.upTo === null ? null : b.upTo / 100,
      rate: b.rate,
    })),
  },
  qbi: {
    rate: cfg.qbi.rate,
    taxableIncomeLimit: {
      single: cfg.qbi.taxableIncomeLimit.single / 100,
      mfj: cfg.qbi.taxableIncomeLimit.mfj / 100,
      mfs: cfg.qbi.taxableIncomeLimit.mfs / 100,
      hoh: cfg.qbi.taxableIncomeLimit.hoh / 100,
    },
  },
  mileageRatePerMile: cfg.mileageRatePerMile,
  homeOffice: {
    simplifiedRatePerSqft: cfg.homeOffice.simplifiedRatePerSqft / 100,
    simplifiedMaxSqft: cfg.homeOffice.simplifiedMaxSqft,
    simplifiedCap: cfg.homeOffice.simplifiedCap / 100,
  },
  safeHarbor: {
    currentYearFraction: cfg.safeHarbor.currentYearFraction,
    priorYearDefault: cfg.safeHarbor.priorYearDefault,
    priorYearHighIncome: cfg.safeHarbor.priorYearHighIncome,
    priorYearAgiThreshold: cfg.safeHarbor.priorYearAgiThreshold / 100,
  },
  meals: { deductibleFraction: cfg.meals.deductibleFraction },
  quarterlyDueDates: [
    cfg.quarterlyDueDates[0],
    cfg.quarterlyDueDates[1],
    cfg.quarterlyDueDates[2],
    cfg.quarterlyDueDates[3],
  ],
  stateRates: cfg.stateRates as Record<string, number>,
});

/** Default mirror base URL. The app reads `VITE_TAX_DATA_BASE_URL` to override. */
export const DEFAULT_TAX_DATA_BASE_URL = "https://fiscode.app/tax-data";

/** URL convention: ${base}/v1/{year}.json. */
export const taxYearDataUrl = (year: number, base = DEFAULT_TAX_DATA_BASE_URL): string =>
  `${base}/${TAX_YEAR_WIRE_SCHEMA_VERSION}/${year}.json`;
