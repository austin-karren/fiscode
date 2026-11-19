import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import { estimateYear } from "./engine.ts";
import type { TaxInput } from "./types.ts";

// Utah prepayment, TC-546 (Rev. 10/26), https://files.tax.utah.gov/tax/forms/current/tc-546.pdf:
//   line 3 = 90% of the Utah tax you expect to owe this year
//   line 4 = last year's Utah tax liability (fiscode has no input for it: not used)
//   line 5 = the lesser of line 3 or line 4
//   line 8 = line 5 − Utah withholding − prepayments; "If less than zero, a
//            payment is not due at this time."
// Due "on or before the return due date": Utah Code 59-10-514(1)(a)(i), the
// day the federal return is due (April 15 of the next year).
const input = (overrides: Partial<TaxInput>): TaxInput => ({
  year: 2026,
  filingStatus: "single",
  state: "UT",
  gross1099: dollars(60_000),
  deductibleExpenses: dollars(5_000),
  spouseW2Wages: cents(0),
  spouseFederalWithholding: cents(0),
  spouseStateWithholding: cents(0),
  priorYearTotalTax: undefined,
  priorYearAgi: undefined,
  ...overrides,
});

const run = (overrides: Partial<TaxInput>) =>
  estimateYear({ entity: "sole_prop", method: "even", input: input(overrides) });

describe("Utah prepayment (TC-546)", () => {
  it("90% of this year's Utah tax, due April 15 of the next year", () => {
    // Single, $60,000 / $5,000: Utah tax $1,730.03 (utah-2026.test.ts)
    // 90% × 1,730.03 = 1,557.027 → 1,557.03; no Utah withholding
    const r = run({});
    expect(r.estimate.state.stateIncomeTax).toBe(dollars(1_730.03));
    expect(r.statePrepayment).toEqual({
      state: "UT",
      dueDate: "2027-04-15",
      minimum: dollars(1_557.03),
      basis: "currentYear90",
    });
  });

  it("subtracts Utah withholding only", () => {
    // 1,557.03 − 500.00 Utah withholding = 1,057.03; federal withholding ignored
    const r = run({
      spouseStateWithholding: dollars(500),
      spouseFederalWithholding: dollars(9_999),
    });
    expect(r.statePrepayment?.minimum).toBe(dollars(1_057.03));
  });

  it("is $0 when Utah withholding covers it", () => {
    const r = run({ spouseStateWithholding: dollars(1_557.03) });
    expect(r.statePrepayment?.minimum).toBe(0);
  });

  it("no Utah prepayment for another state", () => {
    expect(run({ state: "TX" }).statePrepayment).toBeUndefined();
  });
});
