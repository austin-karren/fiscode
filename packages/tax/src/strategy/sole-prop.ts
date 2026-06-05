import { type Cents, addCents, cents, clampMinZero, mulRate, subCents } from "@fiscode/core";
import type {
  AnnualizedInput,
  QuarterlyPlan,
  TaxEstimate,
  TaxInput,
  YearConfig,
} from "../types.ts";
import { computeSeTax } from "../se-tax.ts";
import { computeQbi } from "../qbi.ts";
import { computeFederalBracketTax } from "../federal.ts";
import { evenQuarterly } from "../quarterly.ts";
import { annualizedQuarterly } from "../annualized.ts";
import type { TaxStrategy } from "./types.ts";
import type { QuarterlyMethod } from "@fiscode/core";

const stateTax = (
  taxableIncome: Cents,
  cfg: YearConfig,
  state: TaxInput["state"],
): { rate: number; tax: Cents } => {
  const rate = cfg.stateRates[state] ?? 0;
  if (rate === 0) return { rate, tax: cents(0) };
  return { rate, tax: mulRate(clampMinZero(taxableIncome), rate) };
};

export const soleProprietorStrategy: TaxStrategy = {
  id: "sole_prop",
  compute(input: TaxInput, cfg: YearConfig): TaxEstimate {
    const netProfit = clampMinZero(subCents(input.gross1099, input.deductibleExpenses));

    const se = computeSeTax(netProfit, input.filingStatus, cfg);

    // AGI ≈ net profit + spouse W-2 wages − half SE tax. We don't model other
    // adjustments yet (HSA, retirement, etc.) since the user has none.
    const agi = clampMinZero(
      subCents(addCents(netProfit, input.spouseW2Wages), se.halfSeTaxDeduction),
    );

    const stdDeduction = cfg.standardDeduction[input.filingStatus];
    const taxableIncomeBeforeQbi = clampMinZero(subCents(agi, stdDeduction));

    // QBI base = net profit minus half SE tax (the "QBI component" deduction).
    const qbiBase = clampMinZero(subCents(netProfit, se.halfSeTaxDeduction));
    const qbiDeduction = computeQbi(qbiBase, taxableIncomeBeforeQbi, input.filingStatus, cfg);

    const taxableIncome = clampMinZero(subCents(taxableIncomeBeforeQbi, qbiDeduction));

    const federalIncomeTax = computeFederalBracketTax(taxableIncome, input.filingStatus, cfg);

    const { rate: stateRate, tax: stateIncomeTax } = stateTax(taxableIncome, cfg, input.state);

    const totalLiability = addCents(federalIncomeTax, se.totalSeTax, stateIncomeTax);

    const totalWithholding = addCents(input.spouseFederalWithholding, input.spouseStateWithholding);

    return {
      year: input.year,
      netProfit,
      agi,
      se,
      federal: {
        taxableIncome,
        qbiDeduction,
        federalIncomeTax,
      },
      state: {
        taxableIncome,
        rate: stateRate,
        stateIncomeTax,
      },
      spouseWithholding: totalWithholding,
      totalLiability,
      remainingOwed: clampMinZero(subCents(totalLiability, totalWithholding)),
    };
  },
  quarterly(
    input: TaxInput | AnnualizedInput,
    cfg: YearConfig,
    method: QuarterlyMethod,
  ): QuarterlyPlan {
    if (method === "annualized") {
      if (!("periods" in input)) {
        throw new Error("annualized method requires AnnualizedInput.periods");
      }
      return annualizedQuarterly(input, cfg, soleProprietorStrategy);
    }
    return evenQuarterly(this.compute(input, cfg), cfg);
  },
};
