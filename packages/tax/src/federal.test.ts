import { describe, expect, it } from "vitest";
import { dollars } from "@fiscode/core";
import { config2026 } from "./config/2026.ts";
import { computeFederalBracketTax } from "./federal.ts";

describe("computeFederalBracketTax", () => {
  const cfg = config2026;

  it("returns 0 for non-positive income", () => {
    expect(computeFederalBracketTax(dollars(0), "mfj", cfg)).toBe(0);
  });

  it("MFJ 50k: 10% to 23,850 then 12% to 50,000", () => {
    // 23,850 × 0.10 = 2,385
    // (50,000 − 23,850) × 0.12 = 3,138
    // Total = 5,523
    expect(computeFederalBracketTax(dollars(50_000), "mfj", cfg)).toBe(dollars(5_523));
  });

  it("MFJ 200k crosses 22% bracket", () => {
    // 23,850 × 0.10 = 2,385
    // (96,950 − 23,850) × 0.12 = 8,772
    // (200,000 − 96,950) × 0.22 = 22,671
    // Total = 33,828
    expect(computeFederalBracketTax(dollars(200_000), "mfj", cfg)).toBe(dollars(33_828));
  });

  it("MFJ at exact bracket boundary (96,950): only first two brackets fire", () => {
    // 23,850 × 0.10 = 2,385
    // (96,950 − 23,850) × 0.12 = 8,772
    // Total = 11,157
    expect(computeFederalBracketTax(dollars(96_950), "mfj", cfg)).toBe(dollars(11_157));
  });

  it("MFJ income in the top bracket includes the 37% slice", () => {
    // 1,000,000 MFJ:
    // 23,850 × 0.10 = 2,385
    // (96,950 − 23,850) × 0.12 = 8,772
    // (206,700 − 96,950) × 0.22 = 24,145
    // (394,600 − 206,700) × 0.24 = 45,096
    // (501,050 − 394,600) × 0.32 = 34,064
    // (751,600 − 501,050) × 0.35 = 87,692.5
    // (1,000,000 − 751,600) × 0.37 = 91,908
    // Total = 294,062.5 (round to nearest cent)
    expect(computeFederalBracketTax(dollars(1_000_000), "mfj", cfg)).toBe(dollars(294_062.5));
  });

  it("single 50k", () => {
    // 11,925 × 0.10 = 1,192.50
    // (48,475 − 11,925) × 0.12 = 4,386
    // (50,000 − 48,475) × 0.22 = 335.50
    // Total = 5,914
    expect(computeFederalBracketTax(dollars(50_000), "single", cfg)).toBe(dollars(5_914));
  });

  it("hoh has its own brackets", () => {
    // HOH 50,000:
    // 17,000 × 0.10 = 1,700
    // (50,000 − 17,000) × 0.12 = 3,960
    // Total = 5,660
    expect(computeFederalBracketTax(dollars(50_000), "hoh", cfg)).toBe(dollars(5_660));
  });
});
