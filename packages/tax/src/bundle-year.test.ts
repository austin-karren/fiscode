import { describe, expect, it } from "vitest";
import type { Bundle } from "@fiscode/csv";

import { estimateBundleYear } from "./bundle-year.ts";
import type { AnnualizedInput } from "./types.ts";

// Every test goes through estimateBundleYear: `derived` for the year's figures,
// `input` for what the engine is given.
const deriveYear = (b: Bundle, year: number) => estimateBundleYear(b, year).derived;
const inputFor = (b: Bundle, year: number) => estimateBundleYear(b, year).input;
const periodsFor = (b: Bundle, year: number): AnnualizedInput => {
  const input = estimateBundleYear(
    { ...b, profile: { ...b.profile!, quarterlyMethod: "annualized" } },
    year,
  ).input;
  if (!("periods" in input)) throw new Error("expected the annualized input");
  return input;
};

const FIXED = "2026-06-04T12:00:00.000Z";

const makeBundle = (overrides: Partial<Bundle> = {}): Bundle => ({
  profile: {
    id: "profile",
    filingStatus: "mfj",
    state: "UT",
    seStartDate: "2026-01-01",
    dependents: 0,
    tracksRoth: false,
    usesRetirement: false,
    quarterlyMethod: "annualized",
    prepLeadDays: 14,
    priorYearTotalTaxCents: null,
    priorYearAgiCents: null,
    priorYearStateTaxCents: null,
    createdAt: FIXED,
    updatedAt: FIXED,
  },
  entities: [
    {
      id: "ent_1",
      type: "sole_prop",
      startDate: "2026-01-01",
      endDate: null,
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  spouses: [],
  clients: [],
  income: [],
  timeEntries: [],
  vehicles: [],
  mileage: [],
  homeOffice: [],
  history: [],
  expenses: [],
  retirementContributions: [],
  ...overrides,
});

const income = (id: string, date: string, amount: number, sourceType: "1099" | "w2" = "1099") => ({
  id,
  date,
  clientId: null,
  amountCents: amount,
  sourceType,
  kind: "recurring",
  description: null,
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});

const expense = (id: string, date: string, amount: number) => ({
  id,
  date,
  amountCents: amount,
  category: "supplies",
  clientId: null,
  description: null,
  reason: null,
  notes: null,
  flagForSection179: false,
  startupExpense: false,
  placedInServiceDate: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});

const mileage = (id: string, date: string, miles: number) => ({
  id,
  date,
  vehicleId: null,
  businessMiles: miles,
  purpose: null,
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});

const homeOffice = (
  id: string,
  startDate: string,
  endDate: string | null,
  sqft: number,
  method: "simplified" | "actual" = "simplified",
) => ({
  id,
  startDate,
  endDate,
  method,
  officeSqft: sqft,
  homeSqft: 2000,
  monthlyRentMortgageCents: null as number | null,
  monthlyUtilitiesCents: null as number | null,
  monthlyInsuranceCents: null as number | null,
  regularExclusiveAck: true,
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});

const spouse = (id: string, startDate: string, endDate: string | null, wagesCents: number) => ({
  id,
  startDate,
  endDate,
  annualW2WagesCents: wagesCents,
  annualFederalWithholdingCents: 0,
  annualStateWithholdingCents: 0,
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});

const entity = (
  id: string,
  startDate: string,
  endDate: string | null,
  type: "sole_prop" | "single_member_llc" | "s_corp",
) => ({
  id,
  type,
  startDate,
  endDate,
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});

describe("deriveYear — 1099 income summing", () => {
  it("sums only 1099 income within the calendar year", () => {
    const b = makeBundle({
      income: [
        income("a", "2026-01-15", 5_000_00),
        income("b", "2026-12-31", 10_000_00),
        income("c", "2025-12-31", 9_999_99), // prior year, excluded
        income("d", "2027-01-01", 9_999_99), // next year, excluded
        income("e", "2026-06-01", 1_000_00, "w2"), // w2, excluded
      ],
    });
    const d = deriveYear(b, 2026);
    expect(d.gross1099).toBe(15_000_00);
  });

  it("excludes soft-deleted rows", () => {
    const b = makeBundle({
      income: [
        income("a", "2026-01-15", 5_000_00),
        { ...income("b", "2026-06-15", 10_000_00), deletedAt: FIXED },
      ],
    });
    expect(deriveYear(b, 2026).gross1099).toBe(5_000_00);
  });

  it("respects seStartDate as a lower bound", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2026-04-01" },
      income: [
        income("pre", "2026-03-31", 1_000_00), // excluded (pre-SE)
        income("first", "2026-04-01", 2_000_00), // included (boundary)
        income("after", "2026-05-15", 3_000_00),
      ],
    });
    const d = deriveYear(b, 2026);
    expect(d.gross1099).toBe(5_000_00);
    expect(d.excludedBeforeSeStart.income).toBe(1);
  });
});

