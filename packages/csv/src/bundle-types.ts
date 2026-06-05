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
};

export type RetirementContributionRow = Dated & {
  date: string;
  account: string;
  amountCents: number;
  notes: string | null;
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
});
