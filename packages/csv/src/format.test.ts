import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { describe, expect, it, vi } from "vitest";
import { emptyBundle, type Bundle, type ExpenseRow, type IncomeRow } from "./bundle-types.ts";
import { EXAMPLE_FIXED_TIMESTAMP, exampleBundle } from "./example.ts";
import { bundleToRows, DELETED_TITLE_SUFFIX, exportBundle, exportFileName } from "./export.ts";
import { describeImportError, describeImportErrors, parseCsv } from "./import.ts";
import { BOM, stripBom } from "./provenance.ts";
import { isStored, SECTIONS } from "./sections.ts";

const TS = EXAMPLE_FIXED_TIMESTAMP;
const HERE = dirname(fileURLToPath(import.meta.url));
const V1_FIXTURE = readFileSync(join(HERE, "fixtures", "v1-example.csv"), "utf8");

const exportFull = (bundle: Bundle): string => exportBundle(bundle, { scope: "full" });

// Parse an export the way a spreadsheet does: no knowledge of fiscode, just cells.
const cells = (csv: string): string[][] => Papa.parse<string[]>(stripBom(csv)).data;

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

// Every table of an export in file order: its `# Title` line and, per row,
// the id and the deleted_at cell.
const tables = (csv: string): Array<{ title: string; rows: Array<[string, string]> }> => {
  const out: Array<{ title: string; rows: Array<[string, string]> }> = [];
  let title = "";
  let header: string[] = [];
  for (const row of cells(csv)) {
    const first = row[0] ?? "";
    if (first.startsWith("#")) title = first;
    else if (first === "record_type") {
      header = row;
      out.push({ title, rows: [] });
    } else if (first !== "") {
      const cell = (name: string) => row[header.indexOf(name)] ?? "";
      out.at(-1)!.rows.push([cell("id"), cell("deleted_at")]);
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
  placedInServiceDate: null,
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
  ...over,
});

// Zero-padded so id order is list order: the export sorts same-date rows by id.
const id = (i: number): string => `in_${String(i).padStart(2, "0")}`;

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
    const { bundle, validationErrors } = parseCsv(first);
    expect(validationErrors).toEqual([]);
    expect(bundle).toEqual(exampleBundle());
    expect(exportFull(bundle)).toBe(first);
  });

  it("two exports at different clock times are the same bytes (no timestamp in the file)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-03-01T08:00:00.000Z"));
      const first = exportFull(exampleBundle());
      vi.setSystemTime(new Date("2027-11-30T23:59:59.000Z"));
      expect(exportFull(exampleBundle())).toBe(first);
      expect(first).not.toMatch(/exported/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the bytes do not depend on the order rows arrive in", () => {
    const shuffled = exampleBundle();
    shuffled.income.reverse();
    shuffled.expenses.reverse();
    shuffled.clients.reverse();
    shuffled.mileage.reverse();
    expect(exportFull(shuffled)).toBe(exportFull(exampleBundle()));
  });

  it("orders rows by date, then by id for rows on the same date", () => {
    const csv = exportFull(
      withIncome(
        income({ id: "in_b", date: "2026-02-01" }),
        income({ id: "in_c", date: "2026-01-01" }),
        income({ id: "in_a", date: "2026-02-01" }),
      ),
    );
    expect(section(csv, "income").map((r) => r.id)).toEqual(["in_c", "in_a", "in_b"]);
  });

  it("a soft-deleted row is exported with deleted_at and comes back deleted", () => {
    const deletedAt = "2026-08-01T09:30:00.000Z";
    const bundle = withExpenses(
      expense({ id: "ex_live", amountCents: 1000 }),
      expense({ id: "ex_gone", amountCents: 2500, deletedAt }),
    );
    const first = exportFull(bundle);
    // Its own table, after the live one, titled so nobody adds it up.
    expect(tables(first)).toEqual([
      { title: "# Expenses", rows: [["ex_live", ""]] },
      { title: "# Expenses (deleted - not part of your books)", rows: [["ex_gone", deletedAt]] },
    ]);
    // The title is one cell: nothing spills into column B.
    expect(
      cells(first)
        .filter((r) => (r[0] ?? "").startsWith("# "))
        .map((r) => r.length),
    ).toEqual([1, 1, 1, 1]);
    const { bundle: round, validationErrors } = parseCsv(first);
    expect(validationErrors).toEqual([]);
    expect(round.expenses.find((r) => r.id === "ex_gone")?.deletedAt).toBe(deletedAt);
    expect(round.expenses.find((r) => r.id === "ex_live")?.deletedAt).toBeNull();
    expect(exportFull(round)).toBe(first);
  });

  // A bundle with a live and a deleted row of every record type that can be deleted.
  const halfDeleted = (): Bundle => {
    const gone = "2026-09-09T09:09:09.000Z";
    const b = exampleBundle();
    const twin = <T extends { id: string; deletedAt: string | null }>(rows: T[]): T[] =>
      rows.flatMap((r) => [r, { ...r, id: `${r.id}_gone`, deletedAt: gone }]);
    return {
      ...b,
      entities: twin(b.entities),
      spouses: twin(b.spouses),
      clients: twin(b.clients),
      income: twin(b.income),
      timeEntries: twin(b.timeEntries),
      vehicles: twin(b.vehicles),
      mileage: twin(b.mileage),
      homeOffice: twin(b.homeOffice),
      expenses: twin(b.expenses),
      retirementContributions: twin(b.retirementContributions),
    };
  };

  it("no live table of the full file holds a deleted row, and every deleted row is kept", () => {
    const bundle = halfDeleted();
    const first = exportFull(bundle);
    const all = tables(first);
    const isDeletedTable = (t: { title: string }) => t.title.endsWith(DELETED_TITLE_SUFFIX);
    expect(all.filter(isDeletedTable)).toHaveLength(10);
    for (const table of all) {
      for (const [, deletedAt] of table.rows) {
        expect(deletedAt !== "", table.title).toBe(isDeletedTable(table));
      }
    }
    // Each deleted table sits right after the live table of the same record type.
    all.forEach((table, i) => {
      if (isDeletedTable(table)) {
        expect(all[i - 1]!.title + DELETED_TITLE_SUFFIX).toBe(table.title);
      }
    });
    const { bundle: round, validationErrors } = parseCsv(first);
    expect(validationErrors).toEqual([]);
    expect(round.expenses.filter((r) => r.deletedAt !== null)).toHaveLength(3);
    expect(round.income).toHaveLength(bundle.income.length);
    expect(exportFull(round)).toBe(first);
  });

  it("the yearly file leaves deleted rows out, so its amounts add up to what the app shows", () => {
    const bundle = halfDeleted();
    const yearly = exportBundle(bundle, { scope: "yearly", year: 2026 });
    expect(yearly).not.toContain(DELETED_TITLE_SUFFIX);
    expect(yearly).not.toContain("_gone");
    for (const table of tables(yearly)) {
      expect(table.rows.every(([, deletedAt]) => deletedAt === "")).toBe(true);
    }
    const cents = (rows: Array<Record<string, string>>) =>
      rows.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0);
    expect(cents(section(yearly, "expense"))).toBe(89_999 + 12_000 + 25_000);
    expect(cents(section(yearly, "income"))).toBe(1_000_000 + 350_000 + 625_000);
  });

  it("a live row in the yearly file still names a client that was deleted", () => {
    const bundle = exampleBundle();
    bundle.clients = bundle.clients.map((c) => ({ ...c, deletedAt: "2026-09-09T09:09:09.000Z" }));
    const yearly = exportBundle(bundle, { scope: "yearly", year: 2026 });
    expect(section(yearly, "client")).toEqual([]);
    expect(section(yearly, "income")[0]!.client_name).toBe("Stable Commission Co");
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
      // A byte-order mark inside a note is the user's text, not a file marker.
      `a\n${BOM}b`,
      `${BOM}starts with one`,
    ];
    const bundle = withIncome(
      ...awkward.map((text, i) => income({ id: id(i), description: text, notes: text })),
    );
    const first = exportFull(bundle);
    const { bundle: round, validationErrors } = parseCsv(first);
    expect(validationErrors).toEqual([]);
    expect(round).toEqual(bundle);
    expect(exportFull(round)).toBe(first);
  });

  it("holds for money edge values, including negatives and single cents", () => {
    const amounts = [0, 1, 5, 10, 99, 100, 101, 89_999, 123_456_789, -1, -50, -12_345];
    const bundle = withIncome(...amounts.map((c, i) => income({ id: id(i), amountCents: c })));
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

  it("opens with two comment lines: what the file is, and how to read it", () => {
    const lines = stripBom(csv).split("\r\n");
    expect(lines.slice(0, 3)).toEqual([
      "# fiscode export (schema: v6; scope: full)",
      "# Money is in dollars. Dates are YYYY-MM-DD. Import this file at https://fiscode.app to restore it.",
      "",
    ]);
    const yearly = exportBundle(exampleBundle(), { scope: "yearly", year: 2026 });
    expect(yearly).toContain("# fiscode export (schema: v6; scope: yearly; year: 2026)");
    expect(parseCsv(yearly).provenance).toEqual({ schema: "v6", scope: "yearly", year: 2026 });
    expect(parseCsv(csv).provenance).toEqual({ schema: "v6", scope: "full" });
  });

  it("gives ambiguous stored names a table-specific header", () => {
    const headerOf = (recordType: string) => Object.keys(section(csv, recordType)[0]!);
    expect(headerOf("entity")).toContain("entity_type");
    expect(headerOf("client")).toContain("client_type");
    expect(headerOf("income")).toContain("income_kind");
    expect(headerOf("vehicle")).toEqual(expect.arrayContaining(["model_year", "deduction_method"]));
    expect(headerOf("home_office")).toContain("deduction_method");
    for (const rt of ["entity", "client", "income", "vehicle", "home_office"]) {
      for (const bare of ["type", "kind", "year", "method"]) {
        expect(headerOf(rt)).not.toContain(bare);
      }
    }
  });

  it("gives each record type its own titled table, in a fixed order", () => {
    const titles = cells(csv)
      .map((r) => r[0] ?? "")
      .filter((c) => c.startsWith("# ") && !c.includes(":") && !c.includes("."));
    expect(titles).toEqual([
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
      "income_kind",
      "income_kind_label",
      "description",
      "notes",
      "id",
      "client_id",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);
    // No table drags along another record type's columns. The widest is the profile (19 since
    // v5 added prior_year_not_filed).
    expect(Math.max(...header.map((h) => h.length))).toBeLessThanOrEqual(19);
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
    expect(section(csv, "client")[1]!.default_hourly_rate).toBe("15000.00");
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
    expect(section(csv, "entity")[0]!.entity_type_label).toBe("Sole proprietor");
    expect(section(csv, "expense")[1]!.category_label).toBe("Software & subscriptions");
    expect(section(csv, "vehicle")[0]!.deduction_method_label).toBe("Standard mileage");
    expect(section(csv, "home_office")[0]!.deduction_method_label).toBe("Simplified");
    expect(section(csv, "income")[0]!.income_kind_label).toBe("Recurring");
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

  it("`=SUM(A1:A9)` is written as text and read back as the exact original string", () => {
    const formula = "=SUM(A1:A9)";
    const csv = exportFull(withIncome(income({ description: formula })));
    // No cell in the file starts with `=`, so no spreadsheet evaluates it.
    expect(
      cells(csv)
        .flat()
        .filter((c) => c.startsWith("=")),
    ).toEqual([]);
    expect(section(csv, "income")[0]!.description).toBe("'=SUM(A1:A9)");
    expect(parseCsv(csv).bundle.income[0]!.description).toBe(formula);
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
    expect(provenance.schema).toBe("v6");
    expect(bundle.profile?.id).toBe("profile");
  });

  it("round-trips `Café — ✓` exactly, as UTF-8 bytes after the BOM", () => {
    const text = "Café — ✓";
    const bundle = withIncome(income({ description: text }));
    const csv = exportFull(bundle);
    const bytes = new TextEncoder().encode(csv);
    expect(new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes)).toContain(text);
    expect(parseCsv(csv).bundle.income[0]!.description).toBe(text);
  });

  it("imports a file without a BOM, and an old file with one added", () => {
    const noBom = stripBom(exportFull(exampleBundle()));
    expect(noBom.startsWith("#")).toBe(true);
    expect(parseCsv(noBom).bundle).toEqual(exampleBundle());
    const v1WithBom = parseCsv(BOM + V1_FIXTURE);
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
    const padded = stripBom(first)
      .split("\r\n")
      .map((line) => line + ",,,")
      .join("\r\n");
    const { bundle, provenance, validationErrors } = parseCsv(padded);
    expect(validationErrors).toEqual([]);
    expect(bundle).toEqual(exampleBundle());
    expect(provenance.scope).toBe("full");
    expect(provenance.schema).toBe("v6");
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

  it("reads a header typed in another case", () => {
    const { bundle, validationErrors } = parseCsv(
      "Record_Type,Date,Amount,ID\r\nincome,2026-01-01,5.00,in_1\r\n",
    );
    expect(validationErrors).toEqual([]);
    expect(bundle.income[0]!.amountCents).toBe(500);
  });

  it("reads the earlier v2 header default_rate as well as default_hourly_rate", () => {
    for (const name of ["default_rate", "default_hourly_rate", "default_rate_cents"]) {
      const value = name.endsWith("_cents") ? "15000" : "150.00";
      const { bundle, validationErrors } = parseCsv(
        `record_type,name,${name},id\r\nclient,Acme,${value},cl_1\r\n`,
      );
      expect(validationErrors).toEqual([]);
      expect(bundle.clients[0]!.defaultRateCents).toBe(15_000);
    }
  });
});

describe("import errors a person can act on", () => {
  it("reports the spreadsheet row and the record type of a bad cell", () => {
    const csv = exportFull(exampleBundle());
    const rows = cells(csv);
    // The first expense row, as a spreadsheet numbers it (from 1).
    const sheetRow = rows.findIndex((r) => r[0] === "expense") + 1;
    expect(sheetRow).toBeGreaterThan(40);
    const { validationErrors } = parseCsv(csv.replace("899.99", "899.999"));
    expect(validationErrors).toHaveLength(1);
    const error = validationErrors[0]!;
    expect(error.line).toBe(sheetRow);
    expect(error.recordType).toBe("expense");
    expect(describeImportError(error)).toBe(
      `Row ${sheetRow} (expense): amount: Expected a dollar amount with at most two decimals, like 1234.56, got "899.999"`,
    );
  });

  it("counts a cell with line breaks as one row, like a spreadsheet does", () => {
    const csv = exportFull(
      withIncome(
        income({ id: id(1), notes: "one\ntwo\nthree" }),
        income({ id: id(2), date: "2026-01-16" }),
      ),
    );
    // Rows: 2 comment lines, blank, title, header, in_01, in_02.
    const { validationErrors } = parseCsv(csv.replace("2026-01-16", "1/16/2026"));
    expect(validationErrors.map((e) => e.line)).toEqual([7]);
  });

  it("tells the user how to fix a date a spreadsheet rewrote", () => {
    const csv = exportFull(withIncome(income({})));
    const { validationErrors } = parseCsv(csv.replace("2026-01-15", "1/15/2026"));
    expect(describeImportError(validationErrors[0]!)).toBe(
      'Row 6 (income): date: Expected a date as YYYY-MM-DD, got "1/15/2026". In a spreadsheet, format the column as yyyy-mm-dd before saving',
    );
  });

  it("rejects a date that has the right shape but is not a real day", () => {
    const csv = exportFull(withIncome(income({})));
    for (const bad of ["2026-13-45", "2026-02-30", "2026-00-10", "2025-02-29"]) {
      const { validationErrors } = parseCsv(csv.replace("2026-01-15", bad));
      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]!.message).toMatch(/date: Expected a date as YYYY-MM-DD/);
    }
    expect(parseCsv(csv.replace("2026-01-15", "2024-02-29")).validationErrors).toEqual([]);
  });

  it("says what a yes / no cell should hold", () => {
    const csv = exportFull(withExpenses(expense({ flagForSection179: true })));
    for (const bad of ["TRUE", "true", "Y"]) {
      const { validationErrors } = parseCsv(csv.replace(",yes,", `,${bad},`));
      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]!.message).toBe(
        `flag_for_section_179: Expected yes or no, got "${bad}"`,
      );
    }
    expect(parseCsv(csv.replace(",yes,", ",YES,")).bundle.expenses[0]!.flagForSection179).toBe(
      true,
    );
  });

  it("shows the first few errors and counts the rest", () => {
    const csv = exportFull(
      withIncome(...[1, 2, 3, 4, 5, 6, 7].map((i) => income({ id: id(i) }))),
    ).replaceAll("2026-01-15", "1/15/2026");
    const { validationErrors } = parseCsv(csv);
    expect(validationErrors).toHaveLength(7);
    const lines = describeImportErrors(validationErrors, 3);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Row 6 \(income\): date: /);
    expect(lines[3]).toBe("…and 4 more.");
  });

  it("rejects a row whose dollar and cents columns disagree, in either order", () => {
    for (const header of ["amount,amount_cents", "amount_cents,amount"]) {
      const values = header.startsWith("amount,") ? "5.00,999" : "999,5.00";
      const { bundle, validationErrors } = parseCsv(
        `record_type,date,${header},id\r\nincome,2026-01-01,${values},in_1\r\n`,
      );
      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]!.message).toMatch(/disagrees with amount/);
      expect(bundle.income).toEqual([]);
    }
  });

  it("accepts dollar and cents columns that agree, or where one is empty", () => {
    for (const values of ["5.00,500", "5.00,", ",500"]) {
      const { bundle, validationErrors } = parseCsv(
        `record_type,date,amount,amount_cents,id\r\nincome,2026-01-01,${values},in_1\r\n`,
      );
      expect(validationErrors).toEqual([]);
      expect(bundle.income[0]!.amountCents).toBe(500);
    }
  });

  it("refuses a file marked with a schema this build does not know", () => {
    const csv = exportFull(exampleBundle()).replace("schema: v6", "schema: v9");
    const { bundle, validationErrors } = parseCsv(csv);
    expect(bundle).toEqual(emptyBundle());
    expect(validationErrors).toHaveLength(1);
    expect(describeImportError(validationErrors[0]!)).toMatch(
      /schema v9.*written by a newer fiscode/,
    );
  });

  it("still reads a file with no schema marker at all", () => {
    const csv = stripBom(exportFull(exampleBundle())).split("\r\n").slice(2).join("\r\n");
    expect(csv).not.toContain("schema");
    expect(parseCsv(csv).validationErrors).toEqual([]);
  });
});

