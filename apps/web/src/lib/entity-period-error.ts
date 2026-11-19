import { EntityDatesError, type EntityPeriodError } from "@fiscode/core";

/** The fields of a saved period that decide whether a refusal still holds. */
type SavedPeriod = {
  id: string;
  type: string;
  startDate: string;
  endDate: string | null;
  deletedAt: string | null;
};

/** A rejected period's message and the date field it is about. */
export type EntityPeriodFieldError = {
  field: "startDate" | "endDate";
  message: string;
  /** The saved periods when it was refused; see `periodErrorFor`. */
  periodsKey?: string;
};

// The live periods' dates and types, in a stable order.
const keyOf = (periods: readonly SavedPeriod[]): string =>
  JSON.stringify(
    periods
      .filter((p) => p.deletedAt === null)
      .map((p) => [p.id, p.type, p.startDate, p.endDate])
      .sort(),
  );

/**
 * Where an entity period rejection is shown: an end date before the start on
 * End, an overlap on Start. The message is the repo's own, written for the
 * user.
 *
 * Forms keep it in state and pass it to that field's `TSFormField error`,
 * rather than into TanStack's error map: an error there would disable Save
 * until that same field changes, but an overlap shown on Start can be fixed by
 * changing End.
 *
 * Pass the saved `periods` when the form sits beside them (the add-period
 * card): an overlap is about those rows, so the message lapses once one of
 * them is ended, edited or deleted.
 */
export const entityPeriodFieldError = (
  err: EntityPeriodError,
  periods?: readonly SavedPeriod[],
): EntityPeriodFieldError => ({
  field: err instanceof EntityDatesError ? "endDate" : "startDate",
  message: err.message,
  periodsKey: periods ? keyOf(periods) : undefined,
});

/**
 * The message for `field`, if the rejection is about it and still holds: a
 * message taken with `periods` is dropped when the saved periods now differ.
 * Derived on each render; nothing is synced into state.
 */
export const periodErrorFor = (
  error: EntityPeriodFieldError | null,
  field: EntityPeriodFieldError["field"],
  periods?: readonly SavedPeriod[],
): string | undefined => {
  if (error?.field !== field) return undefined;
  if (error.periodsKey !== undefined && periods && keyOf(periods) !== error.periodsKey) {
    return undefined;
  }
  return error.message;
};
