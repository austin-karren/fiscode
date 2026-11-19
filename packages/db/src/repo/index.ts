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
import {
  EntityDatesError,
  EntityOverlapError,
  endsBeforeStart,
  findEntityOverlap,
} from "@fiscode/core";

export { profileRepo };
export { importBundle, type ImportReason } from "./import.ts";
export { taxYearCacheRepo } from "./tax-year-cache.ts";

export const clientRepo = makeCrudRepo<ClientInsert, ClientRow>(client, "client", {
  orderBy: "name",
});
const entityCrud = makeCrudRepo<EntityInsert, EntityRow>(entity, "entity", {
  orderBy: "startDate",
});

type PeriodDates = Pick<EntityRow, "startDate" | "endDate">;

/**
 * Throws when the period would break a rule: `EntityDatesError` for an end
 * before the start, `EntityOverlapError` for an overlap with another live one.
 *
 * `before` is the stored row when this is an edit. It decides whether an
 * overlap was already there, which changes the message.
 *
 * Limit: the check reads, then the caller writes, as two steps. fiscode is one
 * user in one tab; two tabs saving at the same moment could both pass.
 */
const assertPeriodAllowed = async (
  candidate: PeriodDates & { id?: string },
  before?: EntityRow,
): Promise<void> => {
  if (endsBeforeStart(candidate)) throw new EntityDatesError(candidate);
  const live = await entityCrud.list();
  const conflict = findEntityOverlap(live, candidate);
  if (!conflict) return;
  const preexisting =
    before !== undefined &&
    !before.deletedAt &&
    findEntityOverlap([conflict], { ...before, id: undefined }) !== null;
  throw new EntityOverlapError(conflict, { preexisting });
};

// An open end is after every date; ISO dates compare as strings.
const endOf = (p: PeriodDates) => p.endDate ?? "9999-12-31";

/**
 * Entity periods, with two rules on every write that can place a live period
 * (`create`, `update`, `revertTo`): the end is not before the start, and the
 * period does not overlap another live one. A write that breaks one rejects
 * with an `EntityPeriodError` from @fiscode/core (`EntityDatesError` or
 * `EntityOverlapError`). See `findEntityOverlap` for what counts as an overlap.
 *
 * An update that only shrinks a period (start not earlier, end not later than
 * the stored row), or changes no date, is never rejected for an overlap: it
 * cannot add one. That is what lets a user with two overlapping periods end
 * either of them.
 *
 * An import does not go through here. `importBundle` writes a file's rows as
 * they are, because a restore must reproduce the file exactly, overlapping or
 * inverted periods included. Such periods stay until the user edits them.
 */
export const entityRepo = {
  ...entityCrud,
  async create(input: Parameters<typeof entityCrud.create>[0]): Promise<EntityRow> {
    if (!input.deletedAt) {
      await assertPeriodAllowed({ startDate: input.startDate, endDate: input.endDate ?? null });
    }
    return entityCrud.create(input);
  },
  async update(
    id: string,
    patch: Parameters<typeof entityCrud.update>[1],
  ): Promise<EntityRow | undefined> {
    const before = (await entityCrud.listIncludingDeleted()).find((row) => row.id === id);
    if (before) {
      const after = { ...before, ...patch };
      const revived = Boolean(before.deletedAt) && !after.deletedAt;
      const datesChanged = after.startDate !== before.startDate || after.endDate !== before.endDate;
      // Stored rows that already break a rule (they can come from a file) stay
      // editable in every way that does not place the period anew.
      if (!after.deletedAt && (revived || datesChanged)) {
        const shrinks =
          !revived && after.startDate >= before.startDate && endOf(after) <= endOf(before);
        if (endsBeforeStart(after)) throw new EntityDatesError(after);
        if (!shrinks) await assertPeriodAllowed(after, before);
      }
    }
    return entityCrud.update(id, patch);
  },
  async revertTo(id: string, snapshot: EntityRow): Promise<EntityRow | undefined> {
    if (!snapshot.deletedAt) await assertPeriodAllowed({ ...snapshot, id });
    return entityCrud.revertTo(id, snapshot);
  },
};
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
