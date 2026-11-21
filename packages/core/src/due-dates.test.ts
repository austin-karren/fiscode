import { describe, expect, it } from "vitest";
import { defaultAppliedQuarter, defaultTaxYear, federalDueDates } from "./due-dates.ts";

describe("federalDueDates", () => {
  it("2026: Apr 15, Jun 15, Sep 15, Jan 15 2027 (all weekdays)", () => {
    expect(federalDueDates(2026)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
  });
  it("a weekend due date moves to the next business day: Jun 15, 2025 is a Sunday", () => {
    expect(federalDueDates(2025)[1]).toBe("2025-06-16");
  });
});

describe("defaultAppliedQuarter and defaultTaxYear", () => {
  it("each date counts toward the first due date on or after it", () => {
    expect(defaultAppliedQuarter("2026-04-15")).toBe(1);
    expect(defaultAppliedQuarter("2026-04-16")).toBe(2);
    expect(defaultAppliedQuarter("2026-07-01")).toBe(3);
    expect(defaultAppliedQuarter("2026-12-31")).toBe(4);
  });
  it("a payment on or before the January due date is last year's fourth installment", () => {
    expect(defaultTaxYear("2027-01-15")).toBe(2026);
    expect(defaultAppliedQuarter("2027-01-15")).toBe(4);
    expect(defaultTaxYear("2027-01-16")).toBe(2027);
    expect(defaultAppliedQuarter("2027-01-16")).toBe(1);
  });
  it("after the last due date of the tax year given: the fourth", () => {
    expect(defaultAppliedQuarter("2027-02-01", 2026)).toBe(4);
  });
});
