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
  /**
   * Self-employed health insurance premiums paid for the year (Form 7206 line 3). Not a Schedule C
   * expense: an adjustment on Schedule 1 line 17, limited by the business's profit. Defaults to 0.
   */
  selfEmployedHealthInsurance?: Cents;
  /** Qualifying dependents (Utah personal exemption). Defaults to 0. */
  dependents?: number;
  /** Spouse W-2 wages, if MFJ + spouse block active for the year. */
  spouseW2Wages: Cents;
  /** Spouse W-2 federal withholding, offsets required estimates. */
  spouseFederalWithholding: Cents;
  /** Spouse W-2 state withholding. */
  spouseStateWithholding: Cents;
  /**
   * Prior year's federal tax (Form 2210 line 8 uses the prior-year federal
   * return), for the safe harbor. Undefined = first year.
   */
  priorYearTotalTax: Cents | undefined;
  /** Prior year AGI, for determining 100% vs 110% safe-harbor multiplier. */
  priorYearAgi: Cents | undefined;
  /** Last year's state tax liability (Utah TC-546 line 4); undefined when not entered. */
  priorYearStateTax?: Cents | undefined;
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
  /** Self-employed health insurance deduction allowed (Schedule 1 line 17, Form 7206 line 14). */
  selfEmployedHealthInsurance: Cents;
  se: SeTaxBreakdown;
  federal: FederalBreakdown;
  state: StateBreakdown;
  spouseWithholding: Cents;
  /** Federal income tax + self-employment tax: Form 2210 lines 1-4. */
  federalLiability: Cents;
  /** Federal withholding only: Form 2210 line 6. */
  federalWithholding: Cents;
  /** State withholding only. */
  stateWithholding: Cents;
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

/**
 * Utah's prepayment minimum (TC-546): due by the return's due date, with no
 * quarterly schedule.
 */
export type StatePrepayment = {
  state: "UT";
  dueDate: IsoDate;
  /** TC-546 line 8: what to pay by `dueDate` after Utah withholding; $0 if none. */
  minimum: Cents;
  /** Which TC-546 line 5 amount was used: line 3 (90% of this year's) or line 4 (last year's). */
  basis: "currentYear90" | "priorYear";
};

export type SafeHarborResult = {
  currentYearTarget: Cents; // 90% of current federal tax
  priorYearTarget: Cents | undefined; // 100% or 110% of prior tax
  /** The lower of the two targets; meeting this avoids underpayment penalty. */
  floor: Cents;
  multiplierUsed: number | undefined;
  /**
   * Why that multiplier: last year's AGI over the threshold (110%), not over it (100%), or not
   * entered (110%, since it might be over). Undefined in the first-year fallback.
   */
  multiplierReason?: "agi_over_threshold" | "agi_not_over_threshold" | "agi_not_entered";
  firstYear: boolean;
};

export type IncomePeriod = {
  /** End date of the annualization period (inclusive). */
  endsAt: IsoDate;
  /** Cumulative gross 1099 income earned through endsAt. */
  cumulativeGross1099: Cents;
  /** Cumulative deductible expenses through endsAt. */
  cumulativeDeductibleExpenses: Cents;
  /** Cumulative self-employed health insurance premiums through endsAt. Defaults to 0. */
  cumulativeSelfEmployedHealthInsurance?: Cents;
};

export type AnnualizedInput = TaxInput & {
  periods: [IncomePeriod, IncomePeriod, IncomePeriod, IncomePeriod];
};
