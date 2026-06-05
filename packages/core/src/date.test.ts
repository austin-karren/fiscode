import { describe, expect, it } from "vitest";
import { inRange, isoDate, shiftToBusinessDay, yearEnd, yearOf, yearStart } from "./date.ts";

describe("date", () => {
  it("rejects malformed iso", () => {
    expect(() => isoDate("2026/01/01")).toThrow();
    expect(() => isoDate("not-a-date")).toThrow();
  });

  it("yearOf parses the year", () => {
    expect(yearOf(isoDate("2026-04-15"))).toBe(2026);
  });

  it("shiftToBusinessDay leaves weekdays alone", () => {
    // April 15 2026 is a Wednesday
    expect(shiftToBusinessDay(isoDate("2026-04-15"))).toBe("2026-04-15");
  });

  it("shiftToBusinessDay rolls Saturday/Sunday forward", () => {
    // 2027-01-15 is a Friday — but 2027-01-16 is Saturday.
    expect(shiftToBusinessDay(isoDate("2027-01-16"))).toBe("2027-01-18");
    expect(shiftToBusinessDay(isoDate("2027-01-17"))).toBe("2027-01-18");
  });

  it("shiftToBusinessDay rolls past fixed holiday", () => {
    // 2026-07-04 is a Saturday, so shifted to Monday 07-06.
    expect(shiftToBusinessDay(isoDate("2026-07-04"))).toBe("2026-07-06");
  });

  it("year bounds", () => {
    expect(yearStart(2026)).toBe("2026-01-01");
    expect(yearEnd(2026)).toBe("2026-12-31");
  });

  it("inRange handles open ends", () => {
    expect(inRange(isoDate("2026-06-01"), isoDate("2026-01-01"), null)).toBe(true);
    expect(inRange(isoDate("2025-06-01"), isoDate("2026-01-01"), null)).toBe(false);
    expect(inRange(isoDate("2026-06-01"), null, isoDate("2026-05-01"))).toBe(false);
  });
});
