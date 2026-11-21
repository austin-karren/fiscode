import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import { config2026 } from "./config/2026.ts";
import { estimateYear } from "./engine.ts";
import { estimatesByDueDate, paymentsAfterWithholding } from "./installments.ts";
import { computeSeTax } from "./se-tax.ts";
import type { TaxInput } from "./types.ts";

// DF-07: the taxpayer's own W-2 and estimated payments made. Hand-computed, 2026 figures.
// Contract: d-data drafts/contract-w2-payments.md, rules R1-R8.

const cfg = config2026;

const input = (overrides: Partial<TaxInput> = {}): TaxInput => ({
  year: 2026,
  filingStatus: "single",
  state: "UT",
  gross1099: dollars(100_000),
  deductibleExpenses: dollars(0),
  spouseW2Wages: cents(0),
  spouseFederalWithholding: cents(0),
  spouseStateWithholding: cents(0),
  priorYearTotalTax: undefined,
  priorYearAgi: undefined,
  ...overrides,
});

const w2 = (o: Partial<NonNullable<TaxInput["ownW2"]>> = {}): NonNullable<TaxInput["ownW2"]> => ({
  wages: cents(0),
  federalWithholding: cents(0),
  ssWages: cents(0),
  medicareWages: cents(0),
  stateWithholding: cents(0),
  ...o,
});

describe("R2 Schedule SE line 8: W-2 Social Security wages use up the wage base first", () => {
  // Net profit 100,000 → net SE earnings 92,350 (× 0.9235).
  it("no W-2: SS on all 92,350 → 11,451.40", () => {
    expect(computeSeTax(dollars(100_000), "single", cfg).socialSecurityTax).toBe(dollars(11_451.4));
  });
  it("150,000 of SS wages leave 34,500 of the 184,500 base: SS 34,500 × 12.4% = 4,278.00", () => {
    const r = computeSeTax(dollars(100_000), "single", cfg, { ssWages: dollars(150_000) });
    expect(r.socialSecurityTax).toBe(dollars(4_278));
    expect(r.medicareTax).toBe(dollars(2_678.15)); // Medicare is uncapped: 92,350 × 2.9%
  });
  it("SS wages at or over the base: no SS part of SE tax", () => {
    expect(
      computeSeTax(dollars(100_000), "single", cfg, { ssWages: dollars(200_000) })
        .socialSecurityTax,
    ).toBe(0);
  });
});

describe("R3 Form 8959: Medicare wages lower the Additional Medicare threshold on SE earnings", () => {
  it("single, 150,000 of Medicare wages: threshold 50,000; (92,350 − 50,000) × 0.9% = 381.15", () => {
    const r = computeSeTax(dollars(100_000), "single", cfg, { medicareWages: dollars(150_000) });
    expect(r.additionalMedicareTax).toBe(dollars(381.15));
  });
  it("without wages, 92,350 is under 200,000: none", () => {
    expect(computeSeTax(dollars(100_000), "single", cfg).additionalMedicareTax).toBe(0);
  });
});

describe("R1 own box 1 wages add to AGI on any filing status", () => {
  it("single: 20,000 of wages raise AGI by exactly 20,000", () => {
    const base = estimateYear({ entity: "sole_prop", method: "even", input: input() });
    const withW2 = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({ ownW2: w2({ wages: dollars(20_000) }) }),
    });
    expect(withW2.estimate.agi - base.estimate.agi).toBe(dollars(20_000));
  });
  it("married filing separately keeps own wages (a spouse's are dropped)", () => {
    const r = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({
        filingStatus: "mfs",
        spouseW2Wages: dollars(50_000),
        ownW2: w2({ wages: dollars(20_000) }),
      }),
    });
    const base = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({ filingStatus: "mfs" }),
    });
    expect(r.estimate.agi - base.estimate.agi).toBe(dollars(20_000));
  });
});