describe("deriveYear — mileage deduction", () => {
  it("multiplies miles by the 2026 rate in force on each trip's date", () => {
    const b = makeBundle({
      mileage: [mileage("m1", "2026-02-10", 100), mileage("m2", "2026-08-22", 50)],
    });
    // 100 mi × $0.725 = $72.50 (Feb) + 50 mi × $0.76 = $38.00 (Aug) = $110.50.
    // Before the July 1 rate change was modelled this read $108.75.
    expect(deriveYear(b, 2026).mileageDeduction).toBe(110_50);
  });

  it("uses 2025 rate ($0.70/mi) for 2025 derivation", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2025-01-01" },
      entities: [entity("e1", "2025-01-01", null, "sole_prop")],
      mileage: [mileage("m1", "2025-03-01", 200)],
    });
    // 200 × $0.70 = $140 = 14000 cents
    expect(deriveYear(b, 2025).mileageDeduction).toBe(14_000);
  });

  it("2026: deducts each trip at the rate in force on its date", () => {
    const b = makeBundle({
      mileage: [mileage("jun", "2026-06-30", 100), mileage("jul", "2026-07-01", 100)],
    });
    // 100 mi × $0.725 (to June 30) = $72.50; 100 mi × $0.76 (from July 1) = $76.00
    expect(deriveYear(b, 2026).mileageDeduction).toBe(148_50);
  });

  it("excludes pre-SE-start mileage rows", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2026-06-01" },
      mileage: [mileage("pre", "2026-05-31", 100), mileage("ok", "2026-06-01", 100)],
    });
    const d = deriveYear(b, 2026);
    // 100 mi × $0.725 = $72.50 = 7250¢. The pre-SE row is excluded.
    expect(d.mileageDeduction).toBe(7_250);
    expect(d.excludedBeforeSeStart.mileage).toBe(1);
  });

  it("counts as excluded exactly the live in-year expenses that Direct expenses leaves out", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2026-04-01" },
      expenses: [
        expense("pre", "2026-03-31", 33_00), // before SE start: excluded
        { ...expense("startup", "2026-02-01", 45_00), startupExpense: true }, // counted
        expense("ok", "2026-04-01", 250_00), // counted
        { ...expense("gone", "2026-03-01", 10_00), deletedAt: FIXED }, // deleted: neither
        // Paid in 2025 before a 2026 start: counts in 2026, the year the business begins
        // (§195(b)); not "excluded", since it isn't dated in 2026.
        { ...expense("old", "2025-12-31", 7_00), startupExpense: true },
      ],
    });
    const d = deriveYear(b, 2026);
    expect(d.directExpenses).toBe(302_00);
    expect(d.excludedBeforeSeStart.expense).toBe(1);
  });
});

describe("bug A: a startup cost counts in the year the business begins (IRC §195(b))", () => {
  // Paid 2025-12-15, SE start 2026-02-01: §195(b)(1)(A) allows it "for the taxable year in which the
  // active trade or business begins", so 2025: 0, 2026: 1, counted on the start date.
  const startup = { ...expense("s", "2025-12-15", 900_00), startupExpense: true };
  const profile = { ...makeBundle().profile!, seStartDate: "2026-02-01" };

  it("year totals: 2025 none, 2026 the full amount", () => {
    const b = makeBundle({ profile, expenses: [startup] });
    expect(deriveYear(b, 2025).directExpenses).toBe(0);
    expect(deriveYear(b, 2026).directExpenses).toBe(900_00);
    // Not "excluded" in 2025: it is deducted under §195 in 2026.
    expect(deriveYear(b, 2025).excludedBeforeSeStart.expense).toBe(0);
    expect(deriveYear(b, 2026).excludedBeforeSeStart.expense).toBe(0);
  });

  it("annualized: lands in the period that holds the SE start", () => {
    const b = makeBundle({
      profile: { ...profile, seStartDate: "2026-07-01" },
      income: [income("i1", "2026-07-15", 10_000_00)],
      expenses: [startup],
    });
    const ann = periodsFor(b, 2026);
    // Start Jul 1: Q1 (Mar 31) and Q2 (May 31) carry none; Q3 (Aug 31) and Q4 carry $900.
    expect(ann.periods[0].cumulativeDeductibleExpenses).toBe(0);
    expect(ann.periods[1].cumulativeDeductibleExpenses).toBe(0);
    expect(ann.periods[2].cumulativeDeductibleExpenses).toBe(900_00);
    expect(ann.periods[3].cumulativeDeductibleExpenses).toBe(900_00);
  });

  it("the home office's profit window sees it on the SE start date", () => {
    // Office from Feb 1 (the start), $1,000 income, $900 startup cost: profit $100, so the
    // simplified $750 × 11/12 months = $687.50 is limited to $100.
    const b = makeBundle({
      profile,
      income: [income("i1", "2026-03-15", 1_000_00)],
      expenses: [startup],
      homeOffice: [homeOffice("ho", "2026-02-01", null, 150)],
    });
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(100_00);
  });

  it("year-end: its own §195 line in 2026 (deducted and total), not a category", () => {
    const b = makeBundle({ profile, expenses: [startup] });
    expect(deriveYear(b, 2026).startupCosts).toEqual({ deductedThisYear: 900_00, total: 900_00 });
    expect(deriveYear(b, 2025).startupCosts).toEqual({ deductedThisYear: 0, total: 900_00 });
  });

  it("§195(b) limit: $12,000 paid before a Mar 2 start deducts $5,388.89, then $466.67", () => {
    const big = { ...expense("s", "2025-12-15", 12_000_00), startupExpense: true };
    const b = makeBundle({
      profile: { ...profile, seStartDate: "2026-03-02" },
      income: [income("i1", "2026-05-15", 50_000_00)],
      expenses: [big],
    });
    expect(deriveYear(b, 2026).directExpenses).toBe(5_388_89);
    expect(deriveYear(b, 2027).directExpenses).toBe(466_67);
  });
});

