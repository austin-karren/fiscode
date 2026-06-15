import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import { config2026 } from "./config/2026.ts";
import { computeQbi } from "./qbi.ts";

describe("computeQbi", () => {
  const cfg = config2026;

  it("returns 0 when QBI is non-positive", () => {
    expect(computeQbi(cents(0), dollars(50_000), "mfj", cfg)).toBe(0);
    expect(computeQbi(dollars(-5_000) as never, dollars(50_000), "mfj", cfg)).toBe(0);
  });

  it("returns 20% of QBI when below the taxable-income limit", () => {
    // 100k QBI, 80k taxable income before QBI. Deduction = min(20k, 16k) = 16k.
    // (capped by 20% of taxable income, which is the lesser of the two)
    expect(computeQbi(dollars(100_000), dollars(80_000), "mfj", cfg)).toBe(dollars(16_000));
  });

  it("returns 20% of QBI when QBI portion is the smaller cap", () => {
    // 50k QBI, 200k taxable income. 20% QBI = 10k; 20% TI = 40k. Cap is QBI side.
    expect(computeQbi(dollars(50_000), dollars(200_000), "mfj", cfg)).toBe(dollars(10_000));
  });

  it("caps at 20% of taxable income before QBI", () => {
    // High QBI, low taxable income (e.g., big standard deduction year). Cap binds.
    expect(computeQbi(dollars(200_000), dollars(10_000), "mfj", cfg)).toBe(dollars(2_000));
  });

  it("returns 0 when taxable income before QBI is zero or negative", () => {
    expect(computeQbi(dollars(100_000), cents(0), "mfj", cfg)).toBe(0);
  });

  it("MFJ threshold is 394,600 — at the boundary the un-phased deduction still applies", () => {
    // Target user is far below threshold; this pins the seam.
    const r = computeQbi(dollars(300_000), dollars(394_600), "mfj", cfg);
    // 20% × 300k = 60k (capped by 20% × 394.6k = 78.92k, so 60k wins)
    expect(r).toBe(dollars(60_000));
  });

  it("single threshold is 197,300 (half of MFJ)", () => {
    // Single filer at threshold; same un-phased behavior.
    const r = computeQbi(dollars(150_000), dollars(197_300), "single", cfg);
    expect(r).toBe(dollars(30_000));
  });

  it("over-threshold: returns the un-phased deduction (wage/UBIA phase-in not yet modeled — conservative)", () => {
    // 500k QBI, 600k taxable income before QBI, MFJ (over 394.6k limit).
    // Conservative behavior: same as below-threshold — 20% × QBI = 100k, capped
    // by 20% × TI = 120k. The wage/UBIA phase-in (which could REDUCE this)
    // is not yet implemented; the result here errs HIGH for SSTBs and at the
    // top of the phase-in. Documented in qbi.ts.
    expect(computeQbi(dollars(500_000), dollars(600_000), "mfj", cfg)).toBe(dollars(100_000));
  });
});
