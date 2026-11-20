import { exampleBundle } from "@fiscode/csv";
import { estimateBundleYear } from "@fiscode/tax";
import { describe, expect, it } from "vitest";

import { expenseTotalsByCategory, yearEndLists } from "./year-end";

const expense = (
  date: string,
  category: string,
  amountCents: number,
  extra: { deletedAt?: string | null; startupExpense?: boolean } = {},
) => ({ date, category, amountCents, deletedAt: null, startupExpense: false, ...extra });

describe("expenseTotalsByCategory", () => {
  it("sums the year's expenses by category", () => {
    const rows = [
      expense("2026-03-01", "software_subs", 8950),
      expense("2026-05-01", "software_subs", 1050),
      expense("2026-05-02", "office_supplies", 2500),
    ];
    expect(expenseTotalsByCategory(rows, 2026, "2026-01-01")).toEqual({
      software_subs: 10000,
      office_supplies: 2500,
    });
  });

  it("leaves a §195 startup cost out of the categories (it has its own line)", () => {
    const startup = { ...expense("2025-12-15", "software_subs", 900_00), startupExpense: true };
    expect(expenseTotalsByCategory([startup], 2026, "2026-02-01")).toEqual({});
  });

  it("leaves out an expense dated before the SE start date, as Direct expenses does", () => {
    const rows = [
      expense("2026-02-10", "software_subs", 4000),
      expense("2026-04-01", "software_subs", 8950),
    ];
    expect(expenseTotalsByCategory(rows, 2026, "2026-04-01")).toEqual({ software_subs: 8950 });
  });

  it("leaves a startup cost paid before the SE start to its own §195 line, not a category", () => {
    // Deducted as a group under §195(b) (derived.startupCosts), so it isn't a per-category row.
    const rows = [expense("2026-02-10", "office_supplies", 4000, { startupExpense: true })];
    expect(expenseTotalsByCategory(rows, 2026, "2026-04-01")).toEqual({});
  });

  it("leaves self-employed health insurance out: it is a Schedule 1 adjustment, not Schedule C", () => {
    const rows = [
      expense("2026-03-01", "software_subs", 8950),
      expense("2026-03-01", "health_insurance", 50_000),
    ];
    expect(expenseTotalsByCategory(rows, 2026, "2026-01-01")).toEqual({ software_subs: 8950 });
  });

  it("adds up, with the §195 deduction, to the engine's Direct expenses", () => {
    // Demo data plus a $6,000 premium and a $900 startup cost paid before the start.
    const bundle = exampleBundle();
    const seStartDate = "2026-02-01";
    bundle.profile = { ...bundle.profile!, seStartDate };
    const base = bundle.expenses[0]!;
    bundle.expenses = [
      ...bundle.expenses,
      {
        ...base,
        id: "exp_demo_hi",
        date: "2026-03-01",
        category: "health_insurance",
        amountCents: 600_000,
        startupExpense: false,
      },
      {
        ...base,
        id: "exp_demo_su",
        date: "2025-12-15",
        category: "software_subs",
        amountCents: 90_000,
        startupExpense: true,
      },
    ];
    const { derived } = estimateBundleYear(bundle, 2026);
    const totals = expenseTotalsByCategory(bundle.expenses, 2026, seStartDate);
    const scheduleC = Object.values(totals).reduce((a, b) => a + b, 0);
    expect(totals).not.toHaveProperty("health_insurance");
    expect(derived.selfEmployedHealthInsurance).toBe(600_000);
    expect(scheduleC + derived.startupCosts.deductedThisYear).toBe(derived.directExpenses);
  });

  it("leaves out deleted expenses and other years", () => {
    const rows = [
      expense("2026-05-01", "software_subs", 8950, { deletedAt: "2026-06-01T00:00:00.000Z" }),
      expense("2025-12-31", "software_subs", 1200),
    ];
    expect(expenseTotalsByCategory(rows, 2026, "2026-01-01")).toEqual({});
  });
});

describe("yearEndLists", () => {
  const FIXED = "2026-06-04T12:00:00.000Z";
  const income = (
    id: string,
    date: string,
    amountCents: number,
    clientId: string | null,
    extra = {},
  ) => ({
    id,
    date,
    amountCents,
    clientId,
    sourceType: "1099",
    kind: "recurring",
    description: null,
    notes: null,
    createdAt: FIXED,
    updatedAt: FIXED,
    deletedAt: null,
    ...extra,
  });
  const trip = (id: string, date: string, businessMiles: number, extra = {}) => ({
    id,
    date,
    vehicleId: "v_demo",
    businessMiles,
    purpose: "Demo client visit",
    notes: null,
    createdAt: FIXED,
    updatedAt: FIXED,
    deletedAt: null,
    ...extra,
  });
  const bundle = {
    income: [
      income("i3", "2026-08-01", 30_000, "c_a"),
      income("i1", "2026-03-01", 100_000, "c_a"),
      income("i2", "2026-04-01", 50_000, "c_b"),
      income("i4", "2026-05-01", 20_000, null),
      income("pre", "2026-01-10", 99_900, "c_a"), // before the SE start
      income("gone", "2026-06-01", 77_700, "c_b", { deletedAt: FIXED }),
      income("w2", "2026-06-01", 55_500, null, { sourceType: "w2" }),
      income("old", "2025-12-01", 11_100, "c_a"),
    ],
    mileage: [
      trip("m2", "2026-07-15", 40),
      trip("m1", "2026-03-10", 10),
      trip("mpre", "2026-01-05", 99),
      trip("mgone", "2026-04-01", 5, { deletedAt: FIXED }),
    ],
  };

  const lists = yearEndLists(bundle as never, 2026, "2026-02-01");

  it("lists the year's counted 1099 income, oldest first", () => {
    expect(lists.income.map((r) => r.id)).toEqual(["i1", "i2", "i4", "i3"]);
  });

  it("totals 1099 income per client, largest first, with income that has no client on its own line", () => {
    expect(lists.clientTotals).toEqual([
      { clientId: "c_a", amountCents: 130_000 },
      { clientId: "c_b", amountCents: 50_000 },
      { clientId: null, amountCents: 20_000 },
    ]);
  });

  it("logs the year's counted trips, oldest first, each with the rate in force on its date", () => {
    expect(lists.mileage.map((t) => [t.id, t.ratePerMile])).toEqual([
      ["m1", 0.725],
      ["m2", 0.76],
    ]);
  });
});
