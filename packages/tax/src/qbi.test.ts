import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import { config2025 } from "./config/2025.ts";
import { config2026 } from "./config/2026.ts";
import { computeQbi } from "./qbi.ts";

// Rules (26 U.S.C. 199A, https://uscode.house.gov (release point through Pub. L. 119-142)):
// - (b)(2): 20% of QBI, limited by the W-2 wage / property limit. fiscode
//   models no W-2 wages or property, so that limit is $0.
// - (b)(3)(A): at or below the threshold the wage limit does not apply.
// - (b)(3)(B): inside the phase-in band, 20% of QBI is reduced by
//   (20% of QBI − $0) × (taxable income − threshold) / band. Above it, the
//   wage limit ($0) applies in full.
// - (a): the deduction is at most 20% of taxable income (before QBI).
// - (i), from 2026: with at least $1,000 of QBI, the deduction is the greater
//   of the above or $400.
// Thresholds and bands: Rev. Proc. 2025-32 §4.26 (2026), Rev. Proc. 2024-40
// §.27 (2025). Minimum: Rev. Proc. 2025-32 §2.12 (years after 2025).

describe("computeQbi, 2026 below the threshold", () => {
  const cfg = config2026;

  it("returns 0 when QBI is non-positive", () => {
    expect(computeQbi(cents(0), dollars(50_000), "mfj", cfg)).toBe(0);
    expect(computeQbi(dollars(-5_000) as never, dollars(50_000), "mfj", cfg)).toBe(0);
  });

  it("caps at 20% of taxable income before QBI", () => {
    // min(20% × 100,000 = 20,000, 20% × 80,000 = 16,000) = 16,000
    expect(computeQbi(dollars(100_000), dollars(80_000), "mfj", cfg)).toBe(dollars(16_000));
  });

  it("20% of QBI when that is the smaller", () => {
    // min(20% × 50,000 = 10,000, 20% × 200,000 = 40,000) = 10,000
    expect(computeQbi(dollars(50_000), dollars(200_000), "mfj", cfg)).toBe(dollars(10_000));
  });

  it("at the threshold the phase-in has not started", () => {
    // MFJ threshold 403,500: 20% × 300,000 = 60,000; 20% × 403,500 = 80,700
    expect(computeQbi(dollars(300_000), dollars(403_500), "mfj", cfg)).toBe(dollars(60_000));
  });
});

describe("computeQbi, 2026 $400 minimum (§199A(i))", () => {
  const cfg = config2026;

  it("lifts a small deduction to $400 once QBI is at least $1,000", () => {
    // QBI 1,500, taxable income 500: min(300, 100) = 100 → greater of 100 and 400
    expect(computeQbi(dollars(1_500), dollars(500), "single", cfg)).toBe(dollars(400));
  });

  it("applies at exactly $1,000 of QBI", () => {
    // min(200, 20% × 50,000 = 10,000) = 200 → 400
    expect(computeQbi(dollars(1_000), dollars(50_000), "single", cfg)).toBe(dollars(400));
  });

  it("does not apply below $1,000 of QBI", () => {
    // QBI 999.99: 20% = 199.998 → 200.00; no minimum
    expect(computeQbi(dollars(999.99), dollars(50_000), "single", cfg)).toBe(dollars(200));
  });

  it("applies even when taxable income before QBI is zero", () => {
    expect(computeQbi(dollars(100_000), cents(0), "mfj", cfg)).toBe(dollars(400));
  });

  it("leaves a deduction already above $400 alone", () => {
    expect(computeQbi(dollars(5_000), dollars(50_000), "single", cfg)).toBe(dollars(1_000));
  });
});

describe("computeQbi, 2026 phase-in (§199A(b)(3)(B), no W-2 wages or property)", () => {
  const cfg = config2026;

  it("single, halfway through the $75,000 band", () => {
    // Threshold 201,750; taxable income 239,250 is 37,500 over (half of 75,000).
    // 20% × 300,000 = 60,000; reduction 60,000 × 37,500 / 75,000 = 30,000 → 30,000
    // Cap 20% × 239,250 = 47,850 does not bind.
    expect(computeQbi(dollars(300_000), dollars(239_250), "single", cfg)).toBe(dollars(30_000));
  });

  it("MFJ, halfway through the $150,000 band", () => {
    // Threshold 403,500; 478,500 is 75,000 over (half of 150,000).
    // 20% × 500,000 = 100,000; reduction 50,000 → 50,000. Cap 95,700 does not bind.
    expect(computeQbi(dollars(500_000), dollars(478_500), "mfj", cfg)).toBe(dollars(50_000));
  });

  it("MFS uses its own threshold and a $75,000 band", () => {
    // Threshold 201,775; 216,775 is 15,000 over: 20% × 100,000 = 20,000;
    // reduction 20,000 × 15,000 / 75,000 = 4,000 → 16,000. Cap 43,355 does not bind.
    expect(computeQbi(dollars(100_000), dollars(216_775), "mfs", cfg)).toBe(dollars(16_000));
  });

  it("at the end of the band the deduction is fully phased out, then the $400 minimum applies", () => {
    // 276,750 = 201,750 + 75,000: reduction is the whole 60,000 → 0 → greater of 0 and 400
    expect(computeQbi(dollars(300_000), dollars(276_750), "single", cfg)).toBe(dollars(400));
  });

  it("above the band only the $400 minimum is left", () => {
    expect(computeQbi(dollars(500_000), dollars(600_000), "mfj", cfg)).toBe(dollars(400));
  });
});

describe("computeQbi, 2025 (no minimum; $50,000 / $100,000 band)", () => {
  const cfg = config2025;

  it("no $400 minimum in 2025", () => {
    // QBI 1,500, taxable income 500: min(300, 100) = 100
    expect(computeQbi(dollars(1_500), dollars(500), "single", cfg)).toBe(dollars(100));
  });

  it("single, halfway through the $50,000 band", () => {
    // Threshold 197,300; 222,300 is 25,000 over (half of 50,000).
    // 20% × 200,000 = 40,000; reduction 20,000 → 20,000. Cap 44,460 does not bind.
    expect(computeQbi(dollars(200_000), dollars(222_300), "single", cfg)).toBe(dollars(20_000));
  });

  it("above the band the deduction is 0", () => {
    // MFJ threshold 394,600 + 100,000 = 494,600; 600,000 is above it.
    expect(computeQbi(dollars(500_000), dollars(600_000), "mfj", cfg)).toBe(0);
  });
});
