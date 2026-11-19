import { describe, expect, it } from "vitest";
import {
  addCents,
  cents,
  clampMinZero,
  dollars,
  formatUSD,
  mulRate,
  AMOUNT_CEILING_CENTS,
  checkAmountRange,
  parseMoney,
  parseWholeNumber,
  subCents,
  toDollars,
} from "./money.ts";

describe("money", () => {
  it("dollars/cents conversion round-trips", () => {
    expect(toDollars(dollars(123.45))).toBe(123.45);
  });

  it("rounds at construction (banker-ish via Math.round)", () => {
    // Standard rounding is fine for tax math; IRS rounds to nearest dollar at line level.
    expect(dollars(0.005)).toBe(1);
  });

  it("adds without float drift", () => {
    const a = dollars(0.1);
    const b = dollars(0.2);
    expect(toDollars(addCents(a, b))).toBe(0.3);
  });

  it("subtracts", () => {
    expect(subCents(dollars(10), dollars(3))).toBe(700);
  });

  it("multiplies by rate", () => {
    expect(mulRate(dollars(100), 0.0145)).toBe(cents(145));
  });

  it("clampMinZero turns negatives to zero", () => {
    expect(clampMinZero(subCents(dollars(3), dollars(10)))).toBe(0);
  });

  it("formats USD with commas", () => {
    expect(formatUSD(dollars(1234567.89))).toBe("$1,234,567.89");
    expect(formatUSD(dollars(-50))).toBe("-$50.00");
    expect(formatUSD(dollars(0))).toBe("$0.00");
  });
});

// Expected cents are literals, written by hand from the input.
describe("parseMoney", () => {
  const ok = (cents: number) => ({ ok: true, cents });
  const no = (reason: string) => ({ ok: false, reason });
  it.each([
    ["1e3", no("syntax")],
    ["0x10", no("syntax")],
    ["-50", no("negative")],
    ["12.345", no("decimals")],
    ["12,50", no("syntax")],
    ["999999999999", ok(99_999_999_999_900)],
    ["Infinity", no("syntax")],
    [" $1,234.56 ", ok(123_456)],
    ["", no("empty")],
    ["   ", no("empty")],
    ["0", ok(0)],
    ["0.00", ok(0)],
    ["0.01", ok(1)],
    ["99,999,999.99", ok(9_999_999_999)],
    ["100,000,000", ok(10_000_000_000)],
    ["90071992547409.91", ok(9_007_199_254_740_991)],
    ["90071992547409.92", no("too_large")],
    ["99999999999999999999", no("too_large")],
    ["007.50", ok(750)],
    [".5", ok(50)],
    ["5.", ok(500)],
    [".", no("syntax")],
    ["$", no("syntax")],
    ["1,23", no("syntax")],
    ["1,234,567.89", ok(123_456_789)],
    ["12 34", no("syntax")],
    ["$ 12", ok(1_200)],
    ["١٢", no("syntax")],
    ["１２", no("syntax")],
    ["=12", no("syntax")],
    ["'12", no("syntax")],
    ["+5", no("syntax")],
    ["--5", no("syntax")],
    ["1.1.1", no("syntax")],
  ])("%j", (raw, expected) => {
    expect(parseMoney(raw)).toEqual(expected);
  });

  it("reads a sign only when the caller asks for one", () => {
    expect(parseMoney("-50", { signed: true })).toEqual({ ok: true, cents: -5_000 });
    expect(parseMoney("-$12.30", { signed: true })).toEqual({ ok: true, cents: -1_230 });
    expect(parseMoney("$-12.30", { signed: true })).toEqual({ ok: true, cents: -1_230 });
    expect(parseMoney("-$-12.30", { signed: true })).toEqual({ ok: false, reason: "syntax" });
    expect(parseMoney("- 5", { signed: true })).toEqual({ ok: false, reason: "syntax" });
    expect(parseMoney("-$ 5", { signed: true })).toEqual({ ok: true, cents: -500 });
    expect(parseMoney("-0", { signed: true })).toEqual({ ok: true, cents: 0 });
    expect(parseMoney("-12.345", { signed: true })).toEqual({ ok: false, reason: "decimals" });
  });
});

describe("checkAmountRange", () => {
  it("applies the floor and the $100,000,000 ceiling", () => {
    expect(AMOUNT_CEILING_CENTS).toBe(10_000_000_000);
    expect(checkAmountRange(cents(0), "positive")).toBe("below_floor");
    expect(checkAmountRange(cents(1), "positive")).toBeNull();
    expect(checkAmountRange(cents(0), "nonNegative")).toBeNull();
    expect(checkAmountRange(cents(-1), "nonNegative")).toBe("below_floor");
    expect(checkAmountRange(cents(9_999_999_999), "positive")).toBeNull();
    expect(checkAmountRange(cents(10_000_000_000), "positive")).toBe("too_large");
  });
});

describe("parseWholeNumber", () => {
  const ok = (value: number) => ({ ok: true, value });
  const no = (reason: string) => ({ ok: false, reason });
  it.each([
    ["47", ok(47)],
    [" 7 ", ok(7)],
    ["007", ok(7)],
    ["0", ok(0)],
    ["", no("empty")],
    ["1e3", no("syntax")],
    ["0x10", no("syntax")],
    ["4.0", no("syntax")],
    ["1,000", no("syntax")],
    ["+5", no("syntax")],
    ["-5", no("negative")],
    ["١٢", no("syntax")],
    ["9007199254740991", ok(9_007_199_254_740_991)],
    ["9007199254740992", no("too_large")],
    ["99999999999999999999", no("too_large")],
  ])("%j", (raw, expected) => {
    expect(parseWholeNumber(raw)).toEqual(expected);
  });

  it("reads a minus sign only when the caller asks for one", () => {
    expect(parseWholeNumber("-5", { signed: true })).toEqual({ ok: true, value: -5 });
    expect(parseWholeNumber("-0", { signed: true })).toEqual({ ok: true, value: 0 });
  });
});
