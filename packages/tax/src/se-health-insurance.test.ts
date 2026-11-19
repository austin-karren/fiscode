import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import { estimateYear } from "./engine.ts";
import type { TaxInput } from "./types.ts";

// Self-employed health insurance (SEHI), 2026, single, Utah, demo figures.
// Form 7206 (2025), https://www.irs.gov/pub/irs-pdf/f7206.pdf: line 14 "Enter the smaller of line 3
// [premiums] or line 13" = net profit (line 4) − deductible part of SE tax (line 7) − SEP/SIMPLE
// (line 9, not modelled: 0); "on Schedule 1 (Form 1040), line 17". i7206: "You can't subtract the
// self-employed health insurance deduction when figuring net earnings for your self-employment tax".
// Reg. 1.199A-3(b)(1)(vi): the SEHI deduction is "considered attributable to a trade or business"
// for QBI.
const input = (gross: number, expenses: number, premiums: number): TaxInput => ({
  year: 2026,
  filingStatus: "single",
  state: "UT",
  gross1099: dollars(gross),
  deductibleExpenses: dollars(expenses),
  selfEmployedHealthInsurance: dollars(premiums),
  spouseW2Wages: cents(0),
  spouseFederalWithholding: cents(0),
  spouseStateWithholding: cents(0),
  priorYearTotalTax: undefined,
  priorYearAgi: undefined,
});
const run = (gross: number, expenses: number, premiums: number) =>
  estimateYear({ entity: "sole_prop", method: "even", input: input(gross, expenses, premiums) })
    .estimate;

describe("self-employed health insurance: Schedule 1 line 17, not Schedule C", () => {
  it("$60,000 profit, $6,000 premiums: SE tax unchanged; AGI, QBI and tax lower (hand-checked)", () => {
    const e = run(60_000, 0, 6_000);
    // SE tax on the full $60,000: 60,000 × 0.9235 × 15.3% = $8,477.73 (as with no premiums).
    expect(e.se.totalSeTax).toBe(run(60_000, 0, 0).se.totalSeTax);
    expect(e.se.totalSeTax).toBe(8_477_73);
    expect(e.netProfit).toBe(dollars(60_000));
    // Limit: 60,000 − 4,238.87 = 55,761.13 ≥ 6,000 → $6,000 deducted.
    expect(e.selfEmployedHealthInsurance).toBe(dollars(6_000));
    // AGI 60,000 − 4,238.87 − 6,000 = 49,761.13. Before QBI: − 16,100 = 33,661.13.
    expect(e.agi).toBe(49_761_13);
    // QBI: 20% × (55,761.13 − 6,000 = 49,761.13) = 9,952.23, capped at 20% × 33,661.13 = 6,732.23.
    expect(e.federal.qbiDeduction).toBe(6_732_23);
    // Taxable 26,928.90. Tax 1,240.00 + 12% × 14,528.90 (1,743.47) = 2,983.47.
    expect(e.federal.taxableIncome).toBe(26_928_90);
    expect(e.federal.federalIncomeTax).toBe(2_983_47);
  });

  it("premiums above the limit are capped at net profit − ½ SE tax", () => {
    const e = run(5_000, 0, 6_000);
    expect(e.selfEmployedHealthInsurance).toBe(e.netProfit - e.se.halfSeTaxDeduction);
    expect(e.selfEmployedHealthInsurance).toBeLessThan(dollars(6_000));
  });

  it("a loss year deducts nothing", () => {
    const e = run(1_000, 2_000, 500);
    expect(e.netProfit).toBe(0);
    expect(e.selfEmployedHealthInsurance).toBe(0);
  });

  it("no premiums: same estimate as before", () => {
    const { selfEmployedHealthInsurance: _, ...withField } = input(60_000, 0, 0);
    const without = estimateYear({ entity: "sole_prop", method: "even", input: withField });
    expect(without.estimate.federal).toEqual(run(60_000, 0, 0).federal);
  });
});
