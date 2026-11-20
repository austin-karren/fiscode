import { describe, expect, it } from "vitest";

import {
  dependentsCount,
  hoursField,
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

// One short message per kind of failure (d-ux ruling on #52): each fits the
// one message line under a field in the narrowest add-form column.
const ENTER_AMOUNT = "Enter an amount, like 12.50";
const MORE_THAN_0 = "Must be more than $0";
const TWO_DECIMALS = "Use 2 decimals at most";
const TOO_LARGE = "Too large";

describe("moneyAmount", () => {
  it.each([
    ["12.50", 1250],
    ["12.5", 1250],
    ["12", 1200],
    ["0.01", 1],
    [".5", 50],
    ["$1,234.56", 123456],
    ["1,234,567", 123456700],
    [" 40 ", 4000],
    ["99999999.99", 9999999999],
  ])("accepts %j as %i cents", (input, cents) => {
    expect(moneyAmount.safeParse(input).data).toBe(cents);
  });

  it.each([
    ["", ENTER_AMOUNT],
    ["   ", ENTER_AMOUNT],
    ["abc", ENTER_AMOUNT],
    ["-50", ENTER_AMOUNT],
    ["0", MORE_THAN_0],
    ["0.00", MORE_THAN_0],
    ["1e3", ENTER_AMOUNT],
    ["0x10", ENTER_AMOUNT],
    ["Infinity", ENTER_AMOUNT],
    ["1.2.3", ENTER_AMOUNT],
    ["12,50", ENTER_AMOUNT],
    ["1,2", ENTER_AMOUNT],
    ["1,2345", ENTER_AMOUNT],
    [",500", ENTER_AMOUNT],
    ["12.345", TWO_DECIMALS],
    ["999999999999", TOO_LARGE],
    ["100000000", TOO_LARGE],
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
    ["abc", ENTER_AMOUNT],
    ["-5", ENTER_AMOUNT],
    ["0", MORE_THAN_0],
    ["1e3", ENTER_AMOUNT],
    ["12.345", TWO_DECIMALS],
    ["999999999999", TOO_LARGE],
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
    ["abc", ENTER_AMOUNT],
    ["-5", ENTER_AMOUNT],
    ["1e3", ENTER_AMOUNT],
    ["12.345", TWO_DECIMALS],
    ["999999999999", TOO_LARGE],
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
    ["", "Enter hours, like 1.5"],
    ["abc", "Enter hours, like 1.5"],
    ["0", "Must be more than 0"],
    ["-1", "Enter hours, like 1.5"],
    ["1e1", "Enter hours, like 1.5"],
    ["1.33", "Use quarter hours, like 1.25"],
    ["30", "24 hours at most"],
    ["24.25", "24 hours at most"],
  ])("rejects %j with an inline message", (input, message) => {
    expect(messageOf(hoursWorked, input)).toBe(message);
  });
});

describe("optionalVehicleYear", () => {
  const nextYear = new Date().getFullYear() + 1;
  const outOfRange = `Must be 1900 to ${nextYear}`;
  const notAYear = "Enter a 4-digit year";

  it("accepts blank and a plausible year", () => {
    expect(optionalVehicleYear.safeParse("").data).toBeNull();
    expect(optionalVehicleYear.safeParse("2023").data).toBe(2023);
    expect(optionalVehicleYear.safeParse(String(nextYear)).data).toBe(nextYear);
  });

  it.each(["20233", "202", "1899", String(nextYear + 1)])("rejects %j as out of range", (input) => {
    expect(messageOf(optionalVehicleYear, input)).toBe(outOfRange);
  });

  it.each(["-2023", "2023.5", "2e3", "abc"])("rejects %j as not a year", (input) => {
    expect(messageOf(optionalVehicleYear, input)).toBe(notAYear);
  });
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

  it("says the allowed range for a number outside it", () => {
    expect(messageOf(tripMiles, "0")).toBe("Must be 1 to 9,999");
    expect(messageOf(optionalSqft, "100000")).toBe("Must be 0 to 99,999");
  });

  it("asks for a whole number when the value is not one", () => {
    expect(messageOf(tripMiles, "abc")).toBe("Enter a whole number");
    expect(messageOf(tripMiles, "1.5")).toBe("Enter a whole number");
  });
});

describe("hoursField", () => {
  it.each([
    [60, "1"],
    [75, "1.25"],
    [83, "1:23"], // off the quarter-hour step: exact, never rounded
    [7, "0:07"],
    [1440, "24"],
  ])("shows %i minutes as %s hours, a value the time form takes", (minutes, text) => {
    expect(hoursField(minutes)).toBe(text);
    expect(hoursWorked.safeParse(text).success).toBe(true);
  });

  it.each([60, 75, 83, 7, 1439, 1440])("round-trips %i minutes exactly", (minutes) => {
    const hours = hoursWorked.parse(hoursField(minutes));
    expect(Math.round(hours * 60)).toBe(minutes);
  });

  it.each([
    ["0:00", "Must be more than 0"],
    ["24:01", "24 hours at most"],
    ["1:60", "Enter hours, like 1.5"],
  ])("refuses %s as h:mm", (text, message) => {
    const result = hoursWorked.safeParse(text);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });
});
