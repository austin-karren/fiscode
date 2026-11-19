import { describe, expect, it } from "vitest";
import { expensesCountedForYear } from "./expenses-for-year.ts";

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
      "startup expense dated in a prior year",
      row("a", "2025-12-31", { startupExpense: true }),
      "2026-03-01",
      false,
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

  it("keeps the rows that count, in their order, as the same objects", () => {
    const rows = [row("a", "2026-05-01"), row("b", "2026-01-01"), row("c", "2026-04-01")];
    const out = expensesCountedForYear(rows, 2026, "2026-03-01");
    expect(out).toEqual([rows[0], rows[2]]);
    expect(out[0]).toBe(rows[0]);
  });
});
