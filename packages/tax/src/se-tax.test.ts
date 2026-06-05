import { describe, expect, it } from "vitest";
import { dollars } from "@fiscode/core";
import { config2026 } from "./config/2026.ts";
import { computeSeTax } from "./se-tax.ts";

describe("computeSeTax", () => {
  const cfg = config2026;

  it("returns all zeros for non-positive profit", () => {
    const r = computeSeTax(dollars(0), "mfj", cfg);
    expect(r.totalSeTax).toBe(0);
    expect(r.halfSeTaxDeduction).toBe(0);
  });

  it("computes for a typical 120k profile", () => {
    // 120,000 × 0.9235 = 110,820
    // SS: 110,820 × 0.124 = 13,741.68
    // Medicare: 110,820 × 0.029 = 3,213.78
    // No additional Medicare (below 250k MFJ threshold)
    const r = computeSeTax(dollars(120_000), "mfj", cfg);
    expect(r.netSeEarnings).toBe(dollars(110_820));
    expect(r.socialSecurityTax).toBe(dollars(13_741.68));
    expect(r.medicareTax).toBe(dollars(3_213.78));
    expect(r.additionalMedicareTax).toBe(0);
    expect(r.regularSeTax).toBe(dollars(16_955.46));
    expect(r.halfSeTaxDeduction).toBe(dollars(8_477.73));
  });

  it("caps SS at the wage base", () => {
    // Net earnings = 400,000 × 0.9235 = 369,400
    // SS portion capped at wage base 184,500: 184,500 × 0.124 = 22,878
    // Medicare on full 369,400 × 0.029 = 10,712.60
    // Additional Medicare (MFJ): (369,400 − 250,000) × 0.009 = 1,074.60
    const r = computeSeTax(dollars(400_000), "mfj", cfg);
    expect(r.socialSecurityTax).toBe(dollars(22_878));
    expect(r.medicareTax).toBe(dollars(10_712.60));
    expect(r.additionalMedicareTax).toBe(dollars(1_074.60));
  });

  it("only half of the regular (non-additional-Medicare) SE tax is deductible", () => {
    const r = computeSeTax(dollars(400_000), "mfj", cfg);
    expect(r.halfSeTaxDeduction).toBe(Math.round((r.socialSecurityTax + r.medicareTax) * 0.5));
  });

  it("additional Medicare threshold differs by filing status", () => {
    // Single threshold is 200k. Net earnings = 300k × 0.9235 = 277,050.
    // (277,050 − 200,000) × 0.009 = 693.45
    const r = computeSeTax(dollars(300_000), "single", cfg);
    expect(r.additionalMedicareTax).toBe(dollars(693.45));
  });
});
