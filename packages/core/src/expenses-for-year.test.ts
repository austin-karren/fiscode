import { describe, expect, it } from "vitest";
import {
  countedExpenseDate,
  expensesCountedForYear,
  startupDeductionBetween,
} from "./expenses-for-year.ts";

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
      "startup expense in the year, before SE start: not per row (§195 group, startupDeductionBetween)",
      row("a", "2026-02-28", { startupExpense: true }),
      "2026-03-01",
      false,
    ],
    [
      "startup expense dated in the prior year: not per row in either year (§195 group)",
      row("a", "2025-12-31", { startupExpense: true }),
      "2026-03-01",
      false,
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
  // or business begins" (https://www.govinfo.gov/link/uscode/26/195).
  it("bug A: a startup cost paid 2025-12-15, business begins 2026-02-01, counts in 2026 only", () => {
    const rows = [{ ...row("s", "2025-12-15", { startupExpense: true }), amountCents: 90_000 }];
    // Not a per-row expense in either year; deducted as §195 startup costs in 2026.
    expect(ids(rows, 2025, "2026-02-01")).toEqual([]);
    expect(ids(rows, 2026, "2026-02-01")).toEqual([]);
    expect(startupDeductionBetween(rows, "2026-02-01", "2025-01-01", "2025-12-31")).toBe(0);
    expect(startupDeductionBetween(rows, "2026-02-01", "2026-01-01", "2026-12-31")).toBe(90_000);
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

// IRC §195(b)(1), https://www.govinfo.gov/link/uscode/26/195: the start year gets the lesser of the
// costs or $5,000 reduced by the amount over $50,000; "the remainder ... shall be allowed as a
// deduction ratably over the 180-month period beginning with the month in which the active trade or
// business begins."
describe("startupDeductionBetween (§195(b) limit and amortization)", () => {
  const startup = (amountCents: number, date = "2025-12-15") => ({
    date,
    deletedAt: null as string | null,
    startupExpense: true,
    amountCents,
  });
  const year = (rows: ReturnType<typeof startup>[], seStart: string, y: number) =>
    startupDeductionBetween(rows, seStart, `${y}-01-01`, `${y}-12-31`);

  it("$3,000: all of it in the start year, nothing later", () => {
    expect(year([startup(300_000)], "2026-03-02", 2026)).toBe(300_000);
    expect(year([startup(300_000)], "2026-03-02", 2027)).toBe(0);
    expect(year([startup(300_000)], "2026-03-02", 2025)).toBe(0);
  });

  it("$12,000, start Mar 2: $5,388.89 in the start year, $466.67 a full year after", () => {
    // first 5,000; remainder 7,000 / 180 = 38.888… a month. 2026: Mar–Dec = 10 months → 388.89.
    expect(year([startup(1_200_000)], "2026-03-02", 2026)).toBe(538_889);
    // 2027: 12 months → 466.67.
    expect(year([startup(1_200_000)], "2026-03-02", 2027)).toBe(46_667);
  });

  it("$60,000: the $5,000 is phased out (60,000 − 50,000 = 10,000 > 5,000), all amortized", () => {
    // first 0; 60,000 / 180 = 333.33 a month; Mar–Dec 10 months = 3,333.33.
    expect(year([startup(6_000_000)], "2026-03-02", 2026)).toBe(333_333);
  });

  it("a December start gets 1 month of amortization in the start year", () => {
    // $12,000: 5,000 + 7,000 / 180 × 1 = 5,038.89.
    expect(year([startup(1_200_000)], "2026-12-01", 2026)).toBe(503_889);
  });

  it("year 16 takes the last months: a Mar 2026 start runs Mar 2026 – Feb 2041", () => {
    // 180 months from Mar 2026 end with Feb 2041: 2041 has 2 months = 77.78; 2042 none.
    expect(year([startup(1_200_000)], "2026-03-02", 2041)).toBe(7_778);
    expect(year([startup(1_200_000)], "2026-03-02", 2042)).toBe(0);
  });

  it("only startup rows paid before the SE start, live, count; several rows add up", () => {
    const rows = [
      startup(200_000),
      startup(100_000, "2026-01-10"),
      { ...startup(900_000), deletedAt: "x" },
      { ...startup(800_000, "2026-04-01") }, // after the start: an ordinary expense
      { ...startup(700_000), startupExpense: false },
    ];
    expect(year(rows, "2026-03-02", 2026)).toBe(300_000);
  });

  it("a window counts the start-year amount on the SE start date and each month on its first day", () => {
    // $12,000, start Mar 2: through Mar 31 = 5,000 + 1 month (38.89) = 5,038.89.
    expect(
      startupDeductionBetween([startup(1_200_000)], "2026-03-02", "2026-01-01", "2026-03-31"),
    ).toBe(503_889);
    // Through Feb 28: before the start, nothing.
    expect(
      startupDeductionBetween([startup(1_200_000)], "2026-03-02", "2026-01-01", "2026-02-28"),
    ).toBe(0);
  });

  it("no SE start: nothing is a pre-start startup cost", () => {
    expect(startupDeductionBetween([startup(300_000)], null, "2025-01-01", "2025-12-31")).toBe(0);
  });
});
