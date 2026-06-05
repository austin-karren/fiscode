import type {
  ClientRow,
  EntityRow,
  ExpenseRow,
  HomeOfficeRow,
  IncomeRow,
  MileageRow,
  ProfileRow,
  RetirementContributionRow,
  SpouseRow,
  TimeEntryRow,
  VehicleRow,
} from "./schema/index.ts";

/**
 * The full in-memory state shape. Both @fiscode/csv and @fiscode/tax operate
 * on this. Producing a Bundle is the @fiscode/db's contract with the rest of
 * the app; consuming a Bundle is everyone else's.
 *
 * History is not part of the Bundle by design: CSV does not carry edit history.
 */
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
