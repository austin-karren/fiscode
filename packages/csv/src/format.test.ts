import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { emptyBundle, type Bundle, type ExpenseRow, type IncomeRow } from "./bundle-types.ts";
import { EXAMPLE_FIXED_TIMESTAMP, exampleBundle } from "./example.ts";
import { exportBundle, exportFileName } from "./export.ts";
import { parseCsv } from "./import.ts";

const TS = EXAMPLE_FIXED_TIMESTAMP;
const HERE = dirname(fileURLToPath(import.meta.url));
const V1_FIXTURE = readFileSync(join(HERE, "fixtures", "v1-example.csv"), "utf8");

const exportFull = (bundle: Bundle): string =>
  exportBundle(bundle, { scope: "full", exportedAt: TS });

// Parse an export the way a spreadsheet does: no knowledge of fiscode, just cells.
const cells = (csv: string): string[][] => Papa.parse<string[]>(csv.replace(/^﻿/, "")).data;

// The rows of one section as header-keyed objects.
const section = (csv: string, recordType: string): Array<Record<string, string>> => {
  const out: Array<Record<string, string>> = [];
  let header: string[] = [];
  for (const row of cells(csv)) {
    if (row[0] === "record_type") header = row;
    else if (row[0] === recordType) {
      out.push(Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""])));
    }
  }
  return out;
};

const income = (over: Partial<IncomeRow>): IncomeRow => ({
  id: "in_1",
  date: "2026-01-15",
  clientId: null,
  amountCents: 0,
  sourceType: "1099",
  kind: "recurring",
  description: null,
  notes: null,
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
  ...over,
});

const expense = (over: Partial<ExpenseRow>): ExpenseRow => ({
  id: "ex_1",
  date: "2026-01-15",
  amountCents: 0,
  category: "supplies",
  clientId: null,
  description: null,
  reason: null,
  notes: null,
  flagForSection179: false,
  startupExpense: false,
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
  ...over,
});

const withIncome = (...rows: IncomeRow[]): Bundle => ({ ...emptyBundle(), income: rows });
const withExpenses = (...rows: ExpenseRow[]): Bundle => ({ ...emptyBundle(), expenses: rows });

describe("old-format (v1) files still import", () => {
  it("the v1 example fixture parses to the example bundle with no errors", () => {
    expect(V1_FIXTURE).toContain("# schema: v1");
    const { bundle, validationErrors } = parseCsv(V1_FIXTURE);
    expect(validationErrors).toEqual([]);
    expect(bundle).toEqual(exampleBundle());
  });

  it("a v1 file re-exports as the same bytes a fresh export produces", () => {
    const { bundle } = parseCsv(V1_FIXTURE);
    expect(exportFull(bundle)).toBe(exportFull(exampleBundle()));
  });

  it("a v1 file keeps text that happens to look like a formula guard", () => {
    // v1 never wrote the `'` guard, so a leading `'=` in a v1 file is the user's own text.
    const v1 = V1_FIXTURE.replace("January retainer", "'=literal");
    const { bundle, validationErrors } = parseCsv(v1);
    expect(validationErrors).toEqual([]);
    expect(bundle.income[0]!.description).toBe("'=literal");
  });
});

