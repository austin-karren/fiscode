import { describe, expect, it } from "vitest";
import { cents, dollars, isoDate } from "@fiscode/core";
import { config2026 } from "./config/2026.ts";
import { annualizedQuarterly } from "./annualized.ts";
import { soleProprietorStrategy } from "./strategy/sole-prop.ts";
import type { AnnualizedInput } from "./types.ts";

const input = (overrides: Partial<AnnualizedInput> = {}): AnnualizedInput =>
  ({
    year: 2026,
    filingStatus: "mfj",
    state: "UT",
    gross1099: dollars(120_000),
    deductibleExpenses: dollars(5_000),
    spouseW2Wages: cents(0),
    spouseFederalWithholding: cents(0),
    spouseStateWithholding: cents(0),
    priorYearTotalTax: undefined,
    priorYearAgi: undefined,
    periods: [
      {
        endsAt: isoDate("2026-03-31"),
        cumulativeGross1099: dollars(30_000),
        cumulativeDeductibleExpenses: dollars(1_250),
      },
      {
        endsAt: isoDate("2026-05-31"),
        cumulativeGross1099: dollars(50_000),
        cumulativeDeductibleExpenses: dollars(2_100),
      },
      {
        endsAt: isoDate("2026-08-31"),
        cumulativeGross1099: dollars(80_000),
        cumulativeDeductibleExpenses: dollars(3_400),
      },
      {
        endsAt: isoDate("2026-12-31"),
        cumulativeGross1099: dollars(120_000),
        cumulativeDeductibleExpenses: dollars(5_000),
      },
    ],
    ...overrides,
  }) as AnnualizedInput;

describe("annualizedQuarterly", () => {
  const cfg = config2026;
  // Required annual payment for a first-year filer: 90% of the year's federal tax.
  const required90 = () =>
    Math.round(soleProprietorStrategy.compute(input(), cfg).federalLiability * 0.9) as never;

  it("returns four payments with the correct period/due-date metadata", () => {
    const plan = annualizedQuarterly(input(), cfg, soleProprietorStrategy, required90());
    expect(plan.method).toBe("annualized");
    expect(plan.payments).toHaveLength(4);
    expect(plan.payments[0]!.periodStart).toBe("2026-01-01");
    expect(plan.payments[0]!.periodEnd).toBe("2026-03-31");
    expect(plan.payments[0]!.dueDate).toBe("2026-04-15");
    expect(plan.payments[3]!.periodEnd).toBe("2026-12-31");
    expect(plan.payments[3]!.dueDate).toBe("2027-01-15");
  });

  it("the four required installments add up to the required annual payment (Form 2210 line 9)", () => {
    const plan = annualizedQuarterly(input(), cfg, soleProprietorStrategy, required90());
    const total = plan.payments.reduce((sum, p) => sum + p.requiredInstallment, 0);
    expect(total).toBe(required90());
    // No withholding here, so what is left to pay equals the installment.
    for (const p of plan.payments) expect(p.amount).toBe(p.requiredInstallment);
  });

  it("zero-income periods produce zero installments", () => {
    const ann = input({
      periods: [
        {
          endsAt: isoDate("2026-03-31"),
          cumulativeGross1099: cents(0),
          cumulativeDeductibleExpenses: cents(0),
        },
        {
          endsAt: isoDate("2026-05-31"),
          cumulativeGross1099: cents(0),
          cumulativeDeductibleExpenses: cents(0),
        },
        {
          endsAt: isoDate("2026-08-31"),
          cumulativeGross1099: dollars(60_000),
          cumulativeDeductibleExpenses: dollars(2_500),
        },
        {
          endsAt: isoDate("2026-12-31"),
          cumulativeGross1099: dollars(120_000),
          cumulativeDeductibleExpenses: dollars(5_000),
        },
      ],
    });
    const plan = annualizedQuarterly(ann, cfg, soleProprietorStrategy, required90());
    expect(plan.payments[0]!.amount).toBe(0);
    expect(plan.payments[1]!.amount).toBe(0);
    // Q3 catches up to the cumulative requirement; Q4 closes the rest.
    expect(plan.payments[2]!.amount).toBeGreaterThan(0);
    expect(plan.payments[3]!.amount).toBeGreaterThan(0);
  });

  it("installment never goes negative even if a later cumulative requirement is lower than prior", () => {
    // Atypical: huge spike in Q1, then nothing more (income returned, refund situation).
    // The IRS cumulative-fraction method clamps installments at zero.
    const ann = input({
      periods: [
        {
          endsAt: isoDate("2026-03-31"),
          cumulativeGross1099: dollars(200_000),
          cumulativeDeductibleExpenses: cents(0),
        },
        {
          endsAt: isoDate("2026-05-31"),
          cumulativeGross1099: dollars(200_000),
          cumulativeDeductibleExpenses: cents(0),
        },
        {
          endsAt: isoDate("2026-08-31"),
          cumulativeGross1099: dollars(200_000),
          cumulativeDeductibleExpenses: cents(0),
        },
        {
          endsAt: isoDate("2026-12-31"),
          cumulativeGross1099: dollars(200_000),
          cumulativeDeductibleExpenses: cents(0),
        },
      ],
    });
    const plan = annualizedQuarterly(ann, cfg, soleProprietorStrategy, required90());
    for (const p of plan.payments) {
      expect(p.amount).toBeGreaterThanOrEqual(0);
    }
  });
});
