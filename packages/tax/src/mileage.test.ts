import { describe, expect, it } from "vitest";
import { config2025 } from "./config/2025.ts";
import { config2026 } from "./config/2026.ts";
import { getYearConfig } from "./config/index.ts";
import { mileageDeduction, mileageRateOn } from "./mileage.ts";

const trip = (date: string, businessMiles: number) => ({ date, businessMiles });

describe("mileageRateOn", () => {
  it("2026: 72.5 cents through June 30, 76 cents from July 1", () => {
    expect(mileageRateOn(config2026, "2026-01-01")).toBe(0.725);
    expect(mileageRateOn(config2026, "2026-06-30")).toBe(0.725);
    expect(mileageRateOn(config2026, "2026-07-01")).toBe(0.76);
    expect(mileageRateOn(config2026, "2026-12-31")).toBe(0.76);
  });

  it("2025: one rate all year", () => {
    expect(mileageRateOn(config2025, "2025-01-01")).toBe(0.7);
    expect(mileageRateOn(config2025, "2025-12-31")).toBe(0.7);
  });

  it("a fallback year uses the latest known rate", () => {
    expect(mileageRateOn(getYearConfig(2027), "2027-03-01")).toBe(0.76);
  });
});

describe("mileageDeduction", () => {
  it("deducts each trip at the rate in force on its date", () => {
    // 100 mi × $0.725 = $72.50 (June 30) + 100 mi × $0.76 = $76.00 (July 1) = $148.50
    const cents = mileageDeduction([trip("2026-06-30", 100), trip("2026-07-01", 100)], config2026);
    expect(cents).toBe(14_850);
  });

  it("rounds once per rate period, not per trip", () => {
    // 3 trips of 1 mi before July: 3 × $0.725 = $2.175 -> $2.18 (one rounding)
    // 1 mi after: $0.76. Total $2.94.
    const cents = mileageDeduction(
      [trip("2026-01-02", 1), trip("2026-02-02", 1), trip("2026-03-02", 1), trip("2026-08-01", 1)],
      config2026,
    );
    expect(cents).toBe(294);
  });

  it("no trips, no deduction", () => {
    expect(mileageDeduction([], config2026)).toBe(0);
  });
});