describe("round trip is byte-identical", () => {
  it("export -> import -> export gives the same bytes for the example bundle", () => {
    const first = exportFull(exampleBundle());
    const { bundle, provenance, validationErrors } = parseCsv(first);
    expect(validationErrors).toEqual([]);
    expect(bundle).toEqual(exampleBundle());
    expect(exportBundle(bundle, { scope: "full", exportedAt: provenance.exportedAt })).toBe(first);
  });

  it("holds for awkward text: commas, quotes, newlines, formula starts, non-ASCII, padding", () => {
    const awkward = [
      'He said "net 30", then paid',
      "line one\nline two",
      "line one\r\nline two",
      "note\n# not a comment\nrecord_type,id",
      "=SUM(A1:A9)",
      "+1 bonus",
      "-5 discount",
      "@handle",
      "'quoted start",
      "'=already guarded",
      "  padded  ",
      "Café Zoë — §179 ✓ 日本語",
      "a,b;c\td",
    ];
    const bundle = withIncome(
      ...awkward.map((text, i) => income({ id: `in_${i}`, description: text, notes: text })),
    );
    const first = exportFull(bundle);
    const { bundle: round, validationErrors } = parseCsv(first);
    expect(validationErrors).toEqual([]);
    expect(round).toEqual(bundle);
    expect(exportFull(round)).toBe(first);
  });

  it("holds for money edge values, including negatives and single cents", () => {
    const amounts = [0, 1, 5, 10, 99, 100, 101, 89_999, 123_456_789, -1, -50, -12_345];
    const bundle = withIncome(...amounts.map((c, i) => income({ id: `in_${i}`, amountCents: c })));
    const first = exportFull(bundle);
    const { bundle: round, validationErrors } = parseCsv(first);
    expect(validationErrors).toEqual([]);
    expect(round.income.map((r) => r.amountCents)).toEqual(amounts);
    expect(exportFull(round)).toBe(first);
  });

  it("holds for an empty bundle", () => {
    const first = exportFull(emptyBundle());
    const { bundle, validationErrors } = parseCsv(first);
    expect(validationErrors).toEqual([]);
    expect(bundle).toEqual(emptyBundle());
    expect(exportFull(bundle)).toBe(first);
  });
});

