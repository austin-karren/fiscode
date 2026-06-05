import { describe, expect, it } from "vitest";
import {
  addCents,
  cents,
  clampMinZero,
  dollars,
  formatUSD,
  mulRate,
  parseUSD,
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

  it("parses USD with junk", () => {
    expect(parseUSD("$1,234.56")).toBe(dollars(1234.56));
    expect(parseUSD("  42 ")).toBe(dollars(42));
    expect(parseUSD("")).toBeUndefined();
    expect(parseUSD("not a number")).toBeUndefined();
  });
});
