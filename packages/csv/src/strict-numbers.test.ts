import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exampleBundle } from "./example.ts";
import { exportBundle } from "./export.ts";
import { parseCsv } from "./import.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const V1_FIXTURE = readFileSync(join(HERE, "fixtures", "v1-example.csv"), "utf8");
const DOCS_EXAMPLE = readFileSync(
  join(HERE, "..", "..", "..", "apps", "fumadocs", "public", "downloads", "example.csv"),
  "utf8",
);

// The v1 example's first trip is 47 miles and its first income is 1000000 cents.
const v1WithMiles = (cell: string) =>
  V1_FIXTURE.replace(",47,Client visit", `,${cell},Client visit`);
const v1WithIncomeCents = (cell: string) =>
  V1_FIXTURE.replace(",1000000,1099,recurring", `,${cell},1099,recurring`);

const firstTrip = (csv: string) => {
  const { bundle, validationErrors } = parseCsv(csv);
  return { errors: validationErrors.length, miles: bundle.mileage[0]?.businessMiles };
};

describe("whole-number cells read plain digits only", () => {
  it.each(["1e3", "0x10", "4.0", "+5", "1,000", "١٢", "99999999999999999999", "=5", "'5"])(
    "rejects %j in a v1 business_miles cell",
    (cell) => {
      expect(firstTrip(v1WithMiles(cell)).errors).toBe(1);
    },
  );

  it.each(["1e3", "0x10", "12.5", "9007199254740992"])(
    "rejects %j in a v1 amount_cents cell",
    (cell) => {
      expect(parseCsv(v1WithIncomeCents(cell)).validationErrors).toHaveLength(1);
    },
  );

  it("still reads a plain number, padded with spaces", () => {
    expect(firstTrip(v1WithMiles(" 7 "))).toEqual({ errors: 0, miles: 7 });
  });

  it("reads a cell of only spaces as blank: null in a nullable column", () => {
    const { bundle, validationErrors } = parseCsv(
      V1_FIXTURE.replace("RAV4,2022,28,", "RAV4,  ,28,"),
    );
    expect(validationErrors).toEqual([]);
    expect(bundle.vehicles[0]!.year).toBeNull();
  });

  it("reads a cell of only spaces in a required column the same as an empty cell", () => {
    expect(firstTrip(v1WithMiles("  "))).toEqual(firstTrip(v1WithMiles("")));
  });

  it("rejects the same junk in a v2 file", () => {
    const csv = exportBundle(exampleBundle(), { scope: "full" });
    const bad = csv.replace(/^(mileage,[^\n]*?),47,/m, "$1,1e3,");
    expect(bad).not.toBe(csv);
    expect(parseCsv(bad).validationErrors).toHaveLength(1);
  });
});

describe("Restore never refuses a value the app's own export writes", () => {
  it("brings back negative, zero and very large values exactly", () => {
    const b = exampleBundle();
    b.expenses[0]!.amountCents = -1_230;
    b.expenses[1]!.amountCents = 0;
    b.income[0]!.amountCents = 100_000_000_00;
    b.income[1]!.amountCents = 9_007_199_254_740_991;
    b.mileage[0]!.businessMiles = -5;
    const csv = exportBundle(b, { scope: "full" });
    const { bundle, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);
    expect(bundle.expenses.map((e) => e.amountCents).slice(0, 2)).toEqual([-1_230, 0]);
    expect(exportBundle(bundle, { scope: "full" })).toBe(csv);
  });

  it("restores the docs example.csv with no errors and re-exports the same bytes", () => {
    const { bundle, validationErrors } = parseCsv(DOCS_EXAMPLE);
    expect(validationErrors).toEqual([]);
    expect(exportBundle(bundle, { scope: "full" })).toBe(DOCS_EXAMPLE);
  });

  it("dollar cells still take what a spreadsheet saves back", () => {
    const csv = exportBundle(exampleBundle(), { scope: "full" });
    const edited = csv.replace(/^(expense,[^\n]*?),120\.00,/m, (_, head) => `${head},$120,`);
    expect(edited).not.toBe(csv);
    expect(parseCsv(edited).validationErrors).toEqual([]);
  });
});
