import { describe, expect, it } from "vitest";
import { actualHomeOfficeExpenses, limitToTentativeProfit } from "./home-office.ts";

// Demo renter: 200 of 2,000 sq ft (10%), $1,500 rent + $200 utilities + $30 insurance a month.
const renter = {
  officeSqft: 200,
  homeSqft: 2000,
  monthlyRentMortgageCents: 150_000,
  monthlyUtilitiesCents: 20_000,
  monthlyInsuranceCents: 3_000,
};

describe("actualHomeOfficeExpenses (Form 8829 lines 1-7, 18-24)", () => {
  it("full year: ($1,500 + $200 + $30) × 12 × 10% = $2,076.00", () => {
    // 173,000¢ × 12 = 2,076,000¢; × 200/2000 = 207,600¢
    expect(actualHomeOfficeExpenses({ ...renter, monthsActive: 12 })).toEqual({
      amount: 207_600,
      areaRejected: false,
    });
  });

  it("partial year: Jul 1 - Dec 31 2026 is 184 of 365 days", () => {
    // 2,076,000¢ × (184/365) × 10% = 38,198,400 / 365 = 104,653.15 → 104,653¢
    const r = actualHomeOfficeExpenses({ ...renter, monthsActive: (184 / 365) * 12 });
    expect(r.amount).toBe(104_653);
  });

  it("rejects an office larger than the home: $0 and flagged", () => {
    expect(
      actualHomeOfficeExpenses({ ...renter, officeSqft: 5000, homeSqft: 100, monthsActive: 12 }),
    ).toEqual({ amount: 0, areaRejected: true });
  });

  it("missing area or costs give $0 without a flag", () => {
    expect(actualHomeOfficeExpenses({ ...renter, homeSqft: null, monthsActive: 12 }).amount).toBe(0);
    expect(actualHomeOfficeExpenses({ ...renter, officeSqft: 0, monthsActive: 12 }).amount).toBe(0);
    // Only utilities: 20,000 × 12 × 10% = 24,000¢
    expect(
      actualHomeOfficeExpenses({
        ...renter,
        monthlyRentMortgageCents: null,
        monthlyInsuranceCents: null,
        monthsActive: 12,
      }).amount,
    ).toBe(24_000);
  });

  it("office equal to the home is 100%", () => {
    // 173,000 × 12 = 2,076,000¢
    expect(
      actualHomeOfficeExpenses({ ...renter, officeSqft: 2000, monthsActive: 12 }).amount,
    ).toBe(2_076_000);
  });
});

describe("limitToTentativeProfit (Form 8829 lines 8, 15, 27, 43)", () => {
  it("allows the whole amount under the limit", () => {
    expect(limitToTentativeProfit(207_600, 5_000_000)).toEqual({ allowed: 207_600, disallowed: 0 });
  });
  it("caps at tentative profit; the rest is the line 43 carryover", () => {
    // $1,000 income − $300 expenses = $700 tentative profit; $2,076 − $700 = $1,376 not allowed
    expect(limitToTentativeProfit(207_600, 70_000)).toEqual({
      allowed: 70_000,
      disallowed: 137_600,
    });
  });
  it("a loss before the home office allows nothing", () => {
    expect(limitToTentativeProfit(207_600, -10_000)).toEqual({ allowed: 0, disallowed: 207_600 });
  });
});
