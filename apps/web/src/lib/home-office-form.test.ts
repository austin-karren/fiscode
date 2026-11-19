import { describe, expect, it } from "vitest";

import {
  AREA_MESSAGE,
  SECOND_SIMPLIFIED_MESSAGE,
  officeAreaError,
  overlapsSimplified,
} from "./home-office-form";

const FIXED = "2026-06-04T12:00:00.000Z";
const config = (
  id: string,
  method: "simplified" | "actual",
  startDate: string,
  endDate: string | null,
  deletedAt: string | null = null,
) => ({ id, method, startDate, endDate, deletedAt, createdAt: FIXED, updatedAt: FIXED });

describe("officeAreaError", () => {
  it("refuses an office larger than the home, in one short line", () => {
    expect(officeAreaError("5000", "100")).toBe(AREA_MESSAGE);
    expect(AREA_MESSAGE.length).toBeLessThanOrEqual(24);
  });

  it("accepts an office the size of the home or smaller, and blank or unreadable input", () => {
    expect(officeAreaError("96", "1220")).toBeUndefined();
    expect(officeAreaError("1220", "1220")).toBeUndefined();
    expect(officeAreaError("", "1220")).toBeUndefined();
    expect(officeAreaError("96", "")).toBeUndefined();
    // Not a whole number: the field's own validator says so.
    expect(officeAreaError("abc", "100")).toBeUndefined();
  });
});

describe("overlapsSimplified", () => {
  const rows = [config("ho_1", "simplified", "2026-01-01", "2026-06-30")];

  it("blocks a second simplified config in a year that already has one", () => {
    expect(
      overlapsSimplified(rows, { method: "simplified", startDate: "2026-07-01", endDate: null }),
    ).toBe(true);
    expect(SECOND_SIMPLIFIED_MESSAGE.length).toBeLessThanOrEqual(32);
  });

  it("allows simplified in another year, and actual in any year", () => {
    expect(
      overlapsSimplified(rows, { method: "simplified", startDate: "2027-01-01", endDate: null }),
    ).toBe(false);
    expect(
      overlapsSimplified(rows, { method: "actual", startDate: "2026-07-01", endDate: null }),
    ).toBe(false);
  });

  it("ends an open config where the next one starts, as the engine does (a move)", () => {
    const open = [config("ho_2", "simplified", "2025-03-01", null)];
    // The new home from Jan 1, 2027 supersedes it: it covers 2025 and 2026 only.
    expect(
      overlapsSimplified(open, { method: "simplified", startDate: "2027-01-01", endDate: null }),
    ).toBe(false);
    // A move mid-2026 leaves two simplified homes in 2026.
    expect(
      overlapsSimplified(open, { method: "simplified", startDate: "2026-07-01", endDate: null }),
    ).toBe(true);
  });

  it("ignores the row being edited, and deleted rows", () => {
    expect(
      overlapsSimplified(rows, {
        id: "ho_1",
        method: "simplified",
        startDate: "2026-02-01",
        endDate: null,
      }),
    ).toBe(false);
    const gone = [config("ho_3", "simplified", "2026-01-01", null, FIXED)];
    expect(
      overlapsSimplified(gone, { method: "simplified", startDate: "2026-07-01", endDate: null }),
    ).toBe(false);
  });
});

describe("CSV round trip of an Actual config", () => {
  it("keeps every Actual field through export and import, byte for byte", async () => {
    const { exampleBundle, exportBundle, parseCsv } = await import("@fiscode/csv");
    const bundle = exampleBundle();
    bundle.homeOffice = [
      {
        ...bundle.homeOffice[0]!,
        id: "ho_actual_demo",
        method: "actual",
        startDate: "2026-03-02",
        endDate: "2026-12-31",
        officeSqft: 96,
        homeSqft: 1220,
        monthlyRentMortgageCents: 137500,
        monthlyUtilitiesCents: 17500,
        monthlyInsuranceCents: 2550,
      },
    ];
    const csv = exportBundle(bundle, { scope: "full" });
    const { bundle: back, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);
    expect(back.homeOffice).toEqual(bundle.homeOffice);
    expect(exportBundle(back, { scope: "full" })).toBe(csv);
  });
});
