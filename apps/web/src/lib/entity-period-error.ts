import { EntityDatesError, type EntityPeriodError } from "@fiscode/core";

/** A rejected period's message and the date field it is about. */
export type EntityPeriodFieldError = { field: "startDate" | "endDate"; message: string };

/**
 * Where an entity period rejection is shown: an end date before the start on
 * End, an overlap on Start. The message is the repo's own, written for the
 * user.
 *
 * Forms keep it in state and pass it to that field's `TSFormField error`,
 * rather than into TanStack's error map: an error there would disable Save
 * until that same field changes, but an overlap shown on Start can be fixed by
 * changing End.
 */
export const entityPeriodFieldError = (err: EntityPeriodError): EntityPeriodFieldError => ({
  field: err instanceof EntityDatesError ? "endDate" : "startDate",
  message: err.message,
});

/** The message for `field`, if the rejection is about it. */
export const periodErrorFor = (
  error: EntityPeriodFieldError | null,
  field: EntityPeriodFieldError["field"],
): string | undefined => (error?.field === field ? error.message : undefined);
