import { makeCrudRepo } from "./crud.ts";
import { profileRepo } from "./profile.ts";
import {
  client,
  entity,
  expense,
  history as historyTable,
  homeOffice,
  income,
  mileage,
  retirementContribution,
  spouse,
  timeEntry,
  vehicle,
  type ClientInsert,
  type ClientRow,
  type EntityInsert,
  type EntityRow,
  type ExpenseInsert,
  type ExpenseRow,
  type HistoryRow,
  type HomeOfficeInsert,
  type HomeOfficeRow,
  type IncomeInsert,
  type IncomeRow,
  type MileageInsert,
  type MileageRow,
  type RetirementContributionInsert,
  type RetirementContributionRow,
  type SpouseInsert,
  type SpouseRow,
  type TimeEntryInsert,
  type TimeEntryRow,
  type VehicleInsert,
  type VehicleRow,
} from "../schema/index.ts";
import { getDb } from "../client.ts";
import { and, asc, eq } from "drizzle-orm";

export { profileRepo };
export { importBundle, type ImportReason } from "./import.ts";
export { taxYearCacheRepo } from "./tax-year-cache.ts";

export const clientRepo = makeCrudRepo<ClientInsert, ClientRow>(client, "client", {
  orderBy: "name",
});
export const entityRepo = makeCrudRepo<EntityInsert, EntityRow>(entity, "entity", {
  orderBy: "startDate",
});
export const spouseRepo = makeCrudRepo<SpouseInsert, SpouseRow>(spouse, "spouse", {
  orderBy: "startDate",
});
export const incomeRepo = makeCrudRepo<IncomeInsert, IncomeRow>(income, "income", {
  orderBy: "date",
});
export const timeRepo = makeCrudRepo<TimeEntryInsert, TimeEntryRow>(timeEntry, "time_entry", {
  orderBy: "date",
});
export const vehicleRepo = makeCrudRepo<VehicleInsert, VehicleRow>(vehicle, "vehicle", {
  orderBy: "createdAt",
});
export const mileageRepo = makeCrudRepo<MileageInsert, MileageRow>(mileage, "mileage", {
  orderBy: "date",
});
export const homeOfficeRepo = makeCrudRepo<HomeOfficeInsert, HomeOfficeRow>(
  homeOffice,
  "home_office",
  { orderBy: "startDate" },
);
export const expenseRepo = makeCrudRepo<ExpenseInsert, ExpenseRow>(expense, "expense", {
  orderBy: "date",
});
export const retirementRepo = makeCrudRepo<RetirementContributionInsert, RetirementContributionRow>(
  retirementContribution,
  "retirement_contribution",
  { orderBy: "date" },
);

export const historyRepo = {
  async listFor(entityName: string, entityId: string): Promise<HistoryRow[]> {
    const db = getDb();
    return (await db
      .select()
      .from(historyTable)
      .where(and(eq(historyTable.entity, entityName), eq(historyTable.entityId, entityId)))
      .orderBy(asc(historyTable.at))) as HistoryRow[];
  },
  async listAll(): Promise<HistoryRow[]> {
    const db = getDb();
    return (await db.select().from(historyTable).orderBy(asc(historyTable.at))) as HistoryRow[];
  },
};

import type { Bundle } from "../bundle.ts";
import { emptyBundle } from "../bundle.ts";

/**
 * Materialize the Bundle from current DB state.
 *
 * By default only live rows, which is what the screens and the tax estimate
 * want. Pass `includeDeleted` for anything that must carry the whole state:
 * an export or a pre-import snapshot. Leaving soft-deleted rows out of an
 * export would turn a delete into a permanent one after the next restore.
 *
 * Pass `includeHistory` as well for a full export, so a restore brings back
 * the edit log. A pre-import snapshot leaves history out: the snapshot is
 * itself stored as a history entry, and nesting the log inside each of its
 * own entries would grow it without bound.
 */
export const buildBundle = async (
  options: { includeDeleted?: boolean; includeHistory?: boolean } = {},
): Promise<Bundle> => {
  const rows = <T>(repo: { list(): Promise<T[]>; listIncludingDeleted(): Promise<T[]> }) =>
    options.includeDeleted ? repo.listIncludingDeleted() : repo.list();
  const history = options.includeHistory ? await historyRepo.listAll() : [];
  const [
    profileRow,
    entities,
    spouses,
    clients,
    incomeRows,
    timeRows,
    vehicles,
    mileageRows,
    homeOfficeRows,
    expenses,
    retirementRows,
  ] = await Promise.all([
    profileRepo.get(),
    rows(entityRepo),
    rows(spouseRepo),
    rows(clientRepo),
    rows(incomeRepo),
    rows(timeRepo),
    rows(vehicleRepo),
    rows(mileageRepo),
    rows(homeOfficeRepo),
    rows(expenseRepo),
    rows(retirementRepo),
  ]);
  return {
    ...emptyBundle(),
    profile: profileRow,
    entities,
    spouses,
    clients,
    income: incomeRows,
    timeEntries: timeRows,
    vehicles,
    mileage: mileageRows,
    homeOffice: homeOfficeRows,
    expenses,
    retirementContributions: retirementRows,
    history,
  };
};
