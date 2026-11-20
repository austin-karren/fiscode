import { describe, expect, it } from "vitest";

import { countedInYear, isBeforeSeStart, yearExclusion } from "./year-inclusion.ts";

const row = (date: string, deletedAt: string | null = null) => ({ date, deletedAt });

describe("yearExclusion", () => {
  it("counts a live row dated in the year on or after the SE start", () => {
    expect(yearExclusion(row("2026-07-01"), 2026, "2026-07-01")).toBeNull();
  });

  it("names the reason a row does not count", () => {
    expect(yearExclusion(row("2026-08-01", "2026-09-01"), 2026, "2026-07-01")).toBe("deleted");
    expect(yearExclusion(row("2025-12-31"), 2026, null)).toBe("other_year");
    expect(yearExclusion(row("2026-06-30"), 2026, "2026-07-01")).toBe("before_se_start");
  });

  it("reads a blank or missing SE start as January 1 of the year", () => {
    expect(yearExclusion(row("2026-01-01"), 2026, "")).toBeNull();
    expect(yearExclusion(row("2026-01-01"), 2026, undefined)).toBeNull();
  });

  it("excludes the whole year when the SE start is in a later year", () => {
    expect(yearExclusion(row("2026-12-31"), 2026, "2027-01-01")).toBe("before_se_start");
  });
});

describe("countedInYear", () => {
  it("keeps the counted rows in order", () => {
    const rows = [row("2026-08-01"), row("2026-03-01"), row("2026-07-02")];
    expect(countedInYear(rows, 2026, "2026-07-01")).toEqual([rows[0], rows[2]]);
  });
});

describe("isBeforeSeStart", () => {
  it("is false with no SE start", () => {
    expect(isBeforeSeStart("2020-01-01", null)).toBe(false);
    expect(isBeforeSeStart("2020-01-01", "")).toBe(false);
  });
  it("is true strictly before the start", () => {
    expect(isBeforeSeStart("2026-06-30", "2026-07-01")).toBe(true);
    expect(isBeforeSeStart("2026-07-01", "2026-07-01")).toBe(false);
  });
});
