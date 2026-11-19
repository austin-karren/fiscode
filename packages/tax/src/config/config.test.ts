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

  it("mileage rate $0.70/mile all year", () => {
    expect(c.mileageRates).toEqual([{ from: "2025-01-01", ratePerMile: 0.7 }]);
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

  it("UT state rate 4.5% (2025 TC-40 line 10)", () => {
    expect(c.stateRates.UT).toBe(0.045);
  });

  it("Utah taxpayer tax credit (2025 TC-40)", () => {
    expect(c.utahTaxpayerCredit).toEqual({
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
    });
  });

  it("quarterly due dates land in the right months and Jun 15 shifts to Jun 16 (Sunday)", () => {
    expect(c.quarterlyDueDates).toEqual(["2025-04-15", "2025-06-16", "2025-09-15", "2026-01-15"]);
  });

  it("meals deductible fraction is 50%", () => {
    expect(c.meals.deductibleFraction).toBe(0.5);
  });
});

// Every 2026 value below is quoted from a primary source; the URL sits
// beside the constant in 2026.ts.
describe("config 2026 — pinned values (Rev. Proc. 2025-32, Notice 2026-10, Announcement 2026-11)", () => {
  const c = config2026;

  it("standard deduction", () => {
    expect(c.standardDeduction).toEqual({
      single: dollars(16_100),
      mfj: dollars(32_200),
      mfs: dollars(16_100),
      hoh: dollars(24_150),
    });
  });

  it("bracket tops for every filing status, rates 10..37%", () => {
    const tops = (fs: keyof typeof c.brackets) => c.brackets[fs].map((b) => b.upTo);
    expect(tops("mfj")).toEqual(
      [24_800, 100_800, 211_400, 403_550, 512_450, 768_700]
        .map((d) => dollars(d))
        .concat(null as never),
    );
    expect(tops("single")).toEqual(
      [12_400, 50_400, 105_700, 201_775, 256_225, 640_600]
        .map((d) => dollars(d))
        .concat(null as never),
    );
    expect(tops("mfs")).toEqual(
      [12_400, 50_400, 105_700, 201_775, 256_225, 384_350]
        .map((d) => dollars(d))
        .concat(null as never),
    );
    expect(tops("hoh")).toEqual(
      [17_700, 67_450, 105_700, 201_750, 256_200, 640_600]
        .map((d) => dollars(d))
        .concat(null as never),
    );
    for (const fs of ["mfj", "single", "mfs", "hoh"] as const) {
      expect(c.brackets[fs].map((b) => b.rate)).toEqual([0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]);
    }
  });

  it("QBI threshold", () => {
    expect(c.qbi.taxableIncomeLimit).toEqual({
      single: dollars(201_750),
      mfj: dollars(403_500),
      mfs: dollars(201_775),
      hoh: dollars(201_750),
    });
  });

  it("SS wage base $184,500", () => {
    expect(c.ssWageBase).toBe(dollars(184_500));
  });

  it("mileage: 72.5 cents to June 30, 76 cents from July 1", () => {
    expect(c.mileageRates).toEqual([
      { from: "2026-01-01", ratePerMile: 0.725 },
      { from: "2026-07-01", ratePerMile: 0.76 },
    ]);
  });

  it("UT state rate 4.45%", () => {
    expect(c.stateRates.UT).toBe(0.0445);
  });

  it("Utah taxpayer tax credit (2026 TC-40 DRAFT dated 10/20/26)", () => {
    expect(c.utahTaxpayerCredit).toEqual({
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
    });
  });

  it("safe harbor: $150,000 prior-year AGI threshold, $75,000 if MFS", () => {
    expect(c.safeHarbor.priorYearAgiThreshold).toBe(dollars(150_000));
    expect(c.safeHarbor.priorYearAgiThresholdMfs).toBe(dollars(75_000));
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
