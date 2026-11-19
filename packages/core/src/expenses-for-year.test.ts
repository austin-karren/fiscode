import { describe, expect, it } from "vitest";
import { countedExpenseDate, expensesCountedForYear } from "./expenses-for-year.ts";

type Row = { id: string; date: string; deletedAt: string | null; startupExpense?: boolean };

const row = (id: string, date: string, extra: Partial<Row> = {}): Row => ({
  id,
  date,
  deletedAt: null,
  ...extra,
});

const ids = (rows: Row[], year: number, seStart: string | null | undefined) =>
  expensesCountedForYear(rows, year, seStart).map((r) => r.id);

describe("expensesCountedForYear", () => {
  it.each<[string, Row, string | null | undefined, boolean]>([
    ["in the year, after SE start", row("a", "2026-05-01"), "2026-03-01", true],
    ["in the year, on the SE start day", row("a", "2026-03-01"), "2026-03-01", true],
    ["in the year, before SE start", row("a", "2026-02-28"), "2026-03-01", false],
    [
      "startup expense in the year, before SE start",
      row("a", "2026-02-28", { startupExpense: true }),
      "2026-03-01",
      true,
    ],
    [
      "startup expense dated in the prior year, business begins in this year: counts (§195(b))",
      row("a", "2025-12-31", { startupExpense: true }),
      "2026-03-01",
      true,
    ],
    [
      "ticked startup but paid after a start in the prior year: an ordinary expense of its year",
      row("a", "2026-02-01", { startupExpense: true }),
      "2025-11-01",
      true,
    ],
    [
      "startup expense dated after the SE start is an ordinary expense of its own year",
      row("a", "2026-05-01", { startupExpense: true }),
      "2026-03-01",
      true,
    ],
    [
      "startup expense, SE start null: its own year",
      row("a", "2026-02-01", { startupExpense: true }),
      null,
      true,
    ],
    [
      "deleted",
      row("a", "2026-05-01", { deletedAt: "2026-06-01T00:00:00.000Z" }),
      "2026-03-01",
      false,
    ],
    [
      "deleted startup expense",
      row("a", "2026-02-01", { deletedAt: "x", startupExpense: true }),
      "2026-03-01",
      false,
    ],
    ["another year, after SE start", row("a", "2027-01-05"), "2026-03-01", false],
    ["SE start null: any day of the year counts", row("a", "2026-01-01"), null, true],
    ["SE start blank: any day of the year counts", row("a", "2026-01-01"), "", true],
    ["SE start in an earlier year", row("a", "2026-01-01"), "2024-01-01", true],
    ["SE start in a later year", row("a", "2026-12-31"), "2027-01-01", false],
  ])("%s", (_, r, seStart, counted) => {
    expect(ids([r], 2026, seStart)).toEqual(counted ? ["a"] : []);
  });

  // Bug A: IRC §195(b)(1)(A) allows the deduction "for the taxable year in which the active trade
  // or business begins" (https://www.law.cornell.edu/uscode/text/26/195).
  it("bug A: a startup cost paid 2025-12-15, business begins 2026-02-01, counts in 2026 only", () => {
    const rows = [row("s", "2025-12-15", { startupExpense: true })];
    expect(ids(rows, 2025, "2026-02-01")).toEqual([]);
    expect(ids(rows, 2026, "2026-02-01")).toEqual(["s"]);
  });

  it("a counted startup cost paid before the start takes effect on the SE start date", () => {
    expect(countedExpenseDate(row("s", "2025-12-15", { startupExpense: true }), "2026-02-01")).toBe(
      "2026-02-01",
    );
    expect(countedExpenseDate(row("e", "2026-05-01"), "2026-02-01")).toBe("2026-05-01");
    expect(countedExpenseDate(row("s", "2026-05-01", { startupExpense: true }), "2026-02-01")).toBe(
      "2026-05-01",
    );
    expect(countedExpenseDate(row("s", "2026-01-15", { startupExpense: true }), null)).toBe(
      "2026-01-15",
    );
  });

  it("keeps the rows that count, in their order, as the same objects", () => {
    const rows = [row("a", "2026-05-01"), row("b", "2026-01-01"), row("c", "2026-04-01")];
    const out = expensesCountedForYear(rows, 2026, "2026-03-01");
    expect(out).toEqual([rows[0], rows[2]]);
    expect(out[0]).toBe(rows[0]);
  });
});
