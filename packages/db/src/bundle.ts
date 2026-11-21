import type {
  ClientRow,
  DocumentFolderRow,
  DocumentLinkRow,
  DocumentRow,
  EntityRow,
  EstimatedPaymentRow,
  ExpenseRow,
  HistoryRow,
  HomeOfficeRow,
  IncomeRow,
  MileageRow,
  ProfileRow,
  RetirementContributionRow,
  SpouseRow,
  TimeEntryRow,
  VehicleRow,
  W2JobRow,
} from "./schema/index.ts";

/**
 * The full in-memory state shape. Both @fiscode/csv and @fiscode/tax operate
 * on this. Producing a Bundle is the @fiscode/db's contract with the rest of
 * the app; consuming a Bundle is everyone else's.
 *
 * A Bundle built for a screen or an estimate holds live rows and no history.
 * A Bundle built for a full export holds everything: soft-deleted rows and
 * the edit history too (see `buildBundle`). tax_year_cache is never in it: it
 * is a cache of downloaded tax figures.
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
  w2Jobs: W2JobRow[];
  estimatedPayments: EstimatedPaymentRow[];
  documentFolders: DocumentFolderRow[];
  documents: DocumentRow[];
  documentLinks: DocumentLinkRow[];
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
  w2Jobs: [],
  estimatedPayments: [],
  documentFolders: [],
  documents: [],
  documentLinks: [],
  history: [],
});
