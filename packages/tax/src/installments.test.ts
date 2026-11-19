import { describe, expect, it } from "vitest";
import { cents, dollars } from "@fiscode/core";
import {
  installmentsRequired,
  paymentsAfterWithholding,
  regularInstallments,
  scheduleAiInstallments,
} from "./installments.ts";

// Form 2210 (2025 edition, the latest posted), https://www.irs.gov/pub/irs-pdf/f2210.pdf
// and its instructions, https://www.irs.gov/pub/irs-pdf/i2210.pdf.

describe("regularInstallments (Form 2210 line 10: 25% of line 9 in each column)", () => {
  it("splits the required annual payment into four, summing exactly", () => {
    // 2,238.34 / 4 = 559.585 → 559.59, 559.59, 559.59, and 559.57 so the four add to 2,238.34
    const r = regularInstallments(dollars(2_238.34));
    expect(r).toEqual([55_959, 55_959, 55_959, 55_957]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(223_834);
  });
});

describe("scheduleAiInstallments (Schedule AI lines 21-27)", () => {
  // Required annual payment (line 9) 8,000.00, so line 24 = 2,000.00 each.
  const line9 = dollars(8_000);

  it("front-loaded income: each installment is capped at the regular amount plus carry", () => {
    // Annualized tax (line 19): 40,000 / 20,000 / 13,333.33 / 10,000
    // Line 21 (× 22.5/45/67.5/90%): 9,000 / 9,000 / 9,000 / 9,000
    // Q1: line 23 = 9,000 − 0 = 9,000; line 26 = 2,000; line 27 = 2,000
    // Q2: line 23 = 9,000 − 2,000 = 7,000; line 25 = 2,000 − 2,000 = 0; line 26 = 2,000; 27 = 2,000
    // Q3: line 23 = 9,000 − 4,000 = 5,000; line 26 = 2,000; 27 = 2,000
    // Q4: line 23 = 9,000 − 6,000 = 3,000; line 26 = 2,000; 27 = 2,000
    // Sum = 8,000 = line 9
    const r = scheduleAiInstallments(
      [dollars(40_000), dollars(20_000), dollars(13_333.33), dollars(10_000)],
      line9,
    );
    expect(r).toEqual([dollars(2_000), dollars(2_000), dollars(2_000), dollars(2_000)]);
  });

  it("back-loaded income: early installments are smaller and recaptured later", () => {
    // Annualized tax: 0 / 0 / 4,000 / 10,000
    // Line 21: 0 / 0 / 2,700 / 9,000
    // Q1: line 23 = 0; line 26 = 2,000; 27 = 0
    // Q2: line 23 = 0; line 25 = 2,000 − 0 = 2,000; line 26 = 4,000; 27 = 0
    // Q3: line 23 = 2,700; line 25 = 4,000; line 26 = 6,000; 27 = 2,700
    // Q4: line 23 = 9,000 − 2,700 = 6,300; line 25 = 6,000 − 2,700 = 3,300; line 26 = 5,300; 27 = 5,300
    // Sum = 8,000 = line 9 (the reduction in Q1-Q2 is recaptured in Q3-Q4)
    const r = scheduleAiInstallments([cents(0), cents(0), dollars(4_000), dollars(10_000)], line9);
    expect(r).toEqual([0, 0, dollars(2_700), dollars(5_300)]);
  });

  it("never asks more than the regular installments would", () => {
    const r = scheduleAiInstallments(
      [dollars(1_000_000), dollars(1_000_000), dollars(1_000_000), dollars(1_000_000)],
      line9,
    );
    expect(r.reduce((a, b) => a + b, 0)).toBe(dollars(8_000));
  });
});

describe("paymentsAfterWithholding (Part III lines 11-18; withholding is 1/4 per due date)", () => {
  it("subtracts a quarter of the withholding from each installment", () => {
    // Installments 2,000 each; withholding 4,000 → 1,000 per quarter → pay 1,000 each
    const p = paymentsAfterWithholding(
      [dollars(2_000), dollars(2_000), dollars(2_000), dollars(2_000)],
      dollars(4_000),
    );
    expect(p).toEqual([dollars(1_000), dollars(1_000), dollars(1_000), dollars(1_000)]);
  });

  it("carries an overpayment into later quarters", () => {
    // Installments 0 / 0 / 2,700 / 5,300; withholding 4,000 → 1,000 per quarter
    // Q1: 1,000 available, 0 due → carry 1,000; Q2: 2,000 available → carry 2,000
    // Q3: 3,000 available, 2,700 due → pay 0, carry 300
    // Q4: 1,300 available, 5,300 due → pay 4,000
    const p = paymentsAfterWithholding(
      [cents(0), cents(0), dollars(2_700), dollars(5_300)],
      dollars(4_000),
    );
    expect(p).toEqual([0, 0, 0, dollars(4_000)]);
  });

  it("pays nothing when withholding covers the year", () => {
    const p = paymentsAfterWithholding(
      [dollars(1_396.67), dollars(1_396.67), dollars(1_396.67), dollars(1_396.67)],
      dollars(6_300),
    );
    expect(p).toEqual([0, 0, 0, 0]);
  });
});

describe("installmentsRequired (Form 2210 lines 4 and 7: under $1,000, no penalty)", () => {
  it("no installments when the tax left after withholding is under $1,000", () => {
    expect(installmentsRequired(dollars(999.99))).toBe(false);
    expect(installmentsRequired(cents(0))).toBe(false);
  });

  it("installments are required at $1,000.00 and above", () => {
    expect(installmentsRequired(dollars(1_000))).toBe(true);
    expect(installmentsRequired(dollars(1_000.01))).toBe(true);
  });
});