describe("equipment: placed-in-service date (Pub 946) and the §179 notice", () => {
  const equipment = (id: string, date: string, amount: number, extra = {}) => ({
    ...expense(id, date, amount),
    category: "equipment",
    ...extra,
  });
  const profile = { ...makeBundle().profile!, seStartDate: "2026-02-01" };

  it("bought before the start, placed in service on it: counted in 2026, at the start", () => {
    const b = makeBundle({
      profile,
      income: [income("i1", "2026-07-01", 10_000_00)],
      expenses: [equipment("e1", "2025-11-20", 1_200_00, { placedInServiceDate: "2026-02-01" })],
    });
    expect(deriveYear(b, 2025).directExpenses).toBe(0);
    expect(deriveYear(b, 2026).directExpenses).toBe(1_200_00);
    // Annualized: in Q1 (through Mar 31), on the placed-in-service date.
    const annualized = {
      ...b,
      profile: { ...b.profile!, quarterlyMethod: "annualized" as const },
    };
    const input = estimateBundleYear(annualized, 2026).input as AnnualizedInput;
    expect(input.periods[0].cumulativeDeductibleExpenses).toBe(1_200_00);
  });

  it("pre-start equipment is counted, so the dashboard does not call it excluded", () => {
    const b = makeBundle({ profile, expenses: [equipment("e1", "2026-01-20", 899_99)] });
    expect(deriveYear(b, 2026).directExpenses).toBe(899_99);
    expect(deriveYear(b, 2026).excludedBeforeSeStart.expense).toBe(0);
  });

  it("no placed-in-service date, bought before the start: counts on the SE start, as the form shows", () => {
    // Review #66 r1 ruling 3: the same rule as the prefill, applied in counting (no data write),
    // so a v2 import counts the same as after an untouched Save.
    const b = makeBundle({ profile, expenses: [equipment("e1", "2025-11-20", 1_200_00)] });
    expect(deriveYear(b, 2025).directExpenses).toBe(0);
    expect(deriveYear(b, 2026).directExpenses).toBe(1_200_00);
  });

  it("$8,000 of pre-start equipment ticked Startup: placed in service, $8,000 counts, §179 notice", () => {
    // Equipment is never a §195 start-up cost (review #66 r1 ruling 1): no $5,000 limit.
    const b = makeBundle({
      profile,
      income: [income("i1", "2026-07-01", 20_000_00)],
      expenses: [equipment("e1", "2025-12-15", 8_000_00, { startupExpense: true })],
    });
    const d = deriveYear(b, 2026);
    expect(d.directExpenses).toBe(8_000_00);
    expect(d.startupCosts.total).toBe(0);
    expect(d.equipmentAssumedSection179).toBe(1);
  });

  it("notice: counted equipment over $2,500 without the §179 flag; no number change", () => {
    const b = makeBundle({
      profile,
      income: [income("i1", "2026-07-01", 10_000_00)],
      expenses: [
        equipment("big", "2026-03-01", 3_000_00), // counted, over $2,500, not flagged: notice
        equipment("flagged", "2026-03-01", 3_000_00, { flagForSection179: true }),
        equipment("small", "2026-03-01", 2_500_00), // at the de minimis limit: no notice
        expense("supplies", "2026-03-01", 4_000_00), // not equipment
      ],
    });
    const d = deriveYear(b, 2026);
    expect(d.equipmentAssumedSection179).toBe(1);
    expect(d.directExpenses).toBe(3_000_00 + 3_000_00 + 2_500_00 + 4_000_00);
  });
});

describe("deriveYear — simplified part-year use (Pub 587 average monthly square footage)", () => {
  // Pub 587 (2025), "Part-year use or area changes (for simplified method only)",
  // https://www.irs.gov/pub/irs-pdf/p587.pdf: add the allowable square feet used in each month
  // (at most 300 a month; 0 for a month with less than 15 days of use) and divide by 12.
  const withIncome = (offices: ReturnType<typeof homeOffice>[]) =>
    deriveYear(
      // $5,000 on the 28th of every month, so no office's own days lack income (no limit binds).
      makeBundle({
        income: Array.from({ length: 12 }, (_, m) =>
          income(`i${m}`, `2026-${String(m + 1).padStart(2, "0")}-28`, 5_000_00),
        ),
        homeOffice: offices,
      }),
      2026,
    ).homeOfficeDeduction;

  it("Pub 587 Example 1 (Jay): 420 sq ft from Jul 20 → 125 sq ft average → $625", () => {
    // July has 12 days of use (< 15): 0. Aug–Dec: 300 each. (5 × 300) / 12 = 125. 125 × $5 = $625.
    // (Day count gave 300 × $5 × 165/365 = $678.08.)
    expect(withIncome([homeOffice("ho", "2026-07-20", null, 420)])).toBe(625_00);
  });

  it("Pub 587 Example 2 (Jessie): 100 sq ft from Apr 20, 330 sq ft from Aug 5 → 150 → $750", () => {
    // April: 11 days (0). May–Jul: 100. August: 4 days of 100 (0), 27 days of 330 → 300.
    // (3 × 100 + 5 × 300) / 12 = 150. 150 × $5 = $750.
    expect(
      withIncome([
        homeOffice("h1", "2026-04-20", "2026-08-04", 100),
        { ...homeOffice("h2", "2026-08-05", null, 330) },
      ]),
    ).toBe(750_00);
  });

  it("Pub 587 Example 3 (Guadalupe), the simplified home: 300 sq ft Jan 1 – Jul 16 → 175 → $875", () => {
    // July has 16 days (≥ 15): 300. Jan–Jul: 7 × 300 / 12 = 175. 175 × $5 = $875.
    expect(withIncome([homeOffice("ho", "2026-01-01", "2026-07-16", 300)])).toBe(875_00);
  });

  it("a month counts with exactly 15 days, not with 14", () => {
    // Office from Jun 16 (15 days in June) vs Jun 17 (14 days), 120 sq ft.
    // Jun 16: Jun–Dec = 7 months × 120 / 12 = 70 → $350. Jun 17: Jul–Dec = 6 × 120 / 12 = 60 → $300.
    expect(withIncome([homeOffice("ho", "2026-06-16", null, 120)])).toBe(350_00);
    expect(withIncome([homeOffice("ho", "2026-06-17", null, 120)])).toBe(300_00);
  });

  it("an area change splitting February 14/14 still counts February (review #58 r1)", () => {
    // 100 sq ft Jan 1 – Feb 14, then 200 sq ft from Feb 15 (2026: February has 28 days).
    // February: 14 + 14 = 28 days of use ≥ 15, so it counts, at the later config's 200 (a tie).
    // Jan 100 + Feb 200 + Mar–Dec 10 × 200 = 2,300 sq-ft-months.
    //   first config: 100 × $5 / 12 = $41.67 (4,166.67 → 4,167¢)
    //   second:     2,200 × $5 / 12 = $916.67 (91,666.67 → 91,667¢) → $958.34
    expect(
      withIncome([
        homeOffice("h1", "2026-01-01", "2026-02-14", 100),
        homeOffice("h2", "2026-02-15", null, 200),
      ]),
    ).toBe(4_167 + 91_667);
  });

  it("business use that stops Feb 14 (no later config) leaves February at 0", () => {
    // 100 sq ft Jan 1 – Feb 14 only: February has 14 days of use (< 15). Jan only: 100 × $5 / 12.
    expect(withIncome([homeOffice("h1", "2026-01-01", "2026-02-14", 100)])).toBe(4_167);
  });

  it("a 15/16 split in July credits July once, to the config with more days", () => {
    // 200 sq ft Jan 1 – Jul 15 (15 July days), 200 sq ft from Jul 16 (16 July days): July → second.
    // First: Jan–Jun 6 × 200 = 1,200 → $500.00. Second: Jul–Dec 6 × 200 = 1,200 → $500.00.
    expect(
      withIncome([
        homeOffice("h1", "2026-01-01", "2026-07-15", 200),
        homeOffice("h2", "2026-07-16", null, 200),
      ]),
    ).toBe(1_000_00);
  });

  it("a full year is unchanged: 150 sq ft → $750", () => {
    expect(withIncome([homeOffice("ho", "2026-01-01", null, 150)])).toBe(750_00);
  });
});