describe("the export refuses what it could not read back", () => {
  it("names the row when a stored date is not YYYY-MM-DD", () => {
    expect(() => exportFull(withIncome(income({ id: "in_bad", date: "1/15/2026" })))).toThrow(
      'Cannot export income row in_bad: date: "1/15/2026" is not a date written as YYYY-MM-DD',
    );
  });

  it("names the row when stored cents are not a whole number", () => {
    expect(() => exportFull(withIncome(income({ id: "in_bad", amountCents: 12.5 })))).toThrow(
      'Cannot export income row in_bad: amount: "12.5" is not a whole number',
    );
  });
});

describe("no stored field is left out", () => {
  // Every field of every record type filled with a distinct value, so a column
  // dropped from a section, or two columns swapped, changes the result.
  const everyField = (): Bundle => {
    let n = 0;
    const s = (name: string) => `${name} ${++n}`;
    const cents = () => 100_000 + ++n;
    const stamp = () => `2026-03-${String(10 + (++n % 15)).padStart(2, "0")}T10:00:00.000Z`;
    const tail = () => ({ createdAt: stamp(), updatedAt: stamp(), deletedAt: stamp() });
    return {
      profile: {
        id: "profile",
        filingStatus: "hoh",
        state: "CA",
        seStartDate: "2023-05-06",
        dependents: 3,
        tracksRoth: true,
        usesRetirement: true,
        quarterlyMethod: "even",
        prepLeadDays: 21,
        priorYearTotalTaxCents: 9_876_54,
        priorYearAgiCents: 160_000_00,
        priorYearStateTaxCents: 2_345_67,
        priorYearFiguresYear: 2025,
        priorYearNotFiled: false,
        createdAt: stamp(),
        updatedAt: stamp(),
      },
      entities: [
        {
          id: "ent_1",
          type: "single_member_llc",
          startDate: "2023-05-06",
          endDate: "2024-06-07",
          notes: s("entity notes"),
          ...tail(),
        },
      ],
      spouses: [
        {
          id: "sp_1",
          startDate: "2023-01-02",
          endDate: "2024-03-04",
          annualW2WagesCents: cents(),
          annualFederalWithholdingCents: cents(),
          annualStateWithholdingCents: cents(),
          notes: s("spouse notes"),
          ...tail(),
        },
      ],
      clients: [
        {
          id: "cl_1",
          name: s("client name"),
          type: s("client type"),
          notes: s("client notes"),
          defaultRateCents: cents(),
          defaultCommissionRate: 725,
          ...tail(),
        },
      ],
      income: [
        {
          id: "in_1",
          date: "2026-01-02",
          clientId: "cl_1",
          amountCents: cents(),
          sourceType: "w2",
          kind: "bonus",
          description: s("income description"),
          notes: s("income notes"),
          ...tail(),
        },
      ],
      timeEntries: [
        {
          id: "te_1",
          date: "2026-01-03",
          clientId: "cl_1",
          minutes: 50,
          description: s("time description"),
          notes: s("time notes"),
          ...tail(),
        },
      ],
      vehicles: [
        {
          id: "v_1",
          make: s("make"),
          model: s("model"),
          year: 2019,
          mpg: 31,
          method: "actual",
          inServiceDate: "2019-08-09",
          notes: s("vehicle notes"),
          ...tail(),
        },
      ],
      mileage: [
        {
          id: "mi_1",
          date: "2026-01-04",
          vehicleId: "v_1",
          businessMiles: 77,
          purpose: s("purpose"),
          notes: s("mileage notes"),
          ...tail(),
        },
      ],
      homeOffice: [
        {
          id: "ho_1",
          startDate: "2023-02-03",
          endDate: "2025-04-05",
          method: "actual",
          officeSqft: 140,
          homeSqft: 1900,
          monthlyRentMortgageCents: cents(),
          monthlyUtilitiesCents: cents(),
          monthlyInsuranceCents: cents(),
          regularExclusiveAck: true,
          notes: s("home office notes"),
          ...tail(),
        },
      ],
      expenses: [
        {
          id: "ex_1",
          date: "2026-01-05",
          amountCents: cents(),
          category: "meals",
          clientId: "cl_1",
          description: s("expense description"),
          reason: s("reason"),
          notes: s("expense notes"),
          flagForSection179: true,
          startupExpense: true,
          placedInServiceDate: "2026-02-01",
          ...tail(),
        },
      ],
      retirementContributions: [
        {
          id: "ret_1",
          date: "2026-01-06",
          account: "sep",
          amountCents: cents(),
          notes: s("retirement notes"),
          ...tail(),
        },
      ],
      w2Jobs: [
        {
          id: "w2_1",
          taxYear: 2026,
          employer: s("employer"),
          startDate: "2026-01-02",
          endDate: "2026-02-18",
          wagesCents: cents(),
          federalWithholdingCents: cents(),
          ssWagesCents: cents(),
          ssTaxWithheldCents: cents(),
          medicareWagesCents: cents(),
          ssTipsCents: cents(),
          stateWagesCents: cents(),
          stateWithholdingCents: cents(),
          notes: s("w2 notes"),
          ...tail(),
        },
      ],
      estimatedPayments: [
        {
          id: "ep_1",
          date: "2026-04-15",
          amountCents: cents(),
          jurisdiction: "UT",
          taxYear: 2026,
          appliedQuarter: 1,
          notes: s("payment notes"),
          ...tail(),
        },
      ],
      documentFolders: [
        {
          id: "df_1",
          parentId: "df_root",
          name: s("folder"),
          taxYear: 2026,
          sortOrder: 3,
          defaultKey: "expenses",
          ...tail(),
        },
      ],
      documents: [
        {
          id: "doc_1",
          folderId: "df_1",
          name: s("doc.pdf"),
          mime: "application/pdf",
          sizeBytes: 2048,
          sha256: "b".repeat(64),
          addedAt: stamp(),
          notes: s("doc notes"),
          ...tail(),
        },
      ],
      documentLinks: [
        {
          id: "dl_1",
          documentId: "doc_1",
          recordType: "expense",
          recordId: "ex_1",
          ...tail(),
        },
      ],
      history: [
        {
          id: "h_1",
          entity: "expense",
          entityId: "ex_1",
          op: "update",
          beforeJson: '{"id":"ex_1","description":"a, \\"b\\"","amountCents":1}',
          afterJson: '{"id":"ex_1","description":"=c","amountCents":2}',
          at: stamp(),
        },
      ],
    };
  };

  it("a bundle with every field filled round-trips in state and in bytes", () => {
    const bundle = everyField();
    const first = exportFull(bundle);
    const { bundle: round, validationErrors } = parseCsv(first);
    expect(validationErrors).toEqual([]);
    expect(round).toEqual(bundle);
    expect(exportFull(round)).toBe(first);
    // And no stored cell of that export is empty, so nothing was skipped.
    for (const s of SECTIONS) {
      const row = section(first, s.recordType)[0]!;
      for (const c of s.columns.filter(isStored)) {
        expect(row[c.name], `${s.recordType}.${c.name}`).not.toBe("");
      }
    }
  });

  it("every key a record type emits is a stored column of its section", () => {
    const rows = bundleToRows(everyField());
    expect(new Set(rows.map((r) => r.record_type)).size).toBe(SECTIONS.length);
    for (const row of rows) {
      const stored = new Set(
        SECTIONS.find((s) => s.recordType === row.record_type)!
          .columns.filter(isStored)
          .map((c) => c.key as string),
      );
      const emitted = Object.keys(row).filter((key) => row[key] !== "");
      expect(emitted.filter((key) => !stored.has(key))).toEqual([]);
    }
  });

  it("history rows keep their JSON verbatim and come last, only in the full file", () => {
    const bundle = everyField();
    const first = exportFull(bundle);
    expect(
      stripBom(first)
        .split("\r\n")
        .filter((l) => l.startsWith("# "))
        .at(-1),
    ).toBe("# History");
    expect(parseCsv(first).bundle.history).toEqual(bundle.history);
    const yearly = exportBundle(bundle, { scope: "yearly", year: 2026 });
    expect(yearly).not.toContain("# History");
  });

  it("rejects a history cell a spreadsheet has cut short, instead of storing broken JSON", () => {
    // Spreadsheets cap a cell near 32,000 characters and drop the rest silently.
    const long = JSON.stringify({ id: "ex_1", notes: "x".repeat(40_000) });
    const entry = {
      id: "h_1",
      entity: "expense",
      entityId: "ex_1",
      op: "update",
      beforeJson: long,
      afterJson: '{"id":"ex_1"}',
      at: "2026-06-04T12:00:00.000Z",
    };
    const whole = exportFull({ ...emptyBundle(), history: [entry] });
    // Compared with === so a failure does not print 40,000 characters.
    expect(parseCsv(whole).bundle.history[0]!.beforeJson === long).toBe(true);
    const CUT_SHORT_MESSAGE =
      "Row 6 (history): before_json: This is not complete JSON. A spreadsheet probably cut the cell short when the file was saved. Import the original download instead";

    // The same file after a spreadsheet kept only the first 32,000 characters.
    const cut = exportFull({
      ...emptyBundle(),
      history: [{ ...entry, beforeJson: long.slice(0, 32_000) }],
    });
    const { bundle, validationErrors } = parseCsv(cut);
    expect(bundle.history.length).toBe(0);
    expect(validationErrors.length).toBe(1);
    expect(describeImportError(validationErrors[0]!) === CUT_SHORT_MESSAGE).toBe(true);
  });

  it("accepts a history row with one JSON cell empty", () => {
    const entry = {
      id: "h_1",
      entity: "client",
      entityId: "cl_1",
      op: "insert",
      beforeJson: null,
      afterJson: '{"id":"cl_1"}',
      at: "2026-06-04T12:00:00.000Z",
    };
    const { bundle, validationErrors } = parseCsv(
      exportFull({ ...emptyBundle(), history: [entry] }),
    );
    expect(validationErrors).toEqual([]);
    expect(bundle.history).toEqual([entry]);
  });

  it("an income row still names its client after the client is deleted", () => {
    const bundle = everyField();
    expect(bundle.clients[0]!.deletedAt).not.toBeNull();
    const row = section(exportFull(bundle), "income")[0]!;
    expect(row.client_name).toBe(bundle.clients[0]!.name);
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
    // Same day, same year: the two buttons must never save over each other.
    expect(exportFileName({ scope: "full" }, "2026-11-18")).not.toBe(
      exportFileName({ scope: "yearly", year: 2026 }, "2026-11-18"),
    );
  });
});