describe("R4 own withholding counts with the spouse's, one quarter per due date", () => {
  it("own box 2 3,000 + box 17 400 add to federal and state withholding", () => {
    const r = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({
        ownW2: w2({ federalWithholding: dollars(3_000), stateWithholding: dollars(400) }),
      }),
    });
    expect(r.estimate.federalWithholding).toBe(dollars(3_000));
    expect(r.estimate.stateWithholding).toBe(dollars(400));
    expect(r.payments.federal.withholding).toBe(dollars(3_000));
  });
});

describe("R5 federal estimates count on the date paid, toward the next due date", () => {
  const dues = ["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"] as const;
  it("buckets each payment at the first due date on or after its date; later ones are late", () => {
    const by = estimatesByDueDate(
      [
        { date: "2026-04-15", amount: dollars(100) }, // on Q1's due date
        { date: "2026-04-16", amount: dollars(200) }, // after Q1: Q2
        { date: "2026-12-31", amount: dollars(300) }, // Q4
        { date: "2027-01-16", amount: dollars(400) }, // after the last due date
      ],
      dues,
    );
    expect(by).toEqual([dollars(100), dollars(200), 0, dollars(300)]);
  });
  it("what is left to pay: estimates and withholding both count, extra carries forward", () => {
    // Installments 1,000 each; withholding 400 → 100 a quarter; 500 paid by Q1's due date.
    const toPay = paymentsAfterWithholding(
      [dollars(1_000), dollars(1_000), dollars(1_000), dollars(1_000)],
      dollars(400),
      [dollars(500), 0 as never, 0 as never, 0 as never],
    );
    expect(toPay).toEqual([dollars(400), dollars(900), dollars(900), dollars(900)]);
  });
});

describe("payments output: paid, remaining, per-quarter shortfall, safe harbor met", () => {
  // A required annual payment the test controls: prior-year tax 4,000 at 100% (AGI 50,000) is
  // below 90% of this year's federal tax, so the floor is 4,000 → 1,000 a quarter.
  const withPayments = (federal: { date: string; amount: number }[], wh = 400) =>
    estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({
        priorYearTotalTax: dollars(4_000),
        priorYearAgi: dollars(50_000),
        ownW2: w2({ federalWithholding: dollars(wh) }),
        estimatedPayments: {
          federal: federal.map((p) => ({
            date: p.date,
            amount: cents(p.amount),
            appliedQuarter: undefined,
          })),
          state: [],
        },
      }),
    });

  it("cumulative shortfall: 1,000 on Apr 15 and 500 on Jul 1 against 1,000 a quarter", () => {
    const r = withPayments([
      { date: "2026-04-15", amount: dollars(1_000) },
      { date: "2026-07-01", amount: dollars(500) },
    ]);
    expect(r.safeHarbor.floor).toBe(dollars(4_000));
    const q = r.payments.federal.quarters;
    // Paid by each due date: withholding 100 a quarter (cumulative) + estimates dated by then.
    expect(q.map((x) => x.requiredThrough)).toEqual([1_000, 2_000, 3_000, 4_000].map(dollars));
    expect(q.map((x) => x.paidByDueDate)).toEqual([1_100, 1_200, 1_800, 1_900].map(dollars));
    expect(q.map((x) => x.shortfall)).toEqual([0, 800, 1_200, 2_100].map(dollars));
    expect(r.payments.federal.safeHarborMet).toBe(false);
    expect(r.payments.federal.estimates).toBe(dollars(1_500));
    expect(r.payments.federal.totalPaid).toBe(dollars(1_900));
    expect(r.payments.federal.remaining).toBe(dollars(2_100));
    // Applied quarter defaults from the date: Apr 15 → Q1, Jul 1 → Q3.
    expect(q.map((x) => x.paidAppliedHere)).toEqual([1_000, 0, 500, 0].map(dollars));
  });

  it("paid on time in full: no shortfall, safe harbor met, nothing remaining", () => {
    const r = withPayments(
      [
        { date: "2026-04-10", amount: dollars(1_000) },
        { date: "2026-06-10", amount: dollars(1_000) },
        { date: "2026-09-10", amount: dollars(1_000) },
        { date: "2027-01-10", amount: dollars(1_000) },
      ],
      0,
    );
    expect(r.payments.federal.quarters.map((x) => x.shortfall)).toEqual([0, 0, 0, 0]);
    expect(r.payments.federal.safeHarborMet).toBe(true);
    expect(r.payments.federal.remaining).toBe(0);
    expect(r.quarterly.payments.map((p) => p.amount)).toEqual([0, 0, 0, 0]);
  });

  it("left to pay by each due date subtracts estimates made by then", () => {
    const r = withPayments([{ date: "2026-04-15", amount: dollars(1_000) }], 0);
    expect(r.quarterly.payments.map((p) => p.amount)).toEqual(
      [0, 1_000, 1_000, 1_000].map(dollars),
    );
  });

  it("an applied quarter set by the user groups the payment there; the shortfall still uses the date", () => {
    const r = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({
        priorYearTotalTax: dollars(4_000),
        priorYearAgi: dollars(50_000),
        estimatedPayments: {
          federal: [{ date: "2026-07-01", amount: dollars(1_000), appliedQuarter: 2 }],
          state: [],
        },
      }),
    });
    const q = r.payments.federal.quarters;
    expect(q[1]!.paidAppliedHere).toBe(dollars(1_000));
    expect(q[1]!.paidByDueDate).toBe(0); // dated after Jun 15
    expect(q[2]!.paidByDueDate).toBe(dollars(1_000));
  });
});

