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

// Even quarters of the base input's year, for the annualized method.
const annualPeriods = () =>
  [
    ["2026-03-31", 30_000, 1_250],
    ["2026-05-31", 50_000, 2_083.33],
    ["2026-08-31", 80_000, 3_333.33],
    ["2026-12-31", 120_000, 5_000],
  ].map(([endsAt, g, e]) => ({
    endsAt: isoDate(endsAt as string),
    cumulativeGross1099: dollars(g as number),
    cumulativeDeductibleExpenses: dollars(e as number),
  }));

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
    // Form 2210: the four installments add up to the required annual payment
    // (line 9), which for a first-year filer is 90% of this year's tax.
    expect(sum).toBe(safeHarbor.floor);

    // First-year safe harbor: floor = 90% of current.
    expect(safeHarbor.firstYear).toBe(true);
    expect(safeHarbor.priorYearTarget).toBeUndefined();
    // Form 2210 line 5: 90% of this year's federal tax (income tax + SE tax).
    expect(estimate.federalLiability).toBe(
      (estimate.federal.federalIncomeTax + estimate.se.totalSeTax) as Cents,
    );
    expect(safeHarbor.floor).toBe(Math.round(estimate.federalLiability * 0.9));
  });

  // Form 2210 line 7: "Subtract line 6 from line 4. If less than $1,000, stop;
  // you don't owe a penalty." Withholding is set so the tax left is exactly
  // the boundary amount.
  describe("the $1,000 no-penalty test (Form 2210 lines 4 and 7)", () => {
    // Federal tax only (Form 2210 line 4 = federal income tax + SE tax), minus
    // federal withholding only (line 6).
    const leaving = (left: number) => {
      const federal = estimateYear({ entity: "sole_prop", method: "even", input: baseInput() })
        .estimate.federalLiability;
      return baseInput({ spouseFederalWithholding: cents(federal - dollars(left)) });
    };

    for (const method of ["even", "annualized"] as const) {
      const run = (left: number) =>
        estimateYear({
          entity: "sole_prop",
          method,
          input:
            method === "annualized"
              ? ({ ...leaving(left), periods: annualPeriods() } as never)
              : leaving(left),
        });

      it(`${method}: $999.99 left after withholding → no installments`, () => {
        const r = run(999.99);
        expect(r.estimate.federalLiability - r.estimate.federalWithholding).toBe(dollars(999.99));
        expect(r.quarterly.noInstallmentsRequired).toBe(true);
        expect(r.quarterly.payments.map((p) => p.requiredInstallment)).toEqual([0, 0, 0, 0]);
        expect(r.quarterly.payments.map((p) => p.amount)).toEqual([0, 0, 0, 0]);
      });

      it(`${method}: $1,000.00 and $1,000.01 left → installments are required`, () => {
        for (const left of [1_000, 1_000.01]) {
          const r = run(left);
          expect(r.estimate.federalLiability - r.estimate.federalWithholding).toBe(dollars(left));
          expect(r.quarterly.noInstallmentsRequired).toBe(false);
          const req = r.quarterly.payments.reduce((a, p) => a + p.requiredInstallment, 0);
          expect(req).toBe(r.safeHarbor.floor);
        }
      });
    }

    it("the reviewer's tiny demo ($4,000 of 1099 income) needs no installments", () => {
      const r = estimateYear({
        entity: "sole_prop",
        method: "even",
        input: baseInput({ gross1099: dollars(4_000), deductibleExpenses: cents(0) }),
      });
      expect(r.estimate.federalLiability).toBeLessThan(dollars(1_000));
      expect(r.quarterly.noInstallmentsRequired).toBe(true);
      expect(r.quarterly.payments.map((p) => p.amount)).toEqual([0, 0, 0, 0]);
    });
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
