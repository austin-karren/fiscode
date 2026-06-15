import { describe, expect, it } from "vitest";
import { parseCsv } from "./import.ts";
import { CSV_COLUMNS } from "./schema.ts";

const header = CSV_COLUMNS.join(",") + "\n";

// Build a CSV row from a sparse partial set of columns. Missing columns are
// rendered as empty fields.
const buildRow = (fields: Record<string, string>): string =>
  CSV_COLUMNS.map((c) => fields[c] ?? "").join(",");

const csvOf = (rows: Array<Record<string, string>>): string =>
  header + rows.map(buildRow).join("\n") + "\n";

describe("parseCsv validation", () => {
  it("captures a validation error for an unknown record_type", () => {
    const csv = csvOf([{ record_type: "not_a_record", id: "x" }]);
    const { bundle, validationErrors } = parseCsv(csv);
    expect(validationErrors.length).toBeGreaterThan(0);
    expect(validationErrors[0]!.message).toMatch(/record_type/);
    // Nothing got into the bundle.
    expect(bundle.income).toEqual([]);
  });

  it("captures a validation error for an unknown tracks_roth value", () => {
    // optBool requires "0" | "1" | "". "true" → error.
    const csv = csvOf([{ record_type: "profile", id: "p", tracks_roth: "true" }]);
    const { validationErrors } = parseCsv(csv);
    expect(validationErrors.length).toBeGreaterThan(0);
    expect(validationErrors[0]!.message).toMatch(/tracks_roth/);
  });

  it("rejects a profile missing seStartDate (loud, not silent)", () => {
    const csv = csvOf([
      {
        record_type: "profile",
        id: "p",
        filing_status: "mfj",
        state: "UT",
        // se_start_date intentionally absent → empty string
        dependents: "0",
        tracks_roth: "0",
        uses_retirement: "0",
        quarterly_method: "annualized",
        prep_lead_days: "14",
      },
    ]);
    const { validationErrors } = parseCsv(csv);
    expect(validationErrors.some((e) => /se_start_date is required/.test(e.message))).toBe(true);
  });

  it("rejects non-numeric strings in numeric columns (strict)", () => {
    const csv = csvOf([
      {
        record_type: "income",
        id: "in_1",
        date: "2026-01-01",
        amount_cents: "not-a-number",
        source_type: "1099",
        kind: "recurring",
      },
    ]);
    const { bundle, validationErrors } = parseCsv(csv);
    expect(validationErrors.length).toBe(1);
    expect(validationErrors[0]!.message).toMatch(/amount_cents.*integer/);
    // The bad row is rejected outright — nothing lands in the bundle.
    expect(bundle.income).toEqual([]);
  });

  it("rejects decimals where integers are expected", () => {
    const csv = csvOf([
      {
        record_type: "expense",
        id: "ex_1",
        date: "2026-01-01",
        amount_cents: "1250.5",
        category: "supplies",
      },
    ]);
    const { validationErrors } = parseCsv(csv);
    expect(validationErrors.length).toBe(1);
    expect(validationErrors[0]!.message).toMatch(/amount_cents/);
  });

  it("treats whitespace-only numeric cells as blank (Excel-friendly)", () => {
    // Whitespace-only trims to empty → schema accepts → mapped as 0/null.
    const csv = csvOf([
      {
        record_type: "mileage",
        id: "mi_1",
        date: "2026-01-01",
        business_miles: "   ",
      },
    ]);
    const { bundle, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);
    expect(bundle.mileage[0]!.businessMiles).toBe(0);
  });

  it("blank optional columns survive as null/empty, not undefined", () => {
    const csv = csvOf([
      {
        record_type: "expense",
        id: "ex_1",
        date: "2026-02-15",
        amount_cents: "12500",
        category: "supplies",
      },
    ]);
    const { bundle, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);
    const ex = bundle.expenses[0]!;
    expect(ex.amountCents).toBe(12_500);
    expect(ex.clientId).toBeNull();
    expect(ex.description).toBeNull();
    expect(ex.flagForSection179).toBe(false);
  });

  it("a single-row file with a bad row still returns a parseable empty bundle", () => {
    const csv = csvOf([{ record_type: "??", id: "x" }]);
    const { bundle, validationErrors } = parseCsv(csv);
    expect(validationErrors.length).toBeGreaterThan(0);
    expect(bundle.profile).toBeUndefined();
    expect(bundle.income).toEqual([]);
    expect(bundle.expenses).toEqual([]);
  });

  it("parses provenance headers (exported / scope / year)", () => {
    const csv =
      "# fiscode export\n" +
      "# scope: yearly\n" +
      "# year: 2026\n" +
      "# exported: 2026-06-01T00:00:00.000Z\n" +
      header +
      buildRow({ record_type: "client", id: "cl_1", name: "Acme" });
    const { provenance } = parseCsv(csv);
    expect(provenance.scope).toBe("yearly");
    expect(provenance.year).toBe(2026);
    expect(provenance.exportedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("ignores unknown provenance header keys without erroring", () => {
    const csv =
      "# fiscode export\n" +
      "# something-new: hello\n" +
      "# scope: full\n" +
      header +
      buildRow({ record_type: "client", id: "cl_1", name: "Acme" });
    const { provenance, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);
    expect(provenance.scope).toBe("full");
  });
});
