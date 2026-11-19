import { describe, expect, it } from "vitest";

import {
  dependentsCount,
  hoursWorked,
  leadDays,
  moneyAmount,
  optionalMoneyAmount,
  optionalMoneyAmountOrZero,
  optionalMpg,
  optionalSqft,
  optionalVehicleYear,
  tripMiles,
} from "./field-schemas";

type Schema = { safeParse: (v: string) => { success: boolean; data?: unknown; error?: unknown } };

const messageOf = (schema: Schema, input: string) => {
  const r = schema.safeParse(input) as {
    success: boolean;
    error?: { issues: { message: string }[] };
  };
  return r.success ? null : r.error!.issues[0]!.message;
};

const GREATER_THAN_0 = "Enter an amount greater than 0, like 12.50";
const TWO_DECIMALS = "Use at most 2 decimal places, like 12.50";
const BELOW_CEILING = "Enter an amount below $100,000,000";

describe("moneyAmount", () => {
  it.each([
    ["12.50", 1250],
    ["12.5", 1250],
    ["12", 1200],
    ["0.01", 1],
    [".5", 50],
    ["$1,234.56", 123456],
    [" 40 ", 4000],
    ["99999999.99", 9999999999],
  ])("accepts %j as %i cents", (input, cents) => {
    expect(moneyAmount.safeParse(input).data).toBe(cents);
  });

  it.each([
    ["", GREATER_THAN_0],
    ["   ", GREATER_THAN_0],
    ["abc", GREATER_THAN_0],
    ["-50", GREATER_THAN_0],
    ["0", GREATER_THAN_0],
    ["0.00", GREATER_THAN_0],
    ["1e3", GREATER_THAN_0],
    ["0x10", GREATER_THAN_0],
    ["Infinity", GREATER_THAN_0],
    ["1.2.3", GREATER_THAN_0],
    ["12.345", TWO_DECIMALS],
    ["999999999999", BELOW_CEILING],
    ["100000000", BELOW_CEILING],
  ])("rejects %j with a message that says what is allowed", (input, message) => {
    expect(messageOf(moneyAmount, input)).toBe(message);
  });
});

describe("optionalMoneyAmount", () => {
  it("treats blank as no value", () => {
    expect(optionalMoneyAmount.safeParse("").data).toBeNull();
    expect(optionalMoneyAmount.safeParse("  ").data).toBeNull();
  });
  it("accepts a plain amount", () => {
    expect(optionalMoneyAmount.safeParse("150").data).toBe(15000);
  });
  it.each([
    ["abc", GREATER_THAN_0],
    ["-5", GREATER_THAN_0],
    ["0", GREATER_THAN_0],
    ["1e3", GREATER_THAN_0],
    ["12.345", TWO_DECIMALS],
    ["999999999999", BELOW_CEILING],
  ])("rejects %j instead of saving it as empty", (input, message) => {
    expect(messageOf(optionalMoneyAmount, input)).toBe(message);
  });
});

describe("optionalMoneyAmountOrZero", () => {
  it("accepts blank, 0 and a plain amount", () => {
    expect(optionalMoneyAmountOrZero.safeParse("").data).toBeNull();
    expect(optionalMoneyAmountOrZero.safeParse("0").data).toBe(0);
    expect(optionalMoneyAmountOrZero.safeParse("$40,000").data).toBe(4_000_000);
  });
  it.each([
    ["abc", "Enter an amount of 0 or more, like 12.50"],
    ["-5", "Enter an amount of 0 or more, like 12.50"],
    ["1e3", "Enter an amount of 0 or more, like 12.50"],
    ["12.345", TWO_DECIMALS],
    ["999999999999", BELOW_CEILING],
  ])("rejects %j", (input, message) => {
    expect(messageOf(optionalMoneyAmountOrZero, input)).toBe(message);
  });
});

describe("hoursWorked", () => {
  it.each([
    ["0.25", 0.25],
    ["1.5", 1.5],
    ["7.75", 7.75],
    ["8", 8],
    ["24", 24],
  ])("accepts %j", (input, hours) => {
    expect(hoursWorked.safeParse(input).data).toBe(hours);
  });

  it.each([
    ["", "Enter hours greater than 0, like 1.5"],
    ["abc", "Enter hours greater than 0, like 1.5"],
    ["0", "Enter hours greater than 0, like 1.5"],
    ["-1", "Enter hours greater than 0, like 1.5"],
    ["1e1", "Enter hours greater than 0, like 1.5"],
    ["1.33", "Enter hours in quarter-hour steps, like 1.25"],
    ["30", "Enter 24 hours or fewer for one day"],
    ["24.25", "Enter 24 hours or fewer for one day"],
  ])("rejects %j with an inline message", (input, message) => {
    expect(messageOf(hoursWorked, input)).toBe(message);
  });
});

describe("optionalVehicleYear", () => {
  const nextYear = new Date().getFullYear() + 1;
  const message = `Enter a 4-digit year from 1900 to ${nextYear}`;

  it("accepts blank and a plausible year", () => {
    expect(optionalVehicleYear.safeParse("").data).toBeNull();
    expect(optionalVehicleYear.safeParse("2023").data).toBe(2023);
    expect(optionalVehicleYear.safeParse(String(nextYear)).data).toBe(nextYear);
  });

  it.each(["20233", "202", "1899", String(nextYear + 1), "-2023", "2023.5", "2e3", "abc"])(
    "rejects %j",
    (input) => {
      expect(messageOf(optionalVehicleYear, input)).toBe(message);
    },
  );
});

describe("whole-number fields", () => {
  it.each([
    ["tripMiles", tripMiles, ["1", "47", "9999"], ["", "0", "-5", "1.5", "1e3", "abc", "10000"]],
    ["leadDays", leadDays, ["1", "14", "365"], ["", "0", "-1", "1e2", "366"]],
    ["dependentsCount", dependentsCount, ["0", "3", "99"], ["", "-1", "1.5", "1e1", "100"]],
  ] as const)("%s", (_name, schema, good, bad) => {
    for (const input of good) expect(schema.safeParse(input).data).toBe(Number(input));
    for (const input of bad) expect(schema.safeParse(input).success).toBe(false);
  });

  it.each([
    ["optionalSqft", optionalSqft, ["0", "150", "99999"], ["-1", "1.5", "1e3", "abc", "100000"]],
    ["optionalMpg", optionalMpg, ["0", "28", "999"], ["-5", "2.5", "1e2", "1000"]],
  ] as const)("%s", (_name, schema, good, bad) => {
    expect(schema.safeParse("").data).toBeNull();
    for (const input of good) expect(schema.safeParse(input).data).toBe(Number(input));
    for (const input of bad) expect(schema.safeParse(input).success).toBe(false);
  });

  it("says the allowed range", () => {
    expect(messageOf(tripMiles, "0")).toBe("Enter a whole number from 1 to 9,999");
    expect(messageOf(optionalSqft, "-1")).toBe("Enter a whole number from 0 to 99,999");
  });
});
