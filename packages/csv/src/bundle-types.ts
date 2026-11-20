// The Bundle is the whole exportable state: every data row (soft-deleted ones
// included) plus the edit history. tax_year_cache is not in it: that table is
// a cache of downloaded tax figures and is rebuilt on its own.
//
// Mirror of @fiscode/db's Bundle shape, but redeclared here so this package
// stays independent of @fiscode/db (no React, no DOM, no SQLocal).
//
// The types are intentionally structural matches of the DB rows; if @fiscode/db
// changes a row shape, this needs to be updated to match — a CSV round-trip
// test will fail loudly if they ever drift.

export type ProfileRow = {
  id: string;
  filingStatus: string;
  state: string;
  seStartDate: string;
  dependents: number;
  tracksRoth: boolean;
  usesRetirement: boolean;
  quarterlyMethod: string;
  prepLeadDays: number;
  /** Last year's return, cents; null when not entered (Pub 505; Utah TC-546 line 4). */
  priorYearTotalTaxCents: number | null;
  priorYearAgiCents: number | null;
  priorYearStateTaxCents: number | null;
  /** The tax year of those figures; they count only for the estimate of the year after. */
  priorYearFiguresYear: number | null;
  createdAt: string;
  updatedAt: string;
};

type Dated = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type EntityRow = Dated & {
  type: string;
  startDate: string;
  endDate: string | null;
  notes: string | null;
};

export type SpouseRow = Dated & {
  startDate: string;
  endDate: string | null;
  annualW2WagesCents: number;
  annualFederalWithholdingCents: number;
  annualStateWithholdingCents: number;
  notes: string | null;
};

export type ClientRow = Dated & {
  name: string;
  type: string | null;
  notes: string | null;
  defaultRateCents: number | null;
  defaultCommissionRate: number | null;
};

export type IncomeRow = Dated & {
  date: string;
  clientId: string | null;
  amountCents: number;
  sourceType: string;
  kind: string;
  description: string | null;
  notes: string | null;
};

export type TimeEntryRow = Dated & {
  date: string;
  clientId: string | null;
  minutes: number;
  description: string | null;
  notes: string | null;
};

export type VehicleRow = Dated & {
  make: string;
  model: string;
  year: number | null;
  mpg: number | null;
  method: string;
  inServiceDate: string | null;
  notes: string | null;
};

export type MileageRow = Dated & {
  date: string;
  vehicleId: string | null;
  businessMiles: number;
  purpose: string | null;
  notes: string | null;
};

export type HomeOfficeRow = Dated & {
  startDate: string;
  endDate: string | null;
  method: string;
  officeSqft: number | null;
  homeSqft: number | null;
  monthlyRentMortgageCents: number | null;
  monthlyUtilitiesCents: number | null;
  monthlyInsuranceCents: number | null;
  regularExclusiveAck: boolean;
  notes: string | null;
};

export type ExpenseRow = Dated & {
  date: string;
  amountCents: number;
  category: string;
  clientId: string | null;
  description: string | null;
  reason: string | null;
  notes: string | null;
  flagForSection179: boolean;
  startupExpense: boolean;
  /** Equipment: placed in service on this date (ISO), when not the purchase date. Null = purchase date. */
  placedInServiceDate: string | null;
};

export type RetirementContributionRow = Dated & {
  date: string;
  account: string;
  amountCents: number;
  notes: string | null;
};

/**
 * One entry of the append-only edit log. `beforeJson` / `afterJson` are the
 * row (or, for an import snapshot, the bundle) as JSON text, kept verbatim.
 */
export type HistoryRow = {
  id: string;
  entity: string;
  entityId: string;
  op: string;
  beforeJson: string | null;
  afterJson: string | null;
  at: string;
};

export type Bundle = {
  profile: ProfileRow | undefined;
  entities: EntityRow[];
  spouses: SpouseRow[];
  clients: ClientRow[];
  income: IncomeRow[];
  timeEntries: TimeEntryRow[];
  vehicles: VehicleRow[];
  mileage: MileageRow[];
  homeOffice: HomeOfficeRow[];
  expenses: ExpenseRow[];
  retirementContributions: RetirementContributionRow[];
  /** The edit log. Empty when the bundle was built for a screen or an estimate. */
  history: HistoryRow[];
};

export const emptyBundle = (): Bundle => ({
  profile: undefined,
  entities: [],
  spouses: [],
  clients: [],
  income: [],
  timeEntries: [],
  vehicles: [],
  mileage: [],
  homeOffice: [],
  expenses: [],
  retirementContributions: [],
  history: [],
});
