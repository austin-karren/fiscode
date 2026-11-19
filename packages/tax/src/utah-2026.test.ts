import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import { config2025 } from "./config/2025.ts";
import { config2026 } from "./config/2026.ts";
import { soleProprietorStrategy } from "./strategy/sole-prop.ts";
import type { TaxInput } from "./types.ts";

// Utah income tax, worked by hand from the 2026 TC-40 DRAFT dated 10/20/26
// (lines 7-18) and Utah Code 59-10-104 / 59-10-1018:
//   Utah taxable income (line 7) starts from federal AGI.
//   Tax (line 8)          = 4.45% × Utah taxable income
//   Credit (lines 9-18)   = 6% × (federal standard deduction + $2,167 × dependents)
//                           − 1.3% × (Utah taxable income − base), not below 0
//   Utah tax              = tax − credit, not below 0
// The federal side of these demo filers is worked in estimate-2026.test.ts.
const input = (overrides: Partial<TaxInput>): TaxInput => ({
  year: 2026,
  filingStatus: "single",
  state: "UT",
  gross1099: dollars(0),
  deductibleExpenses: dollars(0),
  spouseW2Wages: cents(0),
  spouseFederalWithholding: cents(0),
  spouseStateWithholding: cents(0),
  priorYearTotalTax: undefined,
  priorYearAgi: undefined,
  ...overrides,
});

describe("Utah 2026: flat rate on AGI minus the taxpayer tax credit", () => {
  it("single, no dependents: $60,000 of 1099 income, $5,000 of expenses", () => {
    const e = soleProprietorStrategy.compute(
      input({ gross1099: dollars(60_000), deductibleExpenses: dollars(5_000) }),
      config2026,
    );
    // AGI (federal)            = 51,114.37  → Utah taxable income
    // Tax      4.45% × 51,114.37 = 2,274.589465       = 2,274.59
    // Credit   6% × 16,100                            =   966.00
    // Phase-out 1.3% × (51,114.37 − 18,696) = 421.43881 = 421.44
    // Credit after phase-out   966.00 − 421.44        =   544.56
    // Utah tax 2,274.59 − 544.56                      = 1,730.03
    expect(e.state.taxableIncome).toBe(dollars(51_114.37));
    expect(e.state.taxpayerCredit).toBe(dollars(544.56));
    expect(e.state.stateIncomeTax).toBe(dollars(1_730.03));
    // Total = federal 3,113.38 + SE 7,771.25 + Utah 1,730.03
    expect(e.totalLiability).toBe(dollars(12_614.66));
  });

  it("married filing jointly, 2 dependents: $120,000 of 1099 income, $5,000 of expenses", () => {
    const e = soleProprietorStrategy.compute(
      input({
        filingStatus: "mfj",
        dependents: 2,
        gross1099: dollars(120_000),
        deductibleExpenses: dollars(5_000),
      }),
      config2026,
    );
    // AGI (federal)                = 106,875.51 → Utah taxable income
    // Tax      4.45% × 106,875.51 = 4,755.960195        = 4,755.96
    // Credit   6% × (32,200 + 2 × 2,167 = 36,534)      = 2,192.04
    // Phase-out 1.3% × (106,875.51 − 37,392) = 903.28563 = 903.29
    // Credit after phase-out   2,192.04 − 903.29       = 1,288.75
    // Utah tax 4,755.96 − 1,288.75                     = 3,467.21
    expect(e.state.taxableIncome).toBe(dollars(106_875.51));
    expect(e.state.taxpayerCredit).toBe(dollars(1_288.75));
    expect(e.state.stateIncomeTax).toBe(dollars(3_467.21));
  });

  it("the credit phases out completely and never goes below zero", () => {
    const e = soleProprietorStrategy.compute(input({ gross1099: dollars(200_000) }), config2026);
    // Net SE earnings 200,000 × 0.9235 = 184,700.00
    // SS 184,500 × 0.124 = 22,878.00; Medicare 184,700 × 0.029 = 5,356.30
    // Half SE tax (22,878.00 + 5,356.30) / 2 = 14,117.15; AGI = 185,882.85
    // Credit 966.00 − 1.3% × (185,882.85 − 18,696) = 966.00 − 2,173.43 → 0
    // Utah tax 4.45% × 185,882.85 = 8,271.786825 = 8,271.79
    expect(e.state.taxpayerCredit).toBe(0);
    expect(e.state.stateIncomeTax).toBe(dollars(8_271.79));
  });

  it("the credit can wipe out the tax but not go below zero", () => {
    const e = soleProprietorStrategy.compute(input({ gross1099: dollars(10_000) }), config2026);
    // Net SE 9,235.00; SS 1,145.14; Medicare 267.815 = 267.82; half = 706.48
    // AGI 9,293.52. Tax 4.45% × 9,293.52 = 413.56664 = 413.57
    // Credit 966.00, no phase-out (AGI below 18,696). 413.57 − 966.00 → 0
    expect(e.state.stateIncomeTax).toBe(0);
  });

  it("2025 uses the 2025 form's figures and 4.5%", () => {
    const e = soleProprietorStrategy.compute(
      input({ year: 2025, gross1099: dollars(60_000), deductibleExpenses: dollars(5_000) }),
      config2025,
    );
    // 2025 federal: std deduction 15,750 (Rev. Proc. 2025-32 §3.01). SE tax and
    // AGI as in 2026 (wage base not reached) = 51,114.37
    // Tax 4.5% × 51,114.37 = 2,300.14665 = 2,300.15
    // Credit 6% × 15,750 = 945.00; phase-out 1.3% × (51,114.37 − 18,213)
    //   = 427.71781 = 427.72; credit 945.00 − 427.72 = 517.28
    // Utah tax 2,300.15 − 517.28 = 1,782.87
    expect(e.state.taxpayerCredit).toBe(dollars(517.28));
    expect(e.state.stateIncomeTax).toBe(dollars(1_782.87));
  });

  it("another state keeps the flat-rate path (no rate configured: no tax)", () => {
    const e = soleProprietorStrategy.compute(
      input({ state: "TX", gross1099: dollars(60_000) }),
      config2026,
    );
    expect(e.state.stateIncomeTax).toBe(0);
    expect(e.state.taxpayerCredit).toBe(0);
  });
});
