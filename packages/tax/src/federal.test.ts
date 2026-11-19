import { describe, expect, it } from "vitest";
import { dollars } from "@fiscode/core";
import { config2026 } from "./config/2026.ts";
import { computeFederalBracketTax } from "./federal.ts";

describe("computeFederalBracketTax", () => {
  const cfg = config2026;

  it("returns 0 for non-positive income", () => {
    expect(computeFederalBracketTax(dollars(0), "mfj", cfg)).toBe(0);
  });

  // 2026 brackets, Rev. Proc. 2025-32 §4.01. Each total is checked against the
  // table's own "$X plus Y% of the excess over Z" figure.

  it("MFJ 50k: 10% to 24,800 then 12% to 50,000", () => {
    // 24,800 × 0.10 = 2,480
    // (50,000 − 24,800) × 0.12 = 3,024
    // Total = 5,504 (Table 1: $2,480 plus 12% of the excess over $24,800)
    expect(computeFederalBracketTax(dollars(50_000), "mfj", cfg)).toBe(dollars(5_504));
  });

  it("MFJ 200k crosses 22% bracket", () => {
    // 2,480 + (100,800 − 24,800) × 0.12 = 2,480 + 9,120 = 11,600
    // (200,000 − 100,800) × 0.22 = 21,824
    // Total = 33,424 (Table 1: $11,600 plus 22% of the excess over $100,800)
    expect(computeFederalBracketTax(dollars(200_000), "mfj", cfg)).toBe(dollars(33_424));
  });

  it("MFJ at exact bracket boundary (100,800): only first two brackets fire", () => {
    // 24,800 × 0.10 = 2,480
    // (100,800 − 24,800) × 0.12 = 9,120
    // Total = 11,600 (Table 1 prints $11,600 as the next bracket's base)
    expect(computeFederalBracketTax(dollars(100_800), "mfj", cfg)).toBe(dollars(11_600));
  });

  it("MFJ income in the top bracket includes the 37% slice", () => {
    // Table 1 bases: $116,896 at 512,450.
    // (768,700 − 512,450) × 0.35 = 89,687.50 → 206,583.50 at 768,700
    // (1,000,000 − 768,700) × 0.37 = 85,581
    // Total = 292,164.50
    expect(computeFederalBracketTax(dollars(1_000_000), "mfj", cfg)).toBe(dollars(292_164.5));
  });

  it("single 50k", () => {
    // 12,400 × 0.10 = 1,240
    // (50,000 − 12,400) × 0.12 = 4,512
    // Total = 5,752 (Table 3: $1,240 plus 12% of the excess over $12,400)
    expect(computeFederalBracketTax(dollars(50_000), "single", cfg)).toBe(dollars(5_752));
  });

  it("hoh has its own brackets", () => {
    // 17,700 × 0.10 = 1,770
    // (50,000 − 17,700) × 0.12 = 3,876
    // Total = 5,646 (Table 2: $1,770 plus 12% of the excess over $17,700)
    expect(computeFederalBracketTax(dollars(50_000), "hoh", cfg)).toBe(dollars(5_646));
  });
});
