import { describe, expect, it } from "vitest";
import { exampleBundle, type Bundle } from "@fiscode/csv";
import { estimateYear } from "@fiscode/tax";
import { buildAnnualizedInput, buildTaxInput } from "./tax-input.ts";

// DF-06: the quarterly plan follows Form 2210. The four required installments
// add up to the year's required annual payment (line 9, the safe-harbor
// floor), and what is left to pay subtracts withholding a quarter at a time.
// Demo data only.

const plan = (b: Bundle, method: "even" | "annualized") =>
  estimateYear({
    entity: "sole_prop",
    method,
    input: method === "annualized" ? buildAnnualizedInput(b, 2026) : buildTaxInput(b, 2026),
  });

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
});