describe("layout a person can read", () => {
  const csv = exportFull(exampleBundle());

  it("marks the schema as v2", () => {
    expect(csv).toContain("# schema: v2");
  });

  it("gives each record type its own titled table, in a fixed order", () => {
    const titles = cells(csv)
      .map((r) => r[0] ?? "")
      .filter((c) => c.startsWith("# ") && !c.includes(":") && !c.includes("."));
    expect(titles).toEqual([
      "# fiscode export",
      "# Profile",
      "# Business entity",
      "# Spouse W-2 income",
      "# Clients",
      "# Income",
      "# Time",
      "# Vehicles",
      "# Mileage",
      "# Home office",
      "# Expenses",
      "# Retirement contributions",
    ]);
  });

  it("puts readable columns first and ids and timestamps last", () => {
    const header = cells(csv).filter((r) => r[0] === "record_type");
    expect(header).toHaveLength(11);
    const incomeHeader = header[4]!;
    expect(incomeHeader).toEqual([
      "record_type",
      "date",
      "client_name",
      "amount",
      "source_type",
      "source_type_label",
      "kind",
      "kind_label",
      "description",
      "notes",
      "id",
      "client_id",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);
    // No table drags along another record type's columns.
    expect(Math.max(...header.map((h) => h.length))).toBeLessThanOrEqual(17);
  });

  it("omits a section that has no rows", () => {
    const only = exportFull(withIncome(income({ amountCents: 100 })));
    expect(only).toContain("# Income");
    expect(only).not.toContain("# Expenses");
  });

  it("writes money as dollars with two decimals", () => {
    const [desk] = section(csv, "expense");
    expect(desk!.amount).toBe("899.99");
    expect(section(csv, "income").map((r) => r.amount)).toEqual(["10000.00", "3500.00", "6250.00"]);
    expect(section(csv, "spouse")[0]!.annual_w2_wages).toBe("45000.00");
    expect(section(csv, "client")[1]!.default_rate).toBe("15000.00");
    expect(csv).not.toContain("_cents");
  });

  it("writes single cents and negatives without losing digits", () => {
    const out = exportFull(
      withIncome(
        income({ id: "a", amountCents: 5 }),
        income({ id: "b", amountCents: -50 }),
        income({ id: "c", amountCents: -12_345 }),
      ),
    );
    expect(section(out, "income").map((r) => r.amount)).toEqual(["0.05", "-0.50", "-123.45"]);
  });

  it("writes commission as a percent", () => {
    expect(section(csv, "client")[0]!.default_commission_rate_percent).toBe("6.00");
  });

  it("keeps dates as ISO YYYY-MM-DD", () => {
    expect(section(csv, "income")[0]!.date).toBe("2026-01-15");
    expect(section(csv, "profile")[0]!.se_start_date).toBe("2024-01-01");
    expect(section(csv, "vehicle")[0]!.in_service_date).toBe("2024-01-01");
  });

  it("puts a human label beside each code", () => {
    const profile = section(csv, "profile")[0]!;
    expect(profile.filing_status).toBe("mfj");
    expect(profile.filing_status_label).toBe("Married filing jointly");
    expect(profile.quarterly_method_label).toBe("Annualized installment");
    expect(section(csv, "entity")[0]!.type_label).toBe("Sole proprietor");
    expect(section(csv, "expense")[1]!.category_label).toBe("Software & subscriptions");
    expect(section(csv, "vehicle")[0]!.method_label).toBe("Standard mileage");
    expect(section(csv, "home_office")[0]!.method_label).toBe("Simplified");
    expect(section(csv, "retirement_contribution")[0]!.account_label).toBe("Roth IRA");
  });

  it("names the client and vehicle beside their ids", () => {
    const first = section(csv, "income")[0]!;
    expect(first.client_name).toBe("Stable Commission Co");
    expect(first.client_id).toBe("cl_01HXSP00CLIENT0000001");
    expect(section(csv, "mileage")[0]!.vehicle_name).toBe("2022 Toyota RAV4");
    expect(section(csv, "time_entry")[0]!.hours).toBe("8.00");
  });

  it("writes booleans as yes / no", () => {
    expect(section(csv, "profile")[0]!.tracks_roth).toBe("yes");
    expect(section(csv, "expense").map((r) => r.flag_for_section_179)).toEqual(["yes", "no", "no"]);
  });

  it("leaves an unknown code's label blank instead of guessing", () => {
    const out = exportFull(withExpenses(expense({ category: "made_up" })));
    const row = section(out, "expense")[0]!;
    expect(row.category).toBe("made_up");
    expect(row.category_label).toBe("");
  });
});

describe("quoting (RFC 4180) and spreadsheet safety", () => {
  it("ends every record with CRLF and the file with exactly one", () => {
    const csv = exportFull(exampleBundle());
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.endsWith("\r\n\r\n")).toBe(false);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("quotes cells with commas, quotes and newlines, doubling inner quotes", () => {
    const csv = exportFull(
      withIncome(income({ description: 'He said "net 30", then paid', notes: "one\ntwo" })),
    );
    expect(csv).toContain('"He said ""net 30"", then paid"');
    expect(csv).toContain('"one\ntwo"');
  });

  it("guards text that a spreadsheet would run as a formula", () => {
    const csv = exportFull(
      withIncome(
        income({ id: "a", description: "=SUM(A1:A9)" }),
        income({ id: "b", description: "+1 bonus" }),
        income({ id: "c", description: "-5 discount" }),
        income({ id: "d", description: "@handle" }),
      ),
    );
    expect(section(csv, "income").map((r) => r.description)).toEqual([
      "'=SUM(A1:A9)",
      "'+1 bonus",
      "'-5 discount",
      "'@handle",
    ]);
  });

  it("does not guard a negative amount, so it stays a number", () => {
    const csv = exportFull(withIncome(income({ amountCents: -5000 })));
    expect(section(csv, "income")[0]!.amount).toBe("-50.00");
  });

  it("guards a client name shown in a label column", () => {
    const bundle = withIncome(income({ clientId: "cl_1", amountCents: 100 }));
    bundle.clients = [
      {
        id: "cl_1",
        name: "=Evil Co",
        type: null,
        notes: null,
        defaultRateCents: null,
        defaultCommissionRate: null,
        createdAt: TS,
        updatedAt: TS,
        deletedAt: null,
      },
    ];
    const csv = exportFull(bundle);
    expect(section(csv, "income")[0]!.client_name).toBe("'=Evil Co");
    expect(parseCsv(csv).bundle).toEqual(bundle);
  });
});

describe("UTF-8 BOM", () => {
  it("starts the export with a BOM so Excel reads non-ASCII correctly", () => {
    const csv = exportFull(exampleBundle());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1, 17)).toBe("# fiscode export");
    const bytes = new TextEncoder().encode(csv);
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("imports a file with a BOM", () => {
    const { bundle, provenance, validationErrors } = parseCsv(exportFull(exampleBundle()));
    expect(validationErrors).toEqual([]);
    expect(provenance.exportedAt).toBe(TS);
    expect(bundle.profile?.id).toBe("profile");
  });

  it("imports a file without a BOM, and an old file with one added", () => {
    const noBom = exportFull(exampleBundle()).replace(/^﻿/, "");
    expect(parseCsv(noBom).bundle).toEqual(exampleBundle());
    const v1WithBom = parseCsv("﻿" + V1_FIXTURE);
    expect(v1WithBom.validationErrors).toEqual([]);
    expect(v1WithBom.bundle).toEqual(exampleBundle());
    expect(v1WithBom.provenance.scope).toBe("full");
  });
});

describe("import of files a person or a spreadsheet has touched", () => {
  const base = exportFull(withIncome(income({ amountCents: 1_000_000, description: "x" })));
  const withAmount = (text: string) => base.replace("10000.00", text);

  it("reads dollar amounts a spreadsheet re-saved: no decimals, one decimal, $ and commas", () => {
    for (const [text, centsValue] of [
      ["10000", 1_000_000],
      ["10000.5", 1_000_050],
      ['"$10,000.00"', 1_000_000],
      ['"10,000.25"', 1_000_025],
      ["-12.3", -1230],
    ] as const) {
      const { bundle, validationErrors } = parseCsv(withAmount(text));
      expect(validationErrors).toEqual([]);
      expect(bundle.income[0]!.amountCents).toBe(centsValue);
    }
  });

  it("rejects a dollar amount it cannot read exactly", () => {
    for (const text of ["10000.005", "ten", "1e3", '"1,00.00"']) {
      const { bundle, validationErrors } = parseCsv(withAmount(text));
      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]!.message).toMatch(/amount/);
      expect(bundle.income).toEqual([]);
    }
  });

  it("rejects a date a spreadsheet rewrote, instead of storing it", () => {
    const { bundle, validationErrors } = parseCsv(base.replace("2026-01-15", "1/15/2026"));
    expect(validationErrors).toHaveLength(1);
    expect(validationErrors[0]!.message).toMatch(/date.*YYYY-MM-DD/);
    expect(bundle.income).toEqual([]);
  });

  it("survives a spreadsheet padding every line with trailing commas", () => {
    const first = exportFull(exampleBundle());
    const padded = first
      .replace(/^﻿/, "")
      .split("\r\n")
      .map((line) => line + ",,,")
      .join("\r\n");
    const { bundle, provenance, validationErrors } = parseCsv(padded);
    expect(validationErrors).toEqual([]);
    expect(bundle).toEqual(exampleBundle());
    expect(provenance.scope).toBe("full");
    expect(provenance.exportedAt).toBe(TS);
  });

  it("reads LF line endings and ignores the label columns", () => {
    const first = exportFull(exampleBundle());
    const edited = first.replace(/\r\n/g, "\n").replace("Married filing jointly", "Something else");
    const { bundle, validationErrors } = parseCsv(edited);
    expect(validationErrors).toEqual([]);
    expect(bundle).toEqual(exampleBundle());
  });

  it("accepts cents columns and 1 / 0 inside the new layout", () => {
    const mixed =
      "record_type,date,amount_cents,flag_for_section_179,category,id\r\n" +
      "expense,2026-02-01,12345,1,supplies,ex_9\r\n";
    const { bundle, validationErrors } = parseCsv(mixed);
    expect(validationErrors).toEqual([]);
    expect(bundle.expenses[0]!.amountCents).toBe(12_345);
    expect(bundle.expenses[0]!.flagForSection179).toBe(true);
  });

  it("still flags a mistyped record type", () => {
    const { validationErrors } = parseCsv(base.replace("\r\nincome,", "\r\nincom,"));
    expect(validationErrors).toHaveLength(1);
    expect(validationErrors[0]!.message).toMatch(/record_type/);
  });

  it("flags a data row that comes before any header", () => {
    const { validationErrors } = parseCsv("income,2026-01-01,5.00\r\n");
    expect(validationErrors).toHaveLength(1);
    expect(validationErrors[0]!.message).toMatch(/header/);
  });
});

describe("download file name", () => {
  it("names the yearly file for the accountant and the full file as a dated backup", () => {
    expect(exportFileName({ scope: "yearly", year: 2026 }, "2026-11-18")).toBe(
      "fiscode-2026-tax-year.csv",
    );
    expect(exportFileName({ scope: "full" }, "2026-11-18")).toBe(
      "fiscode-full-backup-2026-11-18.csv",
    );
  });
});
