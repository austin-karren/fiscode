import { describe, expect, it } from "vitest";
import { exampleBundle, type Bundle } from "@fiscode/csv";
import { estimateBundleYear } from "@fiscode/tax";

// DF-06: the quarterly plan follows Form 2210. The four required installments
// add up to the year's required annual payment (line 9, the safe-harbor
// floor), and what is left to pay subtracts withholding a quarter at a time.
// Demo data only.

const plan = (b: Bundle, method: "even" | "annualized") =>
  estimateBundleYear({ ...b, profile: { ...b.profile!, quarterlyMethod: method } }, 2026).result;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const withIncomeOn = (date: string): Bundle => {
  const b = exampleBundle();
  b.spouses = [];
  b.income = b.income.map((r) => ({ ...r, date }));
  return b;
};

describe("quarterly plan, Form 2210", () => {
  for (const method of ["annualized", "even"] as const) {
    it(`${method}: example data, withholding leaves under $1,000, so none is required`, () => {
      // Form 2210 line 7: "If less than $1,000, stop; you don't owe a penalty."
      const r = plan(exampleBundle(), method);
      expect(r.estimate.remainingOwed).toBeLessThan(1_000_00);
      expect(r.quarterly.noInstallmentsRequired).toBe(true);
      expect(r.quarterly.payments.map((p) => p.requiredInstallment)).toEqual([0, 0, 0, 0]);
    });

    it(`${method}: example data without the spouse adds up too, and nothing is withheld`, () => {
      const b = exampleBundle();
      b.spouses = [];
      const r = plan(b, method);
      const required = r.quarterly.payments.map((p) => p.requiredInstallment);
      expect(sum(required)).toBe(r.safeHarbor.floor);
      expect(r.quarterly.payments.map((p) => p.amount)).toEqual(required);
    });
  }

  it("example data: the spouse's withholding ($6,300) covers the year, so nothing is left to pay", () => {
    const r = plan(exampleBundle(), "annualized");
    expect(r.estimate.spouseWithholding).toBeGreaterThanOrEqual(r.safeHarbor.floor);
    expect(r.quarterly.payments.map((p) => p.amount)).toEqual([0, 0, 0, 0]);
  });

  it("front-loaded (all income in January): capped at the regular 25%, still adds up", () => {
    const r = plan(withIncomeOn("2026-01-15"), "annualized");
    const required = r.quarterly.payments.map((p) => p.requiredInstallment);
    expect(sum(required)).toBe(r.safeHarbor.floor);
    const even = plan(withIncomeOn("2026-01-15"), "even").quarterly.payments;
    expect(required).toEqual(even.map((p) => p.requiredInstallment));
  });

  it("back-loaded (all income in November): early quarters owe nothing, Q4 recaptures", () => {
    const r = plan(withIncomeOn("2026-11-02"), "annualized");
    const required = r.quarterly.payments.map((p) => p.requiredInstallment);
    expect(required.slice(0, 3)).toEqual([0, 0, 0]);
    expect(required[3]).toBe(r.safeHarbor.floor);
    // The saving against the regular method is having nothing due until January.
    const even = plan(withIncomeOn("2026-11-02"), "even").quarterly.payments;
    expect(even[0]!.requiredInstallment).toBeGreaterThan(0);
  });

  // The reviewer's cases: the example profile with the spouse's withholding
  // changed. Federal tax (income + SE) is $5,097.42 and Utah tax $1,110.00.
  const withWithholding = (federal: number, state: number) => {
    const b = exampleBundle();
    b.spouses = b.spouses.map((s) => ({
      ...s,
      annualFederalWithholdingCents: federal,
      annualStateWithholdingCents: state,
    }));
    return b;
  };

  it("case A: $597.42 left with the IRS, Utah unpaid: no IRS installments, Utah prepayment $999.00", () => {
    const r = plan(withWithholding(4_500_00, 0), "annualized");
    expect(r.estimate.federalLiability).toBe(5_097_42);
    expect(r.quarterly.noInstallmentsRequired).toBe(true);
    expect(r.quarterly.payments.map((p) => p.amount)).toEqual([0, 0, 0, 0]);
    // 90% × 1,110.00 = 999.00, no Utah withholding
    expect(r.statePrepayment).toMatchObject({ dueDate: "2027-04-15", minimum: 999_00 });
  });

  it("case B: $1,097.42 left with the IRS, Utah over-withheld: IRS installments required", () => {
    const r = plan(withWithholding(4_000_00, 3_000_00), "even");
    expect(r.quarterly.noInstallmentsRequired).toBe(false);
    // Line 9 = 90% × 5,097.42 = 4,587.678 → 4,587.68; 25% each = 1,146.92
    // Federal withholding 4,000 → 1,000 a quarter → 146.92 left each quarter
    expect(r.safeHarbor.floor).toBe(4_587_68);
    expect(r.quarterly.payments.map((p) => p.amount)).toEqual([146_92, 146_92, 146_92, 146_92]);
    // Utah: 999.00 − 3,000.00 withheld → nothing due
    expect(r.statePrepayment?.minimum).toBe(0);
  });
});
