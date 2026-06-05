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
});
