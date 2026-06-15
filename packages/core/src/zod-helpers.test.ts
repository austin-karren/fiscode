import { describe, expect, it } from "vitest";
import {
  csvBoolean,
  csvOptionalInteger,
  csvOptionalIsoDate,
  csvRequiredInteger,
  csvIsoDate,
  integerString,
  isoDateString,
  nonNegativeIntegerString,
  nonNegativeNumericString,
  numericString,
  optionalIntegerString,
  optionalIsoDateString,
  optionalNonNegativeIntegerString,
  optionalUsdString,
  positiveIntegerString,
  positiveNumericString,
  usdString,
} from "./zod-helpers.ts";

const ok = <T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  input: unknown,
) => {
  const r = schema.safeParse(input);
  expect(r.success, `expected ${JSON.stringify(input)} to parse`).toBe(true);
  return r.data!;
};

const fail = (
  schema: { safeParse: (v: unknown) => { success: boolean } },
  input: unknown,
): void => {
  expect(schema.safeParse(input).success, `expected ${JSON.stringify(input)} to fail`).toBe(false);
};

describe("numericString", () => {
  it("parses finite numbers (positive, negative, decimal)", () => {
    expect(ok(numericString, "42")).toBe(42);
    expect(ok(numericString, "-3.5")).toBe(-3.5);
    expect(ok(numericString, "  7 ")).toBe(7);
  });
  it("rejects empty / whitespace / non-numeric", () => {
    fail(numericString, "");
    fail(numericString, "   ");
    fail(numericString, "abc");
    fail(numericString, "12abc");
    fail(numericString, "Infinity");
  });
});

describe("nonNegativeNumericString / positiveNumericString", () => {
  it("nonNegative accepts 0", () => {
    expect(ok(nonNegativeNumericString, "0")).toBe(0);
    expect(ok(nonNegativeNumericString, "0.5")).toBe(0.5);
  });
  it("nonNegative rejects negatives", () => {
    fail(nonNegativeNumericString, "-1");
  });
  it("positive rejects 0 and negatives", () => {
    fail(positiveNumericString, "0");
    fail(positiveNumericString, "-1");
    expect(ok(positiveNumericString, "0.25")).toBe(0.25);
  });
});

describe("integerString / nonNegativeIntegerString / positiveIntegerString", () => {
  it("integerString rejects decimals", () => {
    fail(integerString, "1.5");
    expect(ok(integerString, "42")).toBe(42);
  });
  it("nonNegativeInteger accepts 0", () => {
    expect(ok(nonNegativeIntegerString, "0")).toBe(0);
    fail(nonNegativeIntegerString, "-1");
    fail(nonNegativeIntegerString, "1.5");
  });
  it("positiveInteger rejects 0", () => {
    fail(positiveIntegerString, "0");
    expect(ok(positiveIntegerString, "1")).toBe(1);
  });
});

describe("optionalIntegerString / optionalNonNegativeIntegerString", () => {
  it("empty → null", () => {
    expect(ok(optionalIntegerString, "")).toBeNull();
    expect(ok(optionalIntegerString, "   ")).toBeNull();
    expect(ok(optionalNonNegativeIntegerString, "")).toBeNull();
  });
  it("integer in, integer out", () => {
    expect(ok(optionalIntegerString, "2022")).toBe(2022);
    expect(ok(optionalNonNegativeIntegerString, "0")).toBe(0);
  });
  it("non-numeric rejected even when 'optional'", () => {
    fail(optionalIntegerString, "abc");
    fail(optionalNonNegativeIntegerString, "abc");
  });
  it("negative rejected for nonNegative variant", () => {
    expect(ok(optionalIntegerString, "-3")).toBe(-3);
    fail(optionalNonNegativeIntegerString, "-3");
  });
  it("decimals rejected", () => {
    fail(optionalIntegerString, "1.5");
    fail(optionalNonNegativeIntegerString, "1.5");
  });
});

describe("usdString / optionalUsdString", () => {
  it("parses $1,234.56 to 123456 cents", () => {
    expect(ok(usdString, "$1,234.56")).toBe(123_456);
    expect(ok(usdString, "1234.56")).toBe(123_456);
    expect(ok(usdString, "  42 ")).toBe(4_200);
  });
  it("rejects non-numeric and empty", () => {
    fail(usdString, "abc");
    fail(usdString, "");
  });
  it("optional: blank → null", () => {
    expect(ok(optionalUsdString, "")).toBeNull();
    expect(ok(optionalUsdString, "   ")).toBeNull();
  });
  it("optional: non-numeric still rejected (not silently $0)", () => {
    fail(optionalUsdString, "abc");
  });
});

describe("isoDateString / optionalIsoDateString", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(ok(isoDateString, "2026-06-15")).toBe("2026-06-15");
  });
  it("rejects other formats", () => {
    fail(isoDateString, "2026/06/15");
    fail(isoDateString, "06-15-2026");
    fail(isoDateString, "2026-13-01"); // invalid month
    fail(isoDateString, "not-a-date");
    fail(isoDateString, "");
  });
  it("optional: blank → null", () => {
    expect(ok(optionalIsoDateString, "")).toBeNull();
    expect(ok(optionalIsoDateString, "2026-01-01")).toBe("2026-01-01");
    fail(optionalIsoDateString, "2026/01/01");
  });
});

describe("CSV cell helpers", () => {
  it("csvOptionalInteger: '' → null; finite int → number; junk rejected", () => {
    expect(ok(csvOptionalInteger, "")).toBeNull();
    expect(ok(csvOptionalInteger, "42")).toBe(42);
    fail(csvOptionalInteger, "abc");
    fail(csvOptionalInteger, "1.5");
  });
  it("csvRequiredInteger rejects empty", () => {
    fail(csvRequiredInteger, "");
    expect(ok(csvRequiredInteger, "0")).toBe(0);
  });
  it("csvBoolean: '0' / '1' / '' only", () => {
    expect(ok(csvBoolean, "1")).toBe(true);
    expect(ok(csvBoolean, "0")).toBe(false);
    expect(ok(csvBoolean, "")).toBe(false);
    fail(csvBoolean, "true");
    fail(csvBoolean, "yes");
  });
  it("csvIsoDate: required, strict format", () => {
    expect(ok(csvIsoDate, "2026-06-15")).toBe("2026-06-15");
    fail(csvIsoDate, "");
    fail(csvIsoDate, "2026/06/15");
  });
  it("csvOptionalIsoDate: '' → null", () => {
    expect(ok(csvOptionalIsoDate, "")).toBeNull();
    expect(ok(csvOptionalIsoDate, "2026-06-15")).toBe("2026-06-15");
    fail(csvOptionalIsoDate, "2026/06/15");
  });
});