describe("R7 Utah: TC-546 line 8 = line 5 − Utah withholding − prepayments made", () => {
  it("UT estimates lower the minimum and show as paid", () => {
    // Single, 60,000 / 5,000: Utah tax 1,730.03 → line 5 = 90% = 1,557.03 (state-prepayment.test.ts).
    const r = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({
        gross1099: dollars(60_000),
        deductibleExpenses: dollars(5_000),
        ownW2: w2({ stateWithholding: dollars(200) }),
        estimatedPayments: {
          federal: [],
          state: [{ date: "2026-09-15", amount: dollars(500), appliedQuarter: undefined }],
        },
      }),
    });
    expect(r.statePrepayment!.minimum).toBe(dollars(857.03)); // 1,557.03 − 200 − 500
    expect(r.payments.state).toMatchObject({
      withholding: dollars(200),
      estimates: dollars(500),
      totalPaid: dollars(700),
      minimumBeforePayments: dollars(1_557.03),
      remaining: dollars(857.03),
      dueDate: "2027-04-15",
    });
  });
  it("not Utah: no state payments block", () => {
    const r = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({ state: "CA" as never }),
    });
    expect(r.payments.state).toBeUndefined();
  });
});

describe("R8 prior year not filed: no prior-year safe harbor (Form 2210 line 8)", () => {
  it("the floor is 90% of this year's tax and says why, even with figures given", () => {
    const r = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({
        priorYearTotalTax: dollars(1_000),
        priorYearAgi: dollars(50_000),
        priorYearNotFiled: true,
      }),
    });
    expect(r.safeHarbor.priorYearBasis).toBe("not_filed");
    expect(r.safeHarbor.priorYearTarget).toBeUndefined();
    expect(r.safeHarbor.floor).toBe(r.safeHarbor.currentYearTarget);
  });
  it("entered and not entered are named too", () => {
    const entered = estimateYear({
      entity: "sole_prop",
      method: "even",
      input: input({ priorYearTotalTax: dollars(1_000), priorYearAgi: dollars(50_000) }),
    });
    expect(entered.safeHarbor.priorYearBasis).toBe("entered");
    const none = estimateYear({ entity: "sole_prop", method: "even", input: input() });
    expect(none.safeHarbor.priorYearBasis).toBe("not_entered");
  });
});
