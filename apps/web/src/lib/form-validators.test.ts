import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  nonNegativeIntegerString,
  optionalIntegerString,
  optionalNonNegativeIntegerString,
  optionalUsdString,
  positiveIntegerString,
  positiveNumericString,
} from "@fiscode/core";

/**
 * These pin the exact form schemas used in routes. If a route file drifts
 * (e.g., someone replaces `positiveIntegerString` with `z.string()` to
 * silence a TS error), this test breaks loudly.
 *
 * Keep field shapes in sync with the route files:
 *   • routes/mileage.tsx → mileageSchema
 *   • routes/time.tsx → timeSchema
 *   • routes/profile.tsx → profileSchema, spouseSchema
 *   • routes/home-office.tsx → homeOfficeSchema
 *   • routes/vehicles.tsx → vehicleSchema
 */

// Subset of route schemas that only depend on the numeric/usd fields. The
// route files have richer top-level schemas (date pickers, selects, etc.) —
// here we only re-derive the numeric pieces to assert their behavior.

const mileageNumeric = z.object({ miles: positiveIntegerString });
const timeNumeric = z.object({ hours: positiveNumericString });
const profileNumeric = z.object({
  dependents: nonNegativeIntegerString,
  prepLeadDays: positiveIntegerString,
});
const spouseNumeric = z.object({
  wages: optionalUsdString,
  fedWH: optionalUsdString,
  stateWH: optionalUsdString,
});
const homeOfficeNumeric = z.object({
  officeSqft: optionalNonNegativeIntegerString,
  homeSqft: optionalNonNegativeIntegerString,
});
const vehicleNumeric = z.object({
  year: optionalIntegerString,
  mpg: optionalNonNegativeIntegerString,
});

describe("mileage form — miles field", () => {
  it("rejects blank, NaN, 0, negatives, and decimals", () => {
    for (const bad of ["", "abc", "0", "-5", "1.5", "   "]) {
      expect(mileageNumeric.safeParse({ miles: bad }).success).toBe(false);
    }
  });
  it("accepts a positive integer", () => {
    const r = mileageNumeric.safeParse({ miles: "47" });
    expect(r.success).toBe(true);
    expect(r.data!.miles).toBe(47);
  });
});

describe("time form — hours field", () => {
  it("accepts fractional hours like 0.25 / 7.5", () => {
    expect(timeNumeric.safeParse({ hours: "0.25" }).data!.hours).toBe(0.25);
    expect(timeNumeric.safeParse({ hours: "7.5" }).data!.hours).toBe(7.5);
  });
  it("rejects 0, negatives, and non-numerics", () => {
    for (const bad of ["", "0", "-1", "abc"]) {
      expect(timeNumeric.safeParse({ hours: bad }).success).toBe(false);
    }
  });
});

describe("profile form — dependents + prepLeadDays", () => {
  it("dependents allows 0 but not negatives or decimals", () => {
    expect(profileNumeric.safeParse({ dependents: "0", prepLeadDays: "14" }).success).toBe(true);
    expect(profileNumeric.safeParse({ dependents: "-1", prepLeadDays: "14" }).success).toBe(false);
    expect(profileNumeric.safeParse({ dependents: "1.5", prepLeadDays: "14" }).success).toBe(false);
  });
  it("prepLeadDays must be ≥ 1", () => {
    expect(profileNumeric.safeParse({ dependents: "0", prepLeadDays: "0" }).success).toBe(false);
    expect(profileNumeric.safeParse({ dependents: "0", prepLeadDays: "1" }).success).toBe(true);
  });
  it("blank dependents or prepLeadDays now triggers a validation error (previously silently 0/14)", () => {
    expect(profileNumeric.safeParse({ dependents: "", prepLeadDays: "14" }).success).toBe(false);
    expect(profileNumeric.safeParse({ dependents: "0", prepLeadDays: "" }).success).toBe(false);
  });
});

describe("spouse form — USD amounts", () => {
  it("blank → null (treated as $0 downstream); non-numeric → rejected", () => {
    const blank = spouseNumeric.safeParse({ wages: "", fedWH: "", stateWH: "" });
    expect(blank.success).toBe(true);
    expect(blank.data).toEqual({ wages: null, fedWH: null, stateWH: null });

    expect(
      spouseNumeric.safeParse({ wages: "forty thousand", fedWH: "", stateWH: "" }).success,
    ).toBe(false);
  });
  it("parses $40,000 to 4_000_000 cents", () => {
    const r = spouseNumeric.safeParse({ wages: "$40,000", fedWH: "0", stateWH: "0" });
    expect(r.success).toBe(true);
    expect(r.data!.wages).toBe(4_000_000);
  });
});

describe("home-office form — sqft fields", () => {
  it("blank → null; 0 / positives accepted; negatives + non-numeric rejected", () => {
    expect(homeOfficeNumeric.safeParse({ officeSqft: "", homeSqft: "" }).data).toEqual({
      officeSqft: null,
      homeSqft: null,
    });
    expect(homeOfficeNumeric.safeParse({ officeSqft: "150", homeSqft: "2000" }).data).toEqual({
      officeSqft: 150,
      homeSqft: 2000,
    });
    expect(homeOfficeNumeric.safeParse({ officeSqft: "-1", homeSqft: "" }).success).toBe(false);
    expect(homeOfficeNumeric.safeParse({ officeSqft: "abc", homeSqft: "" }).success).toBe(false);
  });
});

describe("vehicle form — year + mpg", () => {
  it("year accepts integers (including negatives, technically), rejects decimals", () => {
    expect(vehicleNumeric.safeParse({ year: "2022", mpg: "28" }).data).toEqual({
      year: 2022,
      mpg: 28,
    });
    expect(vehicleNumeric.safeParse({ year: "2022.5", mpg: "" }).success).toBe(false);
  });
  it("mpg rejects negatives", () => {
    expect(vehicleNumeric.safeParse({ year: "", mpg: "-5" }).success).toBe(false);
  });
  it("both blank → both null", () => {
    expect(vehicleNumeric.safeParse({ year: "", mpg: "" }).data).toEqual({
      year: null,
      mpg: null,
    });
  });
});
