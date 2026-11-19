import { describe, expect, it } from "vitest";

import { expenseTotalsByCategory } from "./year-end";

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

  it("leaves out an expense dated before the SE start date, as Direct expenses does", () => {
    const rows = [
      expense("2026-02-10", "software_subs", 4000),
      expense("2026-04-01", "software_subs", 8950),
    ];
    expect(expenseTotalsByCategory(rows, 2026, "2026-04-01")).toEqual({ software_subs: 8950 });
  });

  it("counts a startup expense dated before the SE start date", () => {
    const rows = [expense("2026-02-10", "office_supplies", 4000, { startupExpense: true })];
    expect(expenseTotalsByCategory(rows, 2026, "2026-04-01")).toEqual({ office_supplies: 4000 });
  });

  it("leaves out deleted expenses and other years", () => {
    const rows = [
      expense("2026-05-01", "software_subs", 8950, { deletedAt: "2026-06-01T00:00:00.000Z" }),
      expense("2025-12-31", "software_subs", 1200),
    ];
    expect(expenseTotalsByCategory(rows, 2026, "2026-01-01")).toEqual({});
  });
});