describe("deriveYear — home-office simplified", () => {
  it("annual: 150 sqft × $5/sqft for a full year = $750", () => {
    const b = makeBundle({
      income: [income("i0", "2026-01-02", 10_000_00)],
      homeOffice: [homeOffice("ho", "2026-01-01", null, 150)],
    });
    const d = deriveYear(b, 2026);
    // 150 × $5 = $750 = 75000 cents
    expect(d.homeOfficeDeduction).toBe(75_000);
  });

  it("clamps sqft at the simplified-method cap of 300", () => {
    const b = makeBundle({
      income: [income("i0", "2026-01-02", 10_000_00)],
      homeOffice: [homeOffice("ho", "2026-01-01", null, 500)],
    });
    // 300 × $5 = $1500 (also equals the simplified cap)
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(150_000);
  });

  it("prorates day-by-day across a partial year", () => {
    // April 1 → Sep 30 inclusive = 183 days (30+31+30+31+31+30) in 2026 (non-leap).
    const b = makeBundle({
      // Income within the office's days (r3: the limit counts only those).
      income: [income("i0", "2026-05-02", 10_000_00)],
      homeOffice: [homeOffice("ho", "2026-04-01", "2026-09-30", 100)],
    });
    // Pub 587 months: Apr–Sep, 6 full months × 100 sq ft = 600; / 12 = 50 sq ft × $5 = $250.00.
    // (Day count gave $250.68.)
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(250_00);
  });

  it("clamps to seStartDate for mid-year SE start", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2026-07-01" },
      income: [income("i0", "2026-07-02", 10_000_00)],
      homeOffice: [homeOffice("ho", "2026-01-01", null, 100)],
    });
    // Pub 587 months from the SE start: Jul–Dec, 6 × 100 / 12 = 50 sq ft × $5 = $250.00.
    // (Day count gave $252.05.)
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(250_00);
  });

  it("actual method with no monthly costs stored deducts $0", () => {
    const b = makeBundle({
      income: [income("i1", "2026-03-15", 50_000_00)],
      homeOffice: [homeOffice("ho", "2026-01-01", null, 200, "actual")],
    });
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(0);
  });

  it("returns 0 for a home office entirely before the SE start date", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2026-07-01" },
      homeOffice: [homeOffice("ho", "2026-01-01", "2026-06-30", 100)],
    });
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(0);
  });

  it("handles leap year (2024) — 366 days", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2024-01-01" },
      entities: [entity("e1", "2024-01-01", null, "sole_prop")],
      income: [income("i0", "2024-01-02", 10_000_00)],
      homeOffice: [homeOffice("ho", "2024-01-01", null, 100)],
    });
    // Full year, leap. Active days = 366; months = (366/366)×12 = 12.
    // Annual = 100 × $5 = $500 = 50000¢.
    expect(deriveYear(b, 2024).homeOfficeDeduction).toBe(50_000);
  });

  it("returns 0 when home-office row starts after the year ends", () => {
    const b = makeBundle({
      homeOffice: [homeOffice("ho", "2027-01-01", null, 100)],
    });
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(0);
  });
});

// Demo renter: 200 of 2,000 sq ft, $1,500 rent + $200 utilities + $30 insurance a month.
const actualOffice = (
  startDate: string,
  officeSqft = 200,
  homeSqft = 2000,
): ReturnType<typeof homeOffice> => ({
  ...homeOffice("ho", startDate, null, officeSqft, "actual"),
  homeSqft,
  monthlyRentMortgageCents: 150_000,
  monthlyUtilitiesCents: 20_000,
  monthlyInsuranceCents: 3_000,
});

