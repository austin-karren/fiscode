import type { Cents, FilingStatus, IsoDate, QuarterlyMethod, StateCode } from "@fiscode/core";

export type Bracket = { upTo: Cents | null; rate: number };

export type YearConfig = {
  year: number;
  standardDeduction: Record<FilingStatus, Cents>;
  ssWageBase: Cents;
  seTax: {
    netEarningsFactor: number; // 0.9235
    ssRate: number; // 0.124
    medicareRate: number; // 0.029
    addlMedicareRate: number; // 0.009
    addlMedicareThreshold: Record<FilingStatus, Cents>;
  };
  brackets: Record<FilingStatus, Bracket[]>;
  qbi: {
    rate: number; // 0.20
    taxableIncomeLimit: Record<FilingStatus, Cents>;
  };
  mileageRatePerMile: number; // dollars per business mile
  homeOffice: {
    simplifiedRatePerSqft: Cents;
    simplifiedMaxSqft: number;
    simplifiedCap: Cents;
  };
  safeHarbor: {
    currentYearFraction: number; // 0.90
    priorYearDefault: number; // 1.00
    priorYearHighIncome: number; // 1.10
    priorYearAgiThreshold: Cents; // 150,000
  };
  meals: { deductibleFraction: number }; // 0.50
  quarterlyDueDates: [IsoDate, IsoDate, IsoDate, IsoDate];
  stateRates: Partial<Record<StateCode, number>>;
};

export type TaxInput = {
  year: number;
  filingStatus: FilingStatus;
  state: StateCode;
  /** Gross 1099 income (sum of all 1099 income entries for the year). */
  gross1099: Cents;
  /** Total business expenses (excluding half-SE-tax and QBI adjustments). */
  deductibleExpenses: Cents;
  /** Spouse W-2 wages, if MFJ + spouse block active for the year. */
  spouseW2Wages: Cents;
  /** Spouse W-2 federal withholding, offsets required estimates. */
  spouseFederalWithholding: Cents;
  /** Spouse W-2 state withholding. */
  spouseStateWithholding: Cents;
  /** Prior year total tax liability, for safe-harbor calc. Undefined = first year. */
  priorYearTotalTax: Cents | undefined;
  /** Prior year AGI, for determining 100% vs 110% safe-harbor multiplier. */
  priorYearAgi: Cents | undefined;
};

export type SeTaxBreakdown = {
  netSeEarnings: Cents; // gross1099 * 0.9235 (when entity is sole-prop)
  socialSecurityTax: Cents;
  medicareTax: Cents;
  additionalMedicareTax: Cents;
  regularSeTax: Cents; // SS + Medicare (the half-deductible portion)
  totalSeTax: Cents;
  halfSeTaxDeduction: Cents;
};

export type FederalBreakdown = {
  taxableIncome: Cents; // after standard deduction, QBI, half-SE-tax
  qbiDeduction: Cents;
  federalIncomeTax: Cents;
};

export type StateBreakdown = {
  taxableIncome: Cents; // approximation: federal taxable for now
  rate: number;
  stateIncomeTax: Cents;
};

export type TaxEstimate = {
  year: number;
  netProfit: Cents; // gross1099 - deductibleExpenses
  agi: Cents; // for safe-harbor classification
  se: SeTaxBreakdown;
  federal: FederalBreakdown;
  state: StateBreakdown;
  spouseWithholding: Cents;
  totalLiability: Cents;
  remainingOwed: Cents; // totalLiability minus spouseWithholding
};

export type QuarterPayment = {
  quarter: 1 | 2 | 3 | 4;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
  amount: Cents;
};

export type QuarterlyPlan = {
  method: QuarterlyMethod;
  payments: [QuarterPayment, QuarterPayment, QuarterPayment, QuarterPayment];
};

export type SafeHarborResult = {
  currentYearTarget: Cents; // 90% of current liability
  priorYearTarget: Cents | undefined; // 100% or 110% of prior tax
  /** The lower of the two targets; meeting this avoids underpayment penalty. */
  floor: Cents;
  multiplierUsed: number | undefined;
  firstYear: boolean;
};

export type IncomePeriod = {
  /** End date of the annualization period (inclusive). */
  endsAt: IsoDate;
  /** Cumulative gross 1099 income earned through endsAt. */
  cumulativeGross1099: Cents;
  /** Cumulative deductible expenses through endsAt. */
  cumulativeDeductibleExpenses: Cents;
};

export type AnnualizedInput = TaxInput & {
  periods: [IncomePeriod, IncomePeriod, IncomePeriod, IncomePeriod];
};
