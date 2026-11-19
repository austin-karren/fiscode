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
    /** The §199A(e)(2) threshold amount. */
    taxableIncomeLimit: Record<FilingStatus, Cents>;
    /** Width of the §199A(b)(3)(B) phase-in band above the threshold. */
    phaseInRange: Record<FilingStatus, Cents>;
    /** §199A(i) minimum deduction (2026 on); null when it does not apply. */
    minimum: { deduction: Cents; qbiFloor: Cents } | null;
  };
  /**
   * Business standard mileage rates, in dollars per mile, oldest first. Each
   * applies from its `from` date until the next one; the IRS can change the
   * rate mid-year (2026 did on July 1). See `mileageRateOn`.
   */
  mileageRates: Array<{ from: IsoDate; ratePerMile: number }>;
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
    /** The same threshold when this year's filing status is MFS. */
    priorYearAgiThresholdMfs: Cents; // 75,000
  };
  meals: { deductibleFraction: number }; // 0.50
  quarterlyDueDates: [IsoDate, IsoDate, IsoDate, IsoDate];
  stateRates: Partial<Record<StateCode, number>>;
  /**
   * Utah's nonrefundable taxpayer tax credit (Utah Code 59-10-1018; TC-40
   * lines 9-18). With it, Utah tax is the flat rate on Utah taxable income
   * (which starts from federal AGI) minus this credit.
   */
  utahTaxpayerCredit: {
    /** 6% of (federal standard deduction + personal exemptions). */
    creditRate: number;
    /** Utah personal exemption per qualifying dependent. */
    personalExemptionPerDependent: Cents;
    /** The credit shrinks by this much per dollar of income over the base. */
    phaseOutRate: number;
    phaseOutBase: Record<FilingStatus, Cents>;
    /** True when the amounts come from a draft form, not the final one. */
    draft: boolean;
  };
};

export type TaxInput = {
  year: number;
  filingStatus: FilingStatus;
  state: StateCode;
  /** Gross 1099 income (sum of all 1099 income entries for the year). */
  gross1099: Cents;
  /** Total business expenses (excluding half-SE-tax and QBI adjustments). */
  deductibleExpenses: Cents;
  /** Qualifying dependents (Utah personal exemption). Defaults to 0. */
  dependents?: number;
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
  /** Utah: federal AGI (Utah taxable income). Other states: federal taxable income. */
  taxableIncome: Cents;
  rate: number;
  /** Utah's taxpayer tax credit applied; 0 for other states. */
  taxpayerCredit: Cents;
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
  /** The required installment for this due date (Form 2210 line 10). */
  requiredInstallment: Cents;
  /** What is left to pay by this due date after withholding (1/4 per quarter). */
  amount: Cents;
};

export type QuarterlyPlan = {
  method: QuarterlyMethod;
  /**
   * True when the tax left after withholding is under $1,000, so Form 2210
   * requires no installments (lines 4 and 7) and every amount is $0.
   */
  noInstallmentsRequired: boolean;
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
