import { describe, expect, it } from "vitest";
import { cents, dollars, isoDate } from "@fiscode/core";
import { config2025 } from "./config/2025.ts";
import { config2026 } from "./config/2026.ts";
import {
  evenQuarterly,
  nextDueQuarter,
  quarterPeriods,
  recommendedPrepDate,
  yearFromPlan,
  zeroPayment,
} from "./quarterly.ts";
import type { TaxEstimate } from "./types.ts";

const estimate = (year: number, owed: number): TaxEstimate =>
  ({
    year,
    netProfit: cents(0),
    agi: cents(0),
    se: {
      netSeEarnings: cents(0),
      socialSecurityTax: cents(0),
      medicareTax: cents(0),
      additionalMedicareTax: cents(0),
      regularSeTax: cents(0),
      totalSeTax: cents(0),
      halfSeTaxDeduction: cents(0),
    },
    federal: { taxableIncome: cents(0), qbiDeduction: cents(0), federalIncomeTax: cents(0) },
    state: { taxableIncome: cents(0), rate: 0, stateIncomeTax: cents(0) },
    spouseWithholding: cents(0),
    totalLiability: dollars(owed),
    remainingOwed: dollars(owed),
  }) as TaxEstimate;

describe("quarterPeriods", () => {
  it("uses uneven IRS quarters (3/2/3/4 months)", () => {
    const p = quarterPeriods(2026);
    expect(p).toEqual([
      { start: "2026-01-01", end: "2026-03-31" },
      { start: "2026-04-01", end: "2026-05-31" },
      { start: "2026-06-01", end: "2026-08-31" },
      { start: "2026-09-01", end: "2026-12-31" },
    ]);
  });
});

describe("evenQuarterly", () => {
  it("splits remainingOwed into four equal installments", () => {
    const plan = evenQuarterly(estimate(2026, 12_000), config2026);
    for (const p of plan.payments) {
      expect(p.amount).toBe(dollars(3_000));
    }
    expect(plan.method).toBe("even");
  });

  it("attaches the shifted business-day due date for each quarter", () => {
    const plan = evenQuarterly(estimate(2026, 4_000), config2026);
    expect(plan.payments[0]!.dueDate).toBe("2026-04-15");
    expect(plan.payments[1]!.dueDate).toBe("2026-06-15");
    expect(plan.payments[2]!.dueDate).toBe("2026-09-15");
    expect(plan.payments[3]!.dueDate).toBe("2027-01-15");
  });

  it("2025 Q2 due date is configured as Jun 16 (Sun → Mon shift)", () => {
    const plan = evenQuarterly(estimate(2025, 4_000), config2025);
    expect(plan.payments[1]!.dueDate).toBe("2025-06-16");
  });
});

describe("nextDueQuarter", () => {
  it("returns the first payment whose dueDate is on or after today", () => {
    const plan = evenQuarterly(estimate(2026, 4_000), config2026);
    expect(nextDueQuarter(plan, isoDate("2026-01-01"))?.quarter).toBe(1);
    expect(nextDueQuarter(plan, isoDate("2026-04-15"))?.quarter).toBe(1);
    expect(nextDueQuarter(plan, isoDate("2026-04-16"))?.quarter).toBe(2);
    expect(nextDueQuarter(plan, isoDate("2026-10-01"))?.quarter).toBe(4);
  });

  it("returns undefined when all are past", () => {
    const plan = evenQuarterly(estimate(2026, 4_000), config2026);
    expect(nextDueQuarter(plan, isoDate("2027-02-01"))).toBeUndefined();
  });
});

describe("recommendedPrepDate", () => {
  it("subtracts the given number of days", () => {
    expect(recommendedPrepDate(isoDate("2026-04-15"), 14)).toBe("2026-04-01");
  });
});

describe("yearFromPlan + zeroPayment", () => {
  it("yearFromPlan reads the year of the first period", () => {
    const plan = evenQuarterly(estimate(2026, 4_000), config2026);
    expect(yearFromPlan(plan)).toBe(2026);
  });

  it("zeroPayment returns a $0 payment with the right period + due date", () => {
    const z = zeroPayment(2026, 3, config2026);
    expect(z.amount).toBe(0);
    expect(z.quarter).toBe(3);
    expect(z.periodStart).toBe("2026-06-01");
    expect(z.periodEnd).toBe("2026-08-31");
    expect(z.dueDate).toBe("2026-09-15");
  });
});
