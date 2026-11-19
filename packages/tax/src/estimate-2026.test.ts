import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import { config2026 } from "./config/2026.ts";
import { soleProprietorStrategy } from "./strategy/sole-prop.ts";
import type { TaxInput } from "./types.ts";

// Demo filers, worked by hand from the 2026 figures (Rev. Proc. 2025-32 for
// the standard deduction and brackets; 1040-ES 2026 for the SE tax rates).
// Texas has no income tax, so these pin the federal side alone. Amounts are
// rounded to the cent at each step, as the engine does.
const input = (overrides: Partial<TaxInput>): TaxInput => ({
  year: 2026,
  filingStatus: "single",
  state: "TX",
  gross1099: dollars(0),
  deductibleExpenses: dollars(0),
  spouseW2Wages: cents(0),
  spouseFederalWithholding: cents(0),
  spouseStateWithholding: cents(0),
  priorYearTotalTax: undefined,
  priorYearAgi: undefined,
  ...overrides,
});

describe("2026 estimate, demo filers", () => {
  it("single: $60,000 of 1099 income, $5,000 of expenses", () => {
    const e = soleProprietorStrategy.compute(
      input({ gross1099: dollars(60_000), deductibleExpenses: dollars(5_000) }),
      config2026,
    );
    // Net profit            60,000 − 5,000                         = 55,000.00
    // Net SE earnings       55,000 × 0.9235                        = 50,792.50
    // Social Security       50,792.50 × 0.124                      =  6,298.27
    // Medicare              50,792.50 × 0.029 = 1,472.9825         =  1,472.98
    // SE tax                6,298.27 + 1,472.98                    =  7,771.25
    // Half SE tax           7,771.25 / 2 = 3,885.625               =  3,885.63
    // AGI                   55,000 − 3,885.63                      = 51,114.37
    // Before QBI            51,114.37 − 16,100 (std deduction)     = 35,014.37
    // QBI                   min(20% × 51,114.37, 20% × 35,014.37)  =  7,002.87
    // Taxable income        35,014.37 − 7,002.87                   = 28,011.50
    // Income tax            1,240 + 12% × (28,011.50 − 12,400)     =  3,113.38
    // Total                 3,113.38 + 7,771.25                    = 10,884.63
    expect(e.netProfit).toBe(dollars(55_000));
    expect(e.se.totalSeTax).toBe(dollars(7_771.25));
    expect(e.agi).toBe(dollars(51_114.37));
    expect(e.federal.qbiDeduction).toBe(dollars(7_002.87));
    expect(e.federal.taxableIncome).toBe(dollars(28_011.5));
    expect(e.federal.federalIncomeTax).toBe(dollars(3_113.38));
    expect(e.totalLiability).toBe(dollars(10_884.63));
  });

  it("married filing jointly: $120,000 of 1099 income, $5,000 of expenses", () => {
    const e = soleProprietorStrategy.compute(
      input({
        filingStatus: "mfj",
        gross1099: dollars(120_000),
        deductibleExpenses: dollars(5_000),
      }),
      config2026,
    );
    // Net profit            120,000 − 5,000                        = 115,000.00
    // Net SE earnings       115,000 × 0.9235                       = 106,202.50
    // Social Security       106,202.50 × 0.124                     =  13,169.11
    // Medicare              106,202.50 × 0.029 = 3,079.8725        =   3,079.87
    // SE tax                13,169.11 + 3,079.87                   =  16,248.98
    // Half SE tax           16,248.98 / 2                          =   8,124.49
    // AGI                   115,000 − 8,124.49                     = 106,875.51
    // Before QBI            106,875.51 − 32,200 (std deduction)    =  74,675.51
    // QBI                   min(20% × 106,875.51, 20% × 74,675.51) =  14,935.10
    // Taxable income        74,675.51 − 14,935.10                  =  59,740.41
    // Income tax            2,480 + 12% × (59,740.41 − 24,800)
    //                       = 2,480 + 4,192.8492                   =   6,672.85
    // Total                 6,672.85 + 16,248.98                   =  22,921.83
    expect(e.netProfit).toBe(dollars(115_000));
    expect(e.se.totalSeTax).toBe(dollars(16_248.98));
    expect(e.agi).toBe(dollars(106_875.51));
    expect(e.federal.qbiDeduction).toBe(dollars(14_935.1));
    expect(e.federal.taxableIncome).toBe(dollars(59_740.41));
    expect(e.federal.federalIncomeTax).toBe(dollars(6_672.85));
    expect(e.totalLiability).toBe(dollars(22_921.83));
  });
});
