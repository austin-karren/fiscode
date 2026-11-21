import { describe, expect, it } from "vitest";

import { defaultAppliedQuarter } from "../lib/w2-payments-stub";
import { defaultTaxYear, paymentInsertFrom, paymentSchema } from "./payment-form";
import { w2InsertFrom, w2Schema, w2Defaults } from "./w2-job-form";

const payment = (over: Record<string, unknown> = {}) => ({
  date: new Date(2026, 3, 10),
  amount: "1200",
  jurisdiction: "federal" as const,
  taxYear: "2026",
  appliedQuarter: "auto" as const,
  notes: "",
  ...over,
});

describe("payment form", () => {
  it.each([
    ["", "Enter an amount, like 12.50"],
    ["0", "Must be more than $0"],
    ["abc", "Enter an amount, like 12.50"],
  ])("refuses amount %j", (amount, message) => {
    const r = paymentSchema.safeParse(payment({ amount }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(message);
  });

  it("needs a date", () => {
    expect(paymentSchema.safeParse(payment({ date: undefined })).success).toBe(false);
  });

  it("saves cents, the year, and null for a quarter left to the date", () => {
    expect(paymentInsertFrom(payment({ notes: "  Demo IRS Direct Pay " }))).toEqual({
      date: "2026-04-10",
      amountCents: 120_000,
      jurisdiction: "federal",
      taxYear: 2026,
      appliedQuarter: null,
      notes: "Demo IRS Direct Pay",
    });
    expect(paymentInsertFrom(payment({ appliedQuarter: "3" })).appliedQuarter).toBe(3);
  });

  it.each([
    ["2026-01-10", 2025], // by Jan 15: last year's Q4
    ["2026-01-15", 2025],
    ["2026-01-16", 2026],
    ["2026-06-01", 2026],
  ])("defaults the tax year of a payment dated %s to %i", (iso, year) => {
    expect(defaultTaxYear(iso)).toBe(year);
  });
});

describe("applied quarter from the date", () => {
  it.each([
    ["2026-01-20", 2026, 1],
    ["2026-04-15", 2026, 1], // on the due date: that quarter
    ["2026-04-16", 2026, 2],
    ["2026-06-15", 2026, 2],
    ["2026-09-01", 2026, 3],
    ["2026-12-20", 2026, 4],
    ["2027-01-15", 2026, 4], // January payment for last year: Q4
  ])("%s for %i goes to Q%i", (iso, year, q) => {
    expect(defaultAppliedQuarter(iso, year)).toBe(q);
  });
});

describe("W-2 form", () => {
  it("needs the employer", () => {
    const r = w2Schema.safeParse({ ...w2Defaults(2026), employer: "  " });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Enter the employer");
  });

  it("refuses a negative or non-numeric box", () => {
    expect(
      w2Schema.safeParse({ ...w2Defaults(2026), employer: "Demo Corp", wages: "-5" }).success,
    ).toBe(false);
    expect(
      w2Schema.safeParse({ ...w2Defaults(2026), employer: "Demo Corp", wages: "x" }).success,
    ).toBe(false);
  });

  it("saves each box in cents, a blank box as $0, and the dates as ISO", () => {
    const row = w2InsertFrom({
      ...w2Defaults(2026),
      employer: "Demo Corp",
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 1, 18),
      wages: "8500",
      federalWithholding: "950.50",
      ssWages: "8500",
      medicareWages: "8500",
      stateWithholding: "380",
    });
    expect(row).toMatchObject({
      taxYear: 2026,
      employer: "Demo Corp",
      startDate: "2026-01-01",
      endDate: "2026-02-18",
      wagesCents: 850_000,
      federalWithholdingCents: 95_050,
      ssWagesCents: 850_000,
      ssTipsCents: 0,
      ssTaxWithheldCents: 0,
      medicareWagesCents: 850_000,
      stateWagesCents: 0,
      stateWithholdingCents: 38_000,
      notes: null,
    });
  });
});
