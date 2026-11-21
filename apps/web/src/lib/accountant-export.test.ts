import { describe, expect, it } from "vitest";
import { exampleBundle, readImportFile, type Bundle } from "@fiscode/csv";
import { estimateBundleYear } from "@fiscode/tax";

import { accountantExport, accountantExportFileName } from "./accountant-export";

const FIXED = "2026-06-04T12:00:00.000Z";

const withW2AndPayments = (): Bundle => {
  const b = exampleBundle();
  b.w2Jobs = [
    {
      id: "w2_1",
      taxYear: 2026,
      employer: "Demo Employer Inc",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      wagesCents: 18_000_00,
      federalWithholdingCents: 500_00,
      ssWagesCents: 18_000_00,
      ssTaxWithheldCents: 1_116_00,
      medicareWagesCents: 18_000_00,
      ssTipsCents: 0,
      stateWagesCents: 18_000_00,
      stateWithholdingCents: 300_00,
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ];
  b.estimatedPayments = [
    {
      id: "ep_1",
      date: "2026-04-15",
      amountCents: 400_00,
      jurisdiction: "federal",
      taxYear: 2026,
      appliedQuarter: null,
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
    {
      id: "ep_2",
      date: "2026-09-15",
      amountCents: 100_00,
      jurisdiction: "UT",
      taxYear: 2026,
      appliedQuarter: null,
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ];
  return b;
};

/** The file's tables, by name: header row first, then the rows, as cells. Quotes are simple here. */
const tables = (csv: string): Map<string, string[][]> => {
  const parse = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const map = new Map<string, string[][]>();
  for (const block of csv.replace(/^﻿/, "").split("\r\n\r\n")) {
    const rows = block
      .split("\r\n")
      .filter((l) => l !== "")
      .map(parse);
    if (rows.length) map.set(rows[0]![0]!, rows);
  }
  return map;
};

const total = (rows: string[][], column: string): string => {
  const at = rows[0]!.indexOf(column);
  return rows.find((r) => r[1] === "Total")![at]!;
};

const money = (c: number) => (c / 100).toFixed(2);

describe("accountant export: a summary to read, never to import", () => {
  const csv = accountantExport(withW2AndPayments(), 2026, "2026-11-21");

  it("starts with a UTF-8 BOM, uses CRLF, and the importer refuses it", () => {
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
    const read = readImportFile(csv);
    expect(read.ok).toBe(false);
  });

  it("says so in the file, in its first table", () => {
    const about = tables(csv).get("About this file")!;
    expect(about[0]).toEqual(["About this file", "item", "value"]);
    expect(about.map((r) => r.slice(1).join(": ")).join("\n")).toMatch(
      /Importable: No\. This is a summary for reading\. To move data into fiscode, use the yearly CSV\./,
    );
  });

  it("every table starts with its header row, and column 1 names the table on every row", () => {
    for (const [name, rows] of tables(csv)) {
      for (const r of rows) expect(r[0]).toBe(name);
    }
    expect([...tables(csv).keys()]).toEqual([
      "About this file",
      "Estimate summary",
      "Schedule C expenses by category",
      "Income",
      "Expenses",
      "Mileage",
      "Start-up costs (section 195)",
      "W-2 jobs",
      "Spouse W-2",
      "Estimated payments",
      "Federal payments by quarter",
    ]);
  });

  it("dollars have 2 decimals and no symbol; dates are ISO", () => {
    const income = tables(csv).get("Income")!;
    const amount = income[0]!.indexOf("amount");
    const date = income[0]!.indexOf("date");
    for (const r of income.slice(1).filter((r) => r[1] !== "Total")) {
      expect(r[amount]).toMatch(/^-?\d+\.\d{2}$/);
      expect(r[date]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("accountant export: totals agree with the estimate", () => {
  const b = withW2AndPayments();
  const csv = accountantExport(b, 2026, "2026-11-21");
  const t = tables(csv);
  const { derived, result } = estimateBundleYear(b, 2026);

  it("Schedule C categories plus the section 195 amount add up to direct expenses", () => {
    expect(total(t.get("Schedule C expenses by category")!, "amount")).toBe(
      money(derived.directExpenses),
    );
  });

  it("the mileage total is the estimate's mileage deduction; each trip shows its rate and deduction", () => {
    const m = t.get("Mileage")!;
    expect(m[0]).toEqual(
      expect.arrayContaining(["date", "business_miles", "rate_per_mile", "deduction"]),
    );
    expect(total(m, "deduction")).toBe(money(derived.mileageDeduction));
  });

  it("1099 income total is gross 1099", () => {
    expect(total(t.get("Income")!, "amount_1099")).toBe(money(derived.gross1099));
  });

  it("the estimate summary carries SE health insurance on Schedule 1 line 17 and the liability", () => {
    const s = t.get("Estimate summary")!;
    const line = (label: string) => s.find((r) => r[1] === label)?.[2];
    expect(line("Self-employed health insurance (Schedule 1 line 17)")).toBe(
      money(result.estimate.selfEmployedHealthInsurance),
    );
    expect(line("Total liability (federal + state)")).toBe(money(result.estimate.totalLiability));
    expect(line("Safe-harbor floor (required annual payment)")).toBe(
      money(result.safeHarbor.floor),
    );
  });

  it("section 195: the summary lines, after any start-up rows (none in the demo)", () => {
    const s = t.get("Start-up costs (section 195)")!;
    expect(s.map((r) => r[1])).toEqual([
      "item",
      "Paid before the business began",
      "Deducted this year",
      "Left to deduct after this year",
    ]);
  });

  it("W-2 and payments: rows with totals; quarters with required, paid and shortfall", () => {
    expect(total(t.get("W-2 jobs")!, "wages")).toBe("18000.00");
    const p = t.get("Estimated payments")!;
    expect(p.find((r) => r[1] === "Total federal")?.[p[0]!.indexOf("amount")]).toBe("400.00");
    expect(p.find((r) => r[1] === "Total Utah")?.[p[0]!.indexOf("amount")]).toBe("100.00");
    // Utah has no quarterly schedule: its payments have no quarter.
    const q3 = p[0]!.indexOf("applied_quarter");
    expect(p.find((r) => r[1] === "2026-09-15")?.[q3]).toBe("");
    expect(p.find((r) => r[1] === "2026-04-15")?.[q3]).toBe("1");
    const q = t.get("Federal payments by quarter")!;
    expect(q[0]).toEqual([
      "Federal payments by quarter",
      "quarter",
      "due_date",
      "required_through",
      "paid_by_due_date",
      "shortfall",
    ]);
    expect(q).toHaveLength(5);
  });
});

describe("accountant export: text cells can't run as formulas", () => {
  it("a description starting with = is written with a leading '", () => {
    const b = exampleBundle();
    b.income[0] = { ...b.income[0]!, description: "=SUM(A1:A9)" };
    expect(accountantExport(b, 2026, "2026-11-21")).toContain(",'=SUM(A1:A9),");
  });
});

describe("accountantExportFileName", () => {
  it("names the year and the date, and says it is a summary", () => {
    expect(accountantExportFileName(2026, "2026-11-21")).toBe(
      "fiscode-2026-accountant-summary-2026-11-21.csv",
    );
  });
});

describe("review #82 r1", () => {
  it("R1 MFJ: spouse W-2 table and summary lines; AGI and federal paid reconcile", () => {
    const b = withW2AndPayments(); // MFJ, spouse block 45,000 / 4,500 / 1,800
    const t = tables(accountantExport(b, 2026, "2026-11-21"));
    const { result, derived } = estimateBundleYear(b, 2026);
    const sp = t.get("Spouse W-2")!;
    expect(sp[0]).toEqual([
      "Spouse W-2",
      "start_date",
      "end_date",
      "annual_wages",
      "federal_withholding",
      "state_withholding",
      "counted_wages",
    ]);
    expect(sp[1]!.slice(3)).toEqual(["45000.00", "4500.00", "1800.00", "45000.00"]);
    const s = t.get("Estimate summary")!;
    const line = (label: string) => Number(s.find((r) => r[1] === label)![2]);
    expect(line("Spouse W-2 wages")).toBe(45_000);
    expect(line("Federal withholding (own + spouse)")).toBe(5_000);
    const e = result.estimate;
    // AGI = own W-2 + spouse W-2 + net profit − half SE tax − SE health insurance.
    expect(
      line("Own W-2 wages") +
        line("Spouse W-2 wages") +
        line("Net profit (Schedule C line 31)") -
        line("Deductible half of SE tax (Schedule 1 line 15)") -
        line("Self-employed health insurance (Schedule 1 line 17)"),
    ).toBeCloseTo(e.agi / 100, 2);
    expect(
      line("Federal withholding (own + spouse)") + line("Federal estimated payments"),
    ).toBeCloseTo(result.payments.federal.totalPaid / 100, 2);
    expect(derived.ownW2Wages).toBe(18_000_00);
  });

  it("R1 not joint: the spouse table shows the block, counted 0", () => {
    const b = withW2AndPayments();
    b.profile = { ...b.profile!, filingStatus: "single" };
    const sp = tables(accountantExport(b, 2026, "2026-11-21")).get("Spouse W-2")!;
    expect(sp[1]![6]).toBe("0.00");
  });

  it("R2 section 195: each pre-start start-up row is listed above the summary lines", () => {
    const b = exampleBundle();
    b.profile = { ...b.profile!, seStartDate: "2026-02-01" };
    b.expenses.push({
      ...b.expenses.find((e) => e.category === "software_subs")!,
      id: "ex_startup" as never,
      date: "2026-01-05",
      description: "Demo LLC filing fee",
      amountCents: 1_200_00,
      startupExpense: true,
    });
    const s = tables(accountantExport(b, 2026, "2026-11-21")).get("Start-up costs (section 195)")!;
    expect(s[0]).toEqual(["Start-up costs (section 195)", "item", "date", "category", "amount"]);
    expect(s[1]!.slice(1)).toEqual([
      "Demo LLC filing fee",
      "2026-01-05",
      "Software & subscriptions",
      "1200.00",
    ]);
    expect(s.slice(2).map((r) => r[1])).toEqual([
      "Paid before the business began",
      "Deducted this year",
      "Left to deduct after this year",
    ]);
  });

  it("R3 expenses: the total says it includes health insurance, with a line-17 subtotal", () => {
    const b = exampleBundle();
    b.expenses.push({
      ...b.expenses.find((e) => e.category === "software_subs")!,
      id: "ex_hi" as never,
      date: "2026-05-01",
      category: "health_insurance",
      description: "Demo premium",
      amountCents: 300_00,
    });
    const ex = tables(accountantExport(b, 2026, "2026-11-21")).get("Expenses")!;
    const amount = ex[0]!.indexOf("amount");
    expect(ex.find((r) => r[1] === "Health insurance (Schedule 1 line 17)")?.[amount]).toBe(
      "300.00",
    );
    expect(ex.at(-1)![1]).toBe("Total (incl. health insurance, Schedule 1 line 17)");
  });

  it("R4 About explains the leading apostrophe", () => {
    const about = tables(accountantExport(exampleBundle(), 2026, "2026-11-21")).get(
      "About this file",
    )!;
    expect(about.find((r) => r[1] === "Leading apostrophe")?.[2]).toMatch(
      /A text cell that starts with = \+ - or @ is written with a leading ' so it can't run as a formula\./,
    );
  });
});
