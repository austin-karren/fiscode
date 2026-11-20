import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import { config2026 } from "./config/2026.ts";
import { computeSafeHarbor } from "./safe-harbor.ts";
import type { TaxEstimate } from "./types.ts";

const fakeEstimate = (totalLiability: number): TaxEstimate =>
  ({
    year: 2026,
    netProfit: cents(0),
    agi: cents(0),
    se: {
      netSeEarnings: cents(0),
      socialSecurityTax: cents(0),
      medicareTax: cents(0),
      additionalMedicareTax: cents(0),
      regularSeTax: cents(0),
      totalSeTax: cents(0),
      halfSeTaxDeduction: cents(0),
    },
    federal: { taxableIncome: cents(0), qbiDeduction: cents(0), federalIncomeTax: cents(0) },
    state: { taxableIncome: cents(0), rate: 0, stateIncomeTax: cents(0) },
    spouseWithholding: cents(0),
    federalLiability: dollars(totalLiability),
    federalWithholding: cents(0),
    stateWithholding: cents(0),
    totalLiability: dollars(totalLiability),
    remainingOwed: dollars(totalLiability),
  }) as TaxEstimate;

describe("computeSafeHarbor", () => {
  const cfg = config2026;

  it("first-year filer: floor = 90% of current; priorYearTarget undefined", () => {
    const r = computeSafeHarbor(fakeEstimate(20_000), undefined, undefined, cfg);
    expect(r.firstYear).toBe(true);
    expect(r.currentYearTarget).toBe(dollars(18_000));
    expect(r.priorYearTarget).toBeUndefined();
    expect(r.floor).toBe(dollars(18_000));
    expect(r.multiplierUsed).toBeUndefined();
  });

  it("prior tax with low prior AGI uses 100% multiplier; floor = min(90% current, 100% prior)", () => {
    // Current liability 30k → 90% = 27k. Prior 25k × 100% = 25k. Floor = 25k.
    const r = computeSafeHarbor(fakeEstimate(30_000), dollars(25_000), dollars(100_000), cfg);
    expect(r.multiplierUsed).toBe(1.0);
    expect(r.priorYearTarget).toBe(dollars(25_000));
    expect(r.floor).toBe(dollars(25_000));
    expect(r.firstYear).toBe(false);
  });

  it("prior AGI just over 150k threshold uses 110%", () => {
    const r = computeSafeHarbor(fakeEstimate(30_000), dollars(20_000), dollars(150_001), cfg);
    expect(r.multiplierUsed).toBe(1.1);
    expect(r.priorYearTarget).toBe(dollars(22_000));
  });

  it("prior AGI at exactly 150k stays on 100% (threshold is strict >)", () => {
    const r = computeSafeHarbor(fakeEstimate(30_000), dollars(20_000), dollars(150_000), cfg);
    expect(r.multiplierUsed).toBe(1.0);
  });

  it("undefined priorAgi (but defined priorTax) uses 110%: the AGI might be over the threshold", () => {
    // Review #72 r1 ruling 2: conservative, and the reason says why.
    const r = computeSafeHarbor(fakeEstimate(30_000), dollars(20_000), undefined, cfg);
    expect(r.multiplierUsed).toBe(1.1);
    expect(r.multiplierReason).toBe("agi_not_entered");
    expect(r.priorYearTarget).toBe(dollars(22_000));
  });

  it("floor picks the lower target (current-year wins when prior is huge)", () => {
    // Current 10k × 90% = 9k. Prior 100k × 100% = 100k. Floor = 9k.
    const r = computeSafeHarbor(fakeEstimate(10_000), dollars(100_000), dollars(50_000), cfg);
    expect(r.floor).toBe(dollars(9_000));
  });

  // 2026 Form 1040-ES, "Higher income taxpayers": 110% applies if 2025 AGI was
  // "more than $150,000 ($75,000 if your filing status for 2026 is married
  // filing separately)".
  it("married filing separately: 110% once prior-year AGI is over $75,000", () => {
    const over = computeSafeHarbor(
      fakeEstimate(30_000),
      dollars(20_000),
      dollars(75_000.01),
      cfg,
      "mfs",
    );
    expect(over.multiplierUsed).toBe(1.1);
    expect(over.priorYearTarget).toBe(dollars(22_000));
    const at = computeSafeHarbor(
      fakeEstimate(30_000),
      dollars(20_000),
      dollars(75_000),
      cfg,
      "mfs",
    );
    expect(at.multiplierUsed).toBe(1.0);
  });

  it("other filing statuses keep the $150,000 threshold", () => {
    const r = computeSafeHarbor(
      fakeEstimate(30_000),
      dollars(20_000),
      dollars(100_000),
      cfg,
      "single",
    );
    expect(r.multiplierUsed).toBe(1.0);
  });
});