describe("deriveYear — home-office actual (Form 8829)", () => {
  it("renter, full year: $1,730 × 12 × 10% = $2,076.00", () => {
    const b = makeBundle({
      income: [income("i1", "2026-03-15", 50_000_00)],
      homeOffice: [actualOffice("2026-01-01")],
    });
    const d = deriveYear(b, 2026);
    expect(d.homeOfficeDeduction).toBe(207_600);
    expect(d.homeOfficeCarryover).toBe(0);
    expect(d.homeOfficeLost).toBe(0);
    expect(d.homeOfficeAreaRejected).toBe(0);
  });

  it("partial year, office from Jul 1: 184/365 of $2,076 = $1,046.53", () => {
    const b = makeBundle({
      income: [income("i1", "2026-08-15", 50_000_00)],
      homeOffice: [actualOffice("2026-07-01")],
    });
    // 207,600 × 184 / 365 = 104,653.15 → 104,653¢
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(104_653);
  });

  it("one part-year home is limited by the profit dated within its own days (r3, Pub 587)", () => {
    // Office from Jul 1; all income on Mar 15, before it: $0 allowed, $1,046.53 carried.
    const b = makeBundle({
      income: [income("i1", "2026-03-15", 50_000_00)],
      homeOffice: [actualOffice("2026-07-01")],
    });
    const d = deriveYear(b, 2026);
    expect(d.homeOfficeDeduction).toBe(0);
    expect(d.homeOfficeCarryover).toBe(104_653);
  });

  it("a shared changeover day belongs to the later home, and the total never exceeds the profit", () => {
    // Simplified entered Jan 1 – Jul 1, actual from Jul 1 ($1,046.53). Jul 1 is the new home's,
    // for profit and amount: the old home owns 181 days ($750 × 181/365 = $371.92).
    // $1,000 earned Jul 1: the old home's profit is $0.
    const b = makeBundle({
      income: [income("i1", "2026-07-01", 1_000_00)],
      homeOffice: [
        homeOffice("h1", "2026-01-01", "2026-07-01", 150),
        { ...actualOffice("2026-07-01"), id: "h2" },
      ],
    });
    const d = deriveYear(b, 2026);
    expect(d.homeOfficeDeduction).toBeLessThanOrEqual(1_000_00);
    // old home: Jan–Jun 6 × 150 / 12 = 75 sq ft × $5 = $375.00 lost; new home: $1,000 allowed, $46.53 carried
    expect(d.homeOfficeDeduction).toBe(1_000_00);
    expect(d.homeOfficeLost).toBe(375_00);
    expect(d.homeOfficeCarryover).toBe(4_653);
  });

  it("the same move typed two ways gives the same figures (r4: amount over owned days)", () => {
    // "ends Jun 30 / starts Jul 1" and "ends Jul 1 / starts Jul 1": the old home owns Jan 1 – Jun 30
    // either way (Jan–Jun by Pub 587 months, $375.00); $3,000 earned Feb 10 → old home in full,
    // new home carried.
    const entered = (oldEnd: string) =>
      deriveYear(
        makeBundle({
          income: [income("i1", "2026-02-10", 3_000_00)],
          homeOffice: [
            homeOffice("h1", "2026-01-01", oldEnd, 150),
            { ...actualOffice("2026-07-01"), id: "h2" },
          ],
        }),
        2026,
      );
    const a = entered("2026-06-30");
    const b = entered("2026-07-01");
    expect(a.homeOfficeDeduction).toBe(375_00);
    expect(a.homeOfficeCarryover).toBe(104_653);
    expect(b.homeOfficeDeduction).toBe(a.homeOfficeDeduction);
    expect(b.homeOfficeLost).toBe(a.homeOfficeLost);
    expect(b.homeOfficeCarryover).toBe(a.homeOfficeCarryover);
  });

  it("the total is capped at the whole profit when expenses fall outside every office's days", () => {
    // Office Jul 1 on; $5,000 income Aug; $4,500 expense in Feb (no office then).
    // The office's own days show $5,000 of profit, but the business made $500: $500 allowed.
    const b = makeBundle({
      income: [income("i1", "2026-08-10", 5_000_00)],
      expenses: [expense("e1", "2026-02-10", 4_500_00)],
      homeOffice: [actualOffice("2026-07-01")],
    });
    const d = deriveYear(b, 2026);
    expect(d.homeOfficeDeduction).toBe(500_00);
    expect(d.homeOfficeCarryover).toBe(104_653 - 500_00);
  });

  it("a config that deducts nothing owns no days (r3 case 6)", () => {
    // Actual from Jul 1, plus a config from Sep 1 rejected (5,000 sq ft office in a 100 sq ft home).
    // Income Oct 10 stays with the real office: $1,046.53 allowed in full.
    const b = makeBundle({
      income: [income("i1", "2026-10-10", 3_000_00)],
      homeOffice: [
        actualOffice("2026-07-01"),
        { ...actualOffice("2026-09-01", 5000, 100), id: "h2" },
      ],
    });
    const d = deriveYear(b, 2026);
    expect(d.homeOfficeDeduction).toBe(104_653);
    expect(d.homeOfficeAreaRejected).toBe(1);
  });

  it("SE start mid-year clamps the office period the same way", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2026-07-01" },
      income: [income("i1", "2026-08-15", 50_000_00)],
      homeOffice: [actualOffice("2026-01-01")],
    });
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(104_653);
  });

  it("office larger than the home is rejected: $0 and counted", () => {
    const b = makeBundle({
      income: [income("i1", "2026-03-15", 50_000_00)],
      homeOffice: [actualOffice("2026-01-01", 5000, 100)],
    });
    const d = deriveYear(b, 2026);
    expect(d.homeOfficeDeduction).toBe(0);
    expect(d.homeOfficeAreaRejected).toBe(1);
  });

  it("limited by tentative profit (line 8): $1,000 income − $300 expenses = $700", () => {
    const b = makeBundle({
      income: [income("i1", "2026-03-15", 1_000_00)],
      expenses: [expense("e1", "2026-04-01", 300_00)],
      homeOffice: [actualOffice("2026-01-01")],
    });
    const d = deriveYear(b, 2026);
    expect(d.homeOfficeDeduction).toBe(700_00);
    // $2,076 − $700 = $1,376 carried to next year (line 43; reported, not tracked)
    expect(d.homeOfficeCarryover).toBe(1_376_00);
    expect(d.homeOfficeLost).toBe(0);
  });

  it("the simplified method is unchanged under the limit", () => {
    const b = makeBundle({
      income: [income("i0", "2026-01-02", 10_000_00)],
      homeOffice: [homeOffice("ho", "2026-01-01", null, 150)],
    });
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(75_000);
  });

  it("the simplified method is limited too: $0 income deducts $0 (Pub 587)", () => {
    // Review of #49's walk: $123.29 of home office was deducted with no counted income.
    const b = makeBundle({
      homeOffice: [homeOffice("ho", "2026-01-01", null, 150)],
    });
    const d = deriveYear(b, 2026);
    expect(d.homeOfficeDeduction).toBe(0);
    // Simplified: the excess cannot be carried over, so it is lost
    expect(d.homeOfficeLost).toBe(75_000);
    expect(d.homeOfficeCarryover).toBe(0);
  });

  it("the simplified method is capped at tentative profit: $500 income − $300 expenses", () => {
    const b = makeBundle({
      income: [income("i0", "2026-01-02", 500_00)],
      expenses: [expense("e1", "2026-01-03", 300_00)],
      homeOffice: [homeOffice("ho", "2026-01-01", null, 150)],
    });
    const d = deriveYear(b, 2026);
    // $750 simplified, limited to $200; $550 lost
    expect(d.homeOfficeDeduction).toBe(200_00);
    expect(d.homeOfficeLost).toBe(550_00);
  });

  // A move: simplified 150 sq ft Jan 1 – Jun 30, then actual from Jul 1 (184 days).
  //   simplified (Pub 587 months): 6 × 150 / 12 = 75 sq ft × $5 = $375.00
  //   actual:     $2,076 × 184/365 = $1,046.53 (104,653¢)
  // Two homes: each is limited by the profit of its own period (i8829 Line 8, Pub 587).
  const move = [
    homeOffice("h1", "2026-01-01", "2026-06-30", 150),
    { ...actualOffice("2026-07-01"), id: "h2" },
  ];

  it("a move, income earned in the new home (Nov 10): old home $0 limit, new home in full", () => {
    const b = makeBundle({ income: [income("i1", "2026-11-10", 3_000_00)], homeOffice: move });
    const d = deriveYear(b, 2026);
    // old home: profit $0 → $375.00 lost (simplified); new home: profit $3,000 ≥ $1,046.53
    expect(d.homeOfficeDeduction).toBe(104_653);
    expect(d.homeOfficeLost).toBe(375_00);
    expect(d.homeOfficeCarryover).toBe(0);
  });

  it("a move, income earned in the old home (Feb 10): old home in full, new home carried", () => {
    const b = makeBundle({ income: [income("i1", "2026-02-10", 3_000_00)], homeOffice: move });
    const d = deriveYear(b, 2026);
    // old home: profit $3,000 ≥ $375.00; new home: profit $0 → $1,046.53 carried (actual)
    expect(d.homeOfficeDeduction).toBe(375_00);
    expect(d.homeOfficeLost).toBe(0);
    expect(d.homeOfficeCarryover).toBe(104_653);
  });

  it("a move: each home's profit counts its own expenses and mileage", () => {
    // Old home: $500 income − $300 expense (Mar) = $200 → $200 allowed, $175.00 lost.
    // New home: $5,000 income (Sep) − 100 mi × $0.76 (Aug) = $4,924 ≥ $1,046.53.
    const b = makeBundle({
      income: [income("i1", "2026-02-10", 500_00), income("i2", "2026-09-10", 5_000_00)],
      expenses: [expense("e1", "2026-03-01", 300_00)],
      mileage: [mileage("m1", "2026-08-01", 100)],
      homeOffice: move,
    });
    const d = deriveYear(b, 2026);
    expect(d.homeOfficeDeduction).toBe(200_00 + 104_653);
    expect(d.homeOfficeLost).toBe(175_00);
    expect(d.homeOfficeCarryover).toBe(0);
  });
});

