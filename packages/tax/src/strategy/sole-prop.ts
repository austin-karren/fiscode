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

    const own = input.ownW2;
    // Additional Medicare threshold for SE income (Form 8959 Part II): reduced "by the total
    // amount of Medicare wages received" (https://www.irs.gov/instructions/i8959). On a joint
    // return that is both spouses' Medicare wages: the filer's own box 5, and the spouse's annual
    // W-2 wages, the spouse block's only wage figure, standing in for their box 5. The spouse's
    // wages are already 0 on any other return (engine.ts, spouseOnJointReturn).
    const se = computeSeTax(netProfit, input.filingStatus, cfg, {
      ssWages: own?.ssWages,
      medicareWages: addCents(own?.medicareWages ?? cents(0), input.spouseW2Wages),
    });

    // Self-employed health insurance, Form 7206 (2025), https://www.irs.gov/pub/irs-pdf/f7206.pdf:
    // line 14 "Enter the smaller of line 3 [premiums] or line 13", where line 13 is the net profit
    // (line 4) less the deductible part of SE tax (line 7; one business, so line 6 is 100%) less
    // SEP/SIMPLE contributions (line 9; not modelled, so 0). It goes "on Schedule 1 (Form 1040),
    // line 17": AGI, not net profit. "You can't subtract the self-employed health insurance
    // deduction when figuring net earnings for your self-employment tax" (i7206), so `se` above
    // is figured without it.
    const sehiLimit = clampMinZero(subCents(netProfit, se.halfSeTaxDeduction));
    const premiums = input.selfEmployedHealthInsurance ?? cents(0);
    const selfEmployedHealthInsurance = premiums < sehiLimit ? premiums : sehiLimit;

    // AGI ≈ net profit + W-2 wages (own, Form 1040 line 1a; the spouse's on a joint return)
    // − half SE tax − SE health insurance. Other adjustments (HSA, retirement) are not modelled.
    const agi = clampMinZero(
      subCents(
        addCents(netProfit, input.spouseW2Wages, own?.wages ?? cents(0)),
        addCents(se.halfSeTaxDeduction, selfEmployedHealthInsurance),
      ),
    );

    const stdDeduction = cfg.standardDeduction[input.filingStatus];
    const taxableIncomeBeforeQbi = clampMinZero(subCents(agi, stdDeduction));

    // QBI base = net profit minus the deductions attributable to the business: half SE tax and
    // SE health insurance. Reg. 1.199A-3(b)(1)(vi): "deductions such as the deductible portion of
    // the tax on self-employment income under section 164(f), the self-employed health insurance
    // deduction under section 162(l) ... are considered attributable to a trade or business".
    const qbiBase = clampMinZero(
      subCents(netProfit, addCents(se.halfSeTaxDeduction, selfEmployedHealthInsurance)),
    );
    const qbiDeduction = computeQbi(qbiBase, taxableIncomeBeforeQbi, input.filingStatus, cfg);

    const taxableIncome = clampMinZero(subCents(taxableIncomeBeforeQbi, qbiDeduction));

    const federalIncomeTax = computeFederalBracketTax(taxableIncome, input.filingStatus, cfg);

    const state = stateTax(input, agi, taxableIncome, cfg);
    const stateIncomeTax = state.tax;

    const totalLiability = addCents(federalIncomeTax, se.totalSeTax, stateIncomeTax);

    const federalWithholding = addCents(
      input.spouseFederalWithholding,
      own?.federalWithholding ?? cents(0),
    );
    const stateWithholding = addCents(
      input.spouseStateWithholding,
      own?.stateWithholding ?? cents(0),
    );
    const totalWithholding = addCents(federalWithholding, stateWithholding);

    return {
      year: input.year,
      netProfit,
      agi,
      selfEmployedHealthInsurance,
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
      federalLiability: addCents(federalIncomeTax, se.totalSeTax),
      federalWithholding,
      stateWithholding,
      totalLiability,
      remainingOwed: clampMinZero(subCents(totalLiability, totalWithholding)),
    };
  },
  quarterly(
    input: TaxInput | AnnualizedInput,
    cfg: YearConfig,
    method: QuarterlyMethod,
    requiredAnnualPayment: Cents,
  ): QuarterlyPlan {
    if (method === "annualized") {
      if (!("periods" in input)) {
        throw new Error("annualized method requires AnnualizedInput.periods");
      }
      return annualizedQuarterly(input, cfg, soleProprietorStrategy, requiredAnnualPayment);
    }
    return evenQuarterly(
      this.compute(input, cfg),
      cfg,
      requiredAnnualPayment,
      input.estimatedPayments?.federal ?? [],
    );
  },
};
