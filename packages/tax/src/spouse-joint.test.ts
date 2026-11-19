import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import { estimateYear } from "./engine.ts";
import type { FilingStatus } from "@fiscode/core";
import type { TaxInput } from "./types.ts";

// Demo: $60,000 of 1099 income, no expenses, Utah, 2026. A spouse block holds $45,000 of W-2 wages,
// $4,500 federal and $1,800 Utah withholding. A spouse's wages and withholding belong on a joint
// return only: a single, head-of-household or married-filing-separately return has the filer's own.
const input = (filingStatus: FilingStatus, withSpouse: boolean): TaxInput => ({
  year: 2026,
  filingStatus,
  state: "UT",
  gross1099: dollars(60_000),
  deductibleExpenses: cents(0),
  spouseW2Wages: withSpouse ? dollars(45_000) : cents(0),
  spouseFederalWithholding: withSpouse ? dollars(4_500) : cents(0),
  spouseStateWithholding: withSpouse ? dollars(1_800) : cents(0),
  priorYearTotalTax: undefined,
  priorYearAgi: undefined,
});

const run = (filingStatus: FilingStatus, withSpouse: boolean) =>
  estimateYear({ entity: "sole_prop", method: "even", input: input(filingStatus, withSpouse) });

describe("spouse wages and withholding count on a joint return only", () => {
  for (const status of ["single", "hoh", "mfs"] as const) {
    it(`${status}: a spouse block changes nothing (estimate, quarters, safe harbor, Utah)`, () => {
      expect(run(status, true)).toEqual(run(status, false));
    });
  }

  it("single, hand-checked: the spouse's $45,000 and withholding are left out", () => {
    const { estimate } = run("single", true);
    // SE: 60,000 × 0.9235 = 55,410; × 15.3% = 8,477.73. Half: 4,238.87 (4,238.865 rounded).
    expect(estimate.se.totalSeTax).toBe(8_477_73);
    expect(estimate.agi).toBe(55_761_13);
    // AGI 60,000 − 4,238.87 = 55,761.13 (no spouse wages). Taxable before QBI: − 16,100 = 39,661.13.
    // QBI: 20% × 55,761.13 = 11,152.23, capped at 20% × 39,661.13 = 7,932.23. Taxable 31,728.90.
    // Tax: 10% × 12,400 = 1,240.00 + 12% × 19,328.90 = 2,319.47 → 3,559.47.
    expect(estimate.federal.qbiDeduction).toBe(7_932_23);
    expect(estimate.federal.taxableIncome).toBe(31_728_90);
    expect(estimate.federal.federalIncomeTax).toBe(3_559_47);
    expect(estimate.federalWithholding).toBe(0);
    expect(estimate.stateWithholding).toBe(0);
  });

  it("mfj: the spouse's wages raise AGI and the withholding counts", () => {
    const withSpouse = run("mfj", true);
    const without = run("mfj", false);
    expect(withSpouse.estimate.federalWithholding).toBe(dollars(4_500));
    expect(withSpouse.estimate.stateWithholding).toBe(dollars(1_800));
    expect(withSpouse.estimate.agi).toBe(without.estimate.agi + dollars(45_000));
  });
});