describe("self-employed health insurance leaves Schedule C (Form 7206, Schedule 1 line 17)", () => {
  const premium = (id: string, date: string, amount: number) => ({
    ...expense(id, date, amount),
    category: "health_insurance",
  });

  it("premiums are not direct expenses; they go to their own field", () => {
    const b = makeBundle({
      income: [income("i1", "2026-03-15", 50_000_00)],
      expenses: [expense("e1", "2026-04-01", 1_000_00), premium("h1", "2026-02-01", 500_00)],
    });
    const d = deriveYear(b, 2026);
    expect(d.directExpenses).toBe(1_000_00);
    expect(d.selfEmployedHealthInsurance).toBe(500_00);
    expect(d.totalDeductibleExpenses).toBe(1_000_00);
    const input = inputFor(b, 2026);
    expect(input.deductibleExpenses).toBe(1_000_00);
    expect(input.selfEmployedHealthInsurance).toBe(500_00);
  });

  it("each annualized period carries the premiums paid through its end", () => {
    const b = makeBundle({
      income: [income("i1", "2026-01-15", 50_000_00)],
      expenses: [premium("h1", "2026-02-01", 500_00), premium("h2", "2026-07-01", 500_00)],
    });
    const ann = periodsFor(b, 2026);
    expect(ann.periods[0].cumulativeSelfEmployedHealthInsurance).toBe(500_00);
    expect(ann.periods[3].cumulativeSelfEmployedHealthInsurance).toBe(1_000_00);
    expect(ann.periods[3].cumulativeDeductibleExpenses).toBe(0);
  });

  it("premiums do not lower the home office's income limit", () => {
    // $1,000 income, $900 premiums, simplified 150 sq ft ($750): the limit is $1,000, not $100.
    const b = makeBundle({
      income: [income("i1", "2026-01-15", 1_000_00)],
      expenses: [premium("h1", "2026-02-01", 900_00)],
      homeOffice: [homeOffice("ho", "2026-01-01", null, 150)],
    });
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(750_00);
  });
});

