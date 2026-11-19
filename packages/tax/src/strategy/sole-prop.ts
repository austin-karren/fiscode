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

/**
 * State income tax.
 *
 * Utah (TC-40 lines 7-18): the flat rate on Utah taxable income, which starts
 * from federal AGI (no Utah additions or subtractions are modelled), minus the
 * nonrefundable taxpayer tax credit: 6% of (federal standard deduction +
 * personal exemption per dependent), reduced by 1.3% of income over the
 * filing-status base, not below zero. The tax is never below zero.
 *
 * Other states: the configured flat rate on federal taxable income.
 */
const stateTax = (
  input: TaxInput,
  agi: Cents,
  federalTaxableIncome: Cents,
  cfg: YearConfig,
): { taxableIncome: Cents; rate: number; taxpayerCredit: Cents; tax: Cents } => {
  const rate = cfg.stateRates[input.state] ?? 0;
  if (input.state === "UT") {
    const c = cfg.utahTaxpayerCredit;
    const taxableIncome = clampMinZero(agi);
    const beforeCredit = mulRate(taxableIncome, rate);
    const exemptions = cents(c.personalExemptionPerDependent * (input.dependents ?? 0));
    const initialCredit = mulRate(
      addCents(cfg.standardDeduction[input.filingStatus], exemptions),
      c.creditRate,
    );
    const overBase = clampMinZero(subCents(taxableIncome, c.phaseOutBase[input.filingStatus]));
    const taxpayerCredit = clampMinZero(subCents(initialCredit, mulRate(overBase, c.phaseOutRate)));
    return {
      taxableIncome,
      rate,
      taxpayerCredit,
      tax: clampMinZero(subCents(beforeCredit, taxpayerCredit)),
    };
  }
  const tax = rate === 0 ? cents(0) : mulRate(clampMinZero(federalTaxableIncome), rate);
  return { taxableIncome: federalTaxableIncome, rate, taxpayerCredit: cents(0), tax };
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

    const state = stateTax(input, agi, taxableIncome, cfg);
    const stateIncomeTax = state.tax;

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
        taxableIncome: state.taxableIncome,
        rate: state.rate,
        taxpayerCredit: state.taxpayerCredit,
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
