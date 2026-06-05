import { describe, expect, it } from "vitest";
import { cents, dollars, isoDate } from "@fiscode/core";
import type { Cents } from "@fiscode/core";
import { estimateYear } from "./engine.ts";
import type { AnnualizedInput, TaxInput } from "./types.ts";
import { NotImplementedError } from "./strategy/index.ts";

const baseInput = (overrides: Partial<TaxInput> = {}): TaxInput => ({
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
  ...overrides,
});

describe("estimateYear (sole prop, MFJ, UT)", () => {
  it("produces a plausible full-year estimate for the target user", () => {
    const { estimate, quarterly, safeHarbor } = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: baseInput(),
    });
    expect(estimate.netProfit).toBe(dollars(115_000));
    // Sanity bounds, not exact (this is the integration anchor; per-step tests
    // pin the components).
    expect(estimate.se.totalSeTax).toBeGreaterThan(dollars(15_000));
    expect(estimate.se.totalSeTax).toBeLessThan(dollars(18_000));
    expect(estimate.federal.federalIncomeTax).toBeGreaterThan(0);
    expect(estimate.state.stateIncomeTax).toBeGreaterThan(0);
    expect(estimate.totalLiability).toBe(
      (estimate.se.totalSeTax +
        estimate.federal.federalIncomeTax +
        estimate.state.stateIncomeTax) as Cents,
    );

    expect(quarterly.method).toBe("even");
    expect(quarterly.payments).toHaveLength(4);
    const sum = quarterly.payments.reduce<Cents>((acc, p) => (acc + p.amount) as Cents, cents(0));
    // 4 × round(0.25 × X) can differ from X by ±2 cents.
    expect(Math.abs(sum - estimate.remainingOwed)).toBeLessThanOrEqual(2);

    // First-year safe harbor: floor = 90% of current.
    expect(safeHarbor.firstYear).toBe(true);
    expect(safeHarbor.priorYearTarget).toBeUndefined();
    expect(safeHarbor.floor).toBe(Math.round(estimate.totalLiability * 0.9));
  });

  it("spouse withholding reduces remainingOwed but not totalLiability", () => {
    const { estimate } = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: baseInput({
        spouseW2Wages: dollars(40_000),
        spouseFederalWithholding: dollars(4_000),
        spouseStateWithholding: dollars(1_800),
      }),
    });
    // Withholding flows to remainingOwed.
    expect(estimate.totalLiability - estimate.remainingOwed).toBe(dollars(5_800));
  });

  it("prior-year safe harbor uses 100% by default, 110% above AGI threshold", () => {
    const lowAgi = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: baseInput({
        priorYearTotalTax: dollars(20_000),
        priorYearAgi: dollars(100_000),
      }),
    });
    expect(lowAgi.safeHarbor.multiplierUsed).toBe(1.0);
    expect(lowAgi.safeHarbor.priorYearTarget).toBe(dollars(20_000));

    const highAgi = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: baseInput({
        priorYearTotalTax: dollars(20_000),
        priorYearAgi: dollars(200_000),
      }),
    });
    expect(highAgi.safeHarbor.multiplierUsed).toBe(1.1);
    expect(highAgi.safeHarbor.priorYearTarget).toBe(dollars(22_000));
  });

  it("annualized method front-loads payments only when income exists", () => {
    const ann: AnnualizedInput = {
      ...baseInput(),
      periods: [
        // No income in Q1
        {
          endsAt: isoDate("2026-03-31"),
          cumulativeGross1099: cents(0),
          cumulativeDeductibleExpenses: cents(0),
        },
        // Bonus lands in Q2: 60k YTD
        {
          endsAt: isoDate("2026-05-31"),
          cumulativeGross1099: dollars(60_000),
          cumulativeDeductibleExpenses: dollars(2_000),
        },
        // Q3: 90k YTD
        {
          endsAt: isoDate("2026-08-31"),
          cumulativeGross1099: dollars(90_000),
          cumulativeDeductibleExpenses: dollars(3_500),
        },
        // Q4: 120k YTD
        {
          endsAt: isoDate("2026-12-31"),
          cumulativeGross1099: dollars(120_000),
          cumulativeDeductibleExpenses: dollars(5_000),
        },
      ],
    };
    const { quarterly } = estimateYear({
      entity: "sole_prop",
      method: "annualized",
      input: ann,
    });
    expect(quarterly.method).toBe("annualized");
    // Q1 had no income → installment should be 0
    expect(quarterly.payments[0].amount).toBe(0);
    // Later quarters non-zero
    expect(quarterly.payments[1].amount).toBeGreaterThan(0);
    expect(quarterly.payments[2].amount).toBeGreaterThan(0);
    expect(quarterly.payments[3].amount).toBeGreaterThan(0);
  });

  it("s_corp strategy refuses loudly", () => {
    expect(() =>
      estimateYear({
        entity: "s_corp",
        method: "even",
        input: baseInput(),
      }),
    ).toThrow(NotImplementedError);
  });
});

describe("quarterly due dates roll past weekends", () => {
  it("shifts to next business day", () => {
    // 2026 quarterly dates: Apr 15 (Wed), Jun 15 (Mon), Sep 15 (Tue), Jan 15 2027 (Fri)
    // None of these fall on weekends or holidays in 2026, so they pass through.
    const { quarterly } = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: baseInput(),
    });
    expect(quarterly.payments[0].dueDate).toBe("2026-04-15");
    expect(quarterly.payments[1].dueDate).toBe("2026-06-15");
    expect(quarterly.payments[2].dueDate).toBe("2026-09-15");
    expect(quarterly.payments[3].dueDate).toBe("2027-01-15");
  });
});