describe("deriveYear — expense aggregation + total", () => {
  it("sums expenses within year and rolls up the total", () => {
    const b = makeBundle({
      income: [income("i1", "2026-03-15", 50_000_00)],
      expenses: [expense("e1", "2026-04-01", 1_000_00), expense("e2", "2026-09-01", 500_00)],
      mileage: [mileage("m1", "2026-06-01", 100)], // 100 × $0.725 = $72.50 = 7_250¢
      homeOffice: [homeOffice("ho", "2026-01-01", null, 100)], // $500 = 50_000¢
    });
    const d = deriveYear(b, 2026);
    expect(d.directExpenses).toBe(1_500_00);
    expect(d.mileageDeduction).toBe(7_250);
    expect(d.homeOfficeDeduction).toBe(50_000);
    expect(d.totalDeductibleExpenses).toBe(1_500_00 + 7_250 + 50_000);
  });
});

describe("deriveYear — entityType + latestOverlap", () => {
  it("picks the most-recently-started entity that overlaps the year", () => {
    const b = makeBundle({
      entities: [
        entity("old", "2024-01-01", "2026-06-30", "sole_prop"),
        entity("new", "2026-07-01", null, "single_member_llc"),
      ],
    });
    expect(deriveYear(b, 2026).entityType).toBe("single_member_llc");
  });

  it("flags an S corp as unsupported and still estimates it as a sole proprietorship", () => {
    const income1099 = [income("i1", "2026-03-15", 50_000_00)];
    const soleProp = makeBundle({ income: income1099 });
    const sCorp = makeBundle({
      income: income1099,
      entities: [entity("s", "2026-01-01", null, "s_corp")],
    });
    const s = estimateBundleYear(sCorp, 2026);
    expect(s.derived.entityType).toBe("s_corp");
    expect(s.derived.entityUnsupported).toBe(true);
    expect(estimateBundleYear(soleProp, 2026).derived.entityUnsupported).toBe(false);
    expect(s.result).toEqual(estimateBundleYear(soleProp, 2026).result);
  });

  it("does not flag a single-member LLC: it is taxed as a sole proprietorship", () => {
    const b = makeBundle({ entities: [entity("llc", "2026-01-01", null, "single_member_llc")] });
    expect(estimateBundleYear(b, 2026).derived.entityUnsupported).toBe(false);
  });

  it("falls back to 'sole_prop' if no entity overlaps", () => {
    const b = makeBundle({
      entities: [entity("old", "2020-01-01", "2022-12-31", "sole_prop")],
    });
    expect(deriveYear(b, 2026).entityType).toBe("sole_prop");
  });

  it("ignores soft-deleted entities", () => {
    const b = makeBundle({
      entities: [
        { ...entity("active", "2026-01-01", null, "single_member_llc"), deletedAt: FIXED },
        entity("real", "2026-01-01", null, "sole_prop"),
      ],
    });
    expect(deriveYear(b, 2026).entityType).toBe("sole_prop");
  });
});

describe("estimateBundleYear input — spouse selection + withholding", () => {
  it("picks the latest spouse overlapping the year and forwards withholding amounts", () => {
    const b = makeBundle({
      spouses: [
        spouse("old", "2024-01-01", "2025-12-31", 30_000_00),
        spouse("current", "2026-01-01", null, 40_000_00),
      ],
    });
    b.spouses[1]!.annualFederalWithholdingCents = 4_000_00;
    b.spouses[1]!.annualStateWithholdingCents = 1_800_00;
    const input = inputFor(b, 2026);
    expect(input.spouseW2Wages).toBe(40_000_00);
    expect(input.spouseFederalWithholding).toBe(4_000_00);
    expect(input.spouseStateWithholding).toBe(1_800_00);
  });

  it("zeros all spouse fields when no spouse overlaps", () => {
    const b = makeBundle({
      spouses: [spouse("past", "2020-01-01", "2022-12-31", 30_000_00)],
    });
    const input = inputFor(b, 2026);
    expect(input.spouseW2Wages).toBe(0);
    expect(input.spouseFederalWithholding).toBe(0);
    expect(input.spouseStateWithholding).toBe(0);
  });

  it("throws when profile is missing", () => {
    const b = makeBundle();
    b.profile = undefined;
    expect(() => inputFor(b, 2026)).toThrow(/profile is required/);
  });
});

describe("estimateBundleYear input — dependents", () => {
  it("passes the profile's dependents to the engine (Utah personal exemption)", () => {
    const b = makeBundle({ profile: { ...makeBundle().profile!, dependents: 2 } });
    expect(inputFor(b, 2026).dependents).toBe(2);
  });
});

