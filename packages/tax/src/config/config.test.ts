import { describe, expect, it } from "vitest";
import { dollars } from "@fiscode/core";
import { config2025 } from "./2025.ts";
import { config2026 } from "./2026.ts";
import { getYearConfig, hasExactConfig } from "./index.ts";

/**
 * These tests PIN the tax-year constants. If a value changes — whether to
 * track an IRS Rev. Proc. update, a real-tax-year mistake, or a deliberate
 * shift — the test breaks and the change becomes intentional, not silent.
 *
 * Sources to verify against when updating:
 *   • Standard deduction & brackets: IRS Rev. Proc. (annual) + OBBBA (2025)
 *   • SS wage base: SSA Cost-of-Living Adjustment announcement
 *   • Mileage rate: IRS Notice (released mid-prior-year)
 *   • QBI thresholds: IRS Rev. Proc. (annual)
 *   • Safe-harbor AGI threshold: IRC §6654(d)(1)(C) ($150k since 1998)
 *   • Additional Medicare thresholds: statutory (PPACA), not indexed
 */
describe("config 2025 — pinned values", () => {
  const c = config2025;

  it("standard deduction", () => {
    expect(c.standardDeduction.single).toBe(dollars(15_000));
    expect(c.standardDeduction.mfj).toBe(dollars(30_000));
    expect(c.standardDeduction.mfs).toBe(dollars(15_000));
    expect(c.standardDeduction.hoh).toBe(dollars(22_500));
  });

  it("SS wage base — $176,100 per SSA 2024-10-10 announcement", () => {
    expect(c.ssWageBase).toBe(dollars(176_100));
  });

  it("SE tax rates and 0.9% additional Medicare thresholds", () => {
    expect(c.seTax.ssRate).toBe(0.124);
    expect(c.seTax.medicareRate).toBe(0.029);
    expect(c.seTax.addlMedicareRate).toBe(0.009);
    expect(c.seTax.netEarningsFactor).toBe(0.9235);
    expect(c.seTax.addlMedicareThreshold.single).toBe(dollars(200_000));
    expect(c.seTax.addlMedicareThreshold.mfj).toBe(dollars(250_000));
    expect(c.seTax.addlMedicareThreshold.mfs).toBe(dollars(125_000));
    expect(c.seTax.addlMedicareThreshold.hoh).toBe(dollars(200_000));
  });

  it("MFJ brackets are monotonically increasing and end open", () => {
    const b = c.brackets.mfj;
    for (let i = 1; i < b.length - 1; i++) {
      expect(b[i]!.upTo).not.toBeNull();
      expect(b[i]!.upTo!).toBeGreaterThan(b[i - 1]!.upTo!);
    }
    expect(b.at(-1)!.upTo).toBeNull();
  });

  it("QBI thresholds", () => {
    expect(c.qbi.rate).toBe(0.2);
    expect(c.qbi.taxableIncomeLimit.mfj).toBe(dollars(394_600));
    expect(c.qbi.taxableIncomeLimit.single).toBe(dollars(197_300));
  });

  it("mileage rate $0.70/mile (IRS Notice 2024-)", () => {
    expect(c.mileageRatePerMile).toBe(0.7);
  });

  it("home-office simplified: $5/sqft, 300 sqft cap, $1,500 max", () => {
    expect(c.homeOffice.simplifiedRatePerSqft).toBe(dollars(5));
    expect(c.homeOffice.simplifiedMaxSqft).toBe(300);
    expect(c.homeOffice.simplifiedCap).toBe(dollars(1_500));
  });

  it("safe-harbor thresholds: 90% / 100% / 110% / $150k", () => {
    expect(c.safeHarbor.currentYearFraction).toBe(0.9);
    expect(c.safeHarbor.priorYearDefault).toBe(1.0);
    expect(c.safeHarbor.priorYearHighIncome).toBe(1.1);
    expect(c.safeHarbor.priorYearAgiThreshold).toBe(dollars(150_000));
  });

  it("UT state rate", () => {
    expect(c.stateRates.UT).toBe(0.0455);
  });

  it("quarterly due dates land in the right months and Jun 15 shifts to Jun 16 (Sunday)", () => {
    expect(c.quarterlyDueDates).toEqual(["2025-04-15", "2025-06-16", "2025-09-15", "2026-01-15"]);
  });

  it("meals deductible fraction is 50%", () => {
    expect(c.meals.deductibleFraction).toBe(0.5);
  });
});

describe("config 2026 — pinned values (projections; verify when IRS releases Rev. Proc.)", () => {
  const c = config2026;

  it("standard deduction matches 2025 seed (placeholder — update once IRS releases 2026 figures)", () => {
    // 2026 standard deduction is inflation-indexed by IRS Rev. Proc.
    // Current seed mirrors 2025 — re-verify when the 2026 Rev. Proc. drops.
    expect(c.standardDeduction.single).toBe(dollars(15_000));
    expect(c.standardDeduction.mfj).toBe(dollars(30_000));
  });

  it("SS wage base — $184,500 (SSA projection)", () => {
    expect(c.ssWageBase).toBe(dollars(184_500));
  });

  it("mileage rate $0.725/mile (placeholder — IRS publishes in mid-prior-year)", () => {
    expect(c.mileageRatePerMile).toBe(0.725);
  });

  it("quarterly due dates", () => {
    expect(c.quarterlyDueDates).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
  });
});

describe("getYearConfig", () => {
  it("returns exact config when registered", () => {
    expect(getYearConfig(2025).year).toBe(2025);
    expect(getYearConfig(2026).year).toBe(2026);
    expect(hasExactConfig(2025)).toBe(true);
    expect(hasExactConfig(2027)).toBe(false);
  });

  it("falls back to the nearest year config when unknown, but reflects the requested year", () => {
    const fallback = getYearConfig(2027);
    expect(fallback.year).toBe(2027);
    // Should have been built from the 2026 (nearest) seed.
    expect(fallback.ssWageBase).toBe(dollars(184_500));
  });
});
