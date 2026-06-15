import { describe, expect, it } from "vitest";
import type { Bundle } from "@fiscode/csv";
import { buildAnnualizedInput, buildTaxInput, deriveYear } from "./tax-input.ts";

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
  monthlyRentMortgageCents: null,
  monthlyUtilitiesCents: null,
  monthlyInsuranceCents: null,
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
  it("multiplies miles by the year's mileage rate ($0.725/mi for 2026)", () => {
    const b = makeBundle({
      mileage: [mileage("m1", "2026-02-10", 100), mileage("m2", "2026-08-22", 50)],
    });
    // 150 mi × $0.725 = $108.75 = 10875 cents
    expect(deriveYear(b, 2026).mileageDeduction).toBe(10_875);
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
});

describe("deriveYear — home-office simplified", () => {
  it("annual: 150 sqft × $5/sqft for a full year = $750", () => {
    const b = makeBundle({
      homeOffice: [homeOffice("ho", "2026-01-01", null, 150)],
    });
    const d = deriveYear(b, 2026);
    // 150 × $5 = $750 = 75000 cents
    expect(d.homeOfficeDeduction).toBe(75_000);
  });

  it("clamps sqft at the simplified-method cap of 300", () => {
    const b = makeBundle({
      homeOffice: [homeOffice("ho", "2026-01-01", null, 500)],
    });
    // 300 × $5 = $1500 (also equals the simplified cap)
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(150_000);
  });

  it("prorates day-by-day across a partial year", () => {
    // April 1 → Sep 30 inclusive = 183 days (30+31+30+31+31+30) in 2026 (non-leap).
    const b = makeBundle({
      homeOffice: [homeOffice("ho", "2026-04-01", "2026-09-30", 100)],
    });
    // Annual = 100 × $5 = $500.
    // Months active = (183 / 365) × 12 = 6.0164…
    // Prorated = round($500 × 6.0164 / 12) = round(250.68) ≈ $250.68 → 25068
    const expected = Math.round((500 * 100 * 6.016438356164383) / 12);
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(expected);
  });

  it("clamps to seStartDate for mid-year SE start", () => {
    const b = makeBundle({
      profile: { ...makeBundle().profile!, seStartDate: "2026-07-01" },
      homeOffice: [homeOffice("ho", "2026-01-01", null, 100)],
    });
    // Active days = Jul 1 → Dec 31 = 184 days; 184/365 × 12 = 6.0493...
    // Annual = $500. Prorated ≈ $252.05 = 25205¢
    const expected = Math.round((500 * 100 * ((184 / 365) * 12)) / 12);
    expect(deriveYear(b, 2026).homeOfficeDeduction).toBe(expected);
  });

  it("returns 0 for actual method (not yet implemented in calc)", () => {
    const b = makeBundle({
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

describe("deriveYear — activeEntityType + latestOverlap", () => {
  it("picks the most-recently-started entity that overlaps the year", () => {
    const b = makeBundle({
      entities: [
        entity("old", "2024-01-01", "2026-06-30", "sole_prop"),
        entity("new", "2026-07-01", null, "single_member_llc"),
      ],
    });
    expect(deriveYear(b, 2026).activeEntityType).toBe("single_member_llc");
  });

  it("falls back to 'sole_prop' if no entity overlaps", () => {
    const b = makeBundle({
      entities: [entity("old", "2020-01-01", "2022-12-31", "sole_prop")],
    });
    expect(deriveYear(b, 2026).activeEntityType).toBe("sole_prop");
  });

  it("ignores soft-deleted entities", () => {
    const b = makeBundle({
      entities: [
        { ...entity("active", "2026-01-01", null, "single_member_llc"), deletedAt: FIXED },
        entity("real", "2026-01-01", null, "sole_prop"),
      ],
    });
    expect(deriveYear(b, 2026).activeEntityType).toBe("sole_prop");
  });
});

describe("buildTaxInput — spouse selection + withholding", () => {
  it("picks the latest spouse overlapping the year and forwards withholding amounts", () => {
    const b = makeBundle({
      spouses: [
        spouse("old", "2024-01-01", "2025-12-31", 30_000_00),
        spouse("current", "2026-01-01", null, 40_000_00),
      ],
    });
    b.spouses[1]!.annualFederalWithholdingCents = 4_000_00;
    b.spouses[1]!.annualStateWithholdingCents = 1_800_00;
    const input = buildTaxInput(b, 2026);
    expect(input.spouseW2Wages).toBe(40_000_00);
    expect(input.spouseFederalWithholding).toBe(4_000_00);
    expect(input.spouseStateWithholding).toBe(1_800_00);
  });

  it("zeros all spouse fields when no spouse overlaps", () => {
    const b = makeBundle({
      spouses: [spouse("past", "2020-01-01", "2022-12-31", 30_000_00)],
    });
    const input = buildTaxInput(b, 2026);
    expect(input.spouseW2Wages).toBe(0);
    expect(input.spouseFederalWithholding).toBe(0);
    expect(input.spouseStateWithholding).toBe(0);
  });

  it("throws when profile is missing", () => {
    const b = makeBundle();
    b.profile = undefined;
    expect(() => buildTaxInput(b, 2026)).toThrow(/profile is required/);
  });
});

describe("buildAnnualizedInput — cumulative periods", () => {
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
    const ann = buildAnnualizedInput(b, 2026);
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
    const ann = buildAnnualizedInput(b, 2026);
    // Q1 ends 2026-03-31 → pre-SE row is gated out, post-SE row not yet earned.
    expect(ann.periods[0].cumulativeGross1099).toBe(0);
    // Q2 ends 2026-05-31 → post-SE row counts.
    expect(ann.periods[1].cumulativeGross1099).toBe(20_000_00);
  });
});