describe("estimateBundleYear annualized input — cumulative periods", () => {
  it("cumulates income and expenses by quarter-end (3/5/8/12)", () => {
    const b = makeBundle({
      income: [
        income("a", "2026-02-10", 10_000_00), // in Q1
        income("b", "2026-04-15", 20_000_00), // in Q2
        income("c", "2026-07-30", 15_000_00), // in Q3
        income("d", "2026-11-01", 25_000_00), // in Q4
      ],
      expenses: [
        expense("x", "2026-03-01", 1_000_00),
        expense("y", "2026-06-01", 500_00),
        expense("z", "2026-09-01", 750_00),
      ],
    });
    const ann = periodsFor(b, 2026);
    expect(ann.periods[0].cumulativeGross1099).toBe(10_000_00);
    expect(ann.periods[1].cumulativeGross1099).toBe(30_000_00);
    expect(ann.periods[2].cumulativeGross1099).toBe(45_000_00);
    expect(ann.periods[3].cumulativeGross1099).toBe(70_000_00);
    expect(ann.periods[0].cumulativeDeductibleExpenses).toBe(1_000_00);
    expect(ann.periods[3].cumulativeDeductibleExpenses).toBe(2_250_00);
  });

  it("clamps cumulative ranges to seStartDate (excludes pre-SE rows from period totals)", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2026-05-01" },
      income: [income("pre", "2026-03-01", 10_000_00), income("post", "2026-05-15", 20_000_00)],
    });
    const ann = periodsFor(b, 2026);
    // Q1 ends 2026-03-31 → pre-SE row is gated out, post-SE row not yet earned.
    expect(ann.periods[0].cumulativeGross1099).toBe(0);
    // Q2 ends 2026-05-31 → post-SE row counts.
    expect(ann.periods[1].cumulativeGross1099).toBe(20_000_00);
  });

  it("each period's home office is limited by that period's own income", () => {
    const b = makeBundle({
      income: [income("nov", "2026-11-02", 10_000_00)],
      homeOffice: [actualOffice("2026-01-01")],
    });
    const ann = periodsFor(b, 2026);
    // Q1–Q3: no income yet, so no home office
    expect(ann.periods[0].cumulativeDeductibleExpenses).toBe(0);
    expect(ann.periods[2].cumulativeDeductibleExpenses).toBe(0);
    // Q4 equals the year: $2,076.00, under the $10,000 tentative profit
    expect(ann.periods[3].cumulativeDeductibleExpenses).toBe(207_600);
  });

  it("each period carries mileage (dated rates) and home office through its end, like the year", () => {
    const b = makeBundle({
      income: [income("i0", "2026-01-02", 10_000_00)],
      mileage: [mileage("feb", "2026-02-10", 100), mileage("jul", "2026-07-10", 100)],
      homeOffice: [homeOffice("ho", "2026-01-01", null, 150)],
    });
    const ann = periodsFor(b, 2026);
    // Q1 (to Mar 31): mileage 100 × $0.725 = $72.50
    //   home office (Pub 587 months) Jan–Mar 3 × 150 / 12 = 37.5 sq ft × $5 = $187.50
    //   → $260.00 (no direct expenses)
    expect(ann.periods[0].cumulativeDeductibleExpenses).toBe(260_00);
    // Q3 (to Aug 31) includes the July trip at $0.76
    // Q4 (to Dec 31) equals the year: mileage $148.50 + home office $750.00
    expect(ann.periods[3].cumulativeDeductibleExpenses).toBe(898_50);
    expect(ann.periods[3].cumulativeDeductibleExpenses).toBe(
      deriveYear(b, 2026).totalDeductibleExpenses,
    );
  });
});

describe("prior-year safe harbor from the profile (Pub 505; Utah TC-546 line 4)", () => {
  const withPrior = (prior: { tax: number | null; agi: number | null; state: number | null }) =>
    makeBundle({
      profile: {
        ...makeBundle().profile!,
        priorYearTotalTaxCents: prior.tax,
        priorYearAgiCents: prior.agi,
        priorYearStateTaxCents: prior.state,
      },
    });

  it("passes last year's figures to the engine as entered", () => {
    const input = inputFor(withPrior({ tax: 3_000_00, agi: 90_000_00, state: 500_00 }), 2026);
    expect(input).toMatchObject({
      priorYearTotalTax: 3_000_00,
      priorYearAgi: 90_000_00,
      priorYearStateTax: 500_00,
    });
  });

  it("AGI $90,000: 100% of last year's $3,000 tax, so the prior-year target is $3,000", () => {
    const { result } = estimateBundleYear(
      withPrior({ tax: 3_000_00, agi: 90_000_00, state: null }),
      2026,
    );
    expect(result.safeHarbor.firstYear).toBe(false);
    expect(result.safeHarbor.multiplierUsed).toBe(1.0);
    expect(result.safeHarbor.priorYearTarget).toBe(3_000_00);
  });

  it("AGI $150,000.01: 110%, so $3,300", () => {
    const { result } = estimateBundleYear(
      withPrior({ tax: 3_000_00, agi: 150_000_01, state: null }),
      2026,
    );
    expect(result.safeHarbor.multiplierUsed).toBe(1.1);
    expect(result.safeHarbor.priorYearTarget).toBe(3_300_00);
  });

  it("nothing entered: the first-year fallback, as before", () => {
    const { result, input } = estimateBundleYear(
      withPrior({ tax: null, agi: null, state: null }),
      2026,
    );
    expect(result.safeHarbor.firstYear).toBe(true);
    expect(input).toMatchObject({ priorYearTotalTax: undefined, priorYearAgi: undefined });
  });

  it("a $0 prior-year tax is a real value, not 'not entered': the target is $0", () => {
    const b = withPrior({ tax: 0, agi: 40_000_00, state: 0 });
    b.income = [income("i1", "2026-05-15", 60_000_00)];
    const { result } = estimateBundleYear(b, 2026);
    expect(result.estimate.state.stateIncomeTax).toBeGreaterThan(0);
    expect(result.safeHarbor.firstYear).toBe(false);
    expect(result.safeHarbor.priorYearTarget).toBe(0);
    expect(result.safeHarbor.floor).toBe(0);
    expect(result.statePrepayment).toMatchObject({ minimum: 0, basis: "priorYear" });
  });
});
