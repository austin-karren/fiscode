import { ENTITY_TYPE_LABELS, labelFor } from "./labels.ts";

// The rules for entity periods: a business has one entity type at a time, and
// a period does not end before it starts. Pure: the database layer enforces
// them on every write, and a form can call them to check early.

/** The fields of an entity period this rule reads. A database row fits. */
export type EntityPeriod = {
  id?: string;
  type: string;
  /** ISO `YYYY-MM-DD`. */
  startDate: string;
  /** ISO `YYYY-MM-DD`, or null for a period that is still open. */
  endDate: string | null;
  deletedAt?: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * An ISO date as the app's date pickers show it: `2024-01-01` -> `Jan 1, 2024`.
 * Built from the string, with no Date object, so no timezone can move the day.
 * Text that is not an ISO date is returned unchanged.
 */
export const formatDisplayDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${Number(m[3])}, ${m[1]}` : iso;
};

/**
 * Find a period that `candidate` would overlap, or null when it fits.
 *
 * Interval rules, taken from how the app already reads these dates:
 *
 * - `startDate` and `endDate` are both days the period covers (the tax code
 *   treats a period as covering a year when `startDate <= Dec 31` and
 *   `endDate >= Jan 1`).
 * - `endDate: null` means open-ended: the period covers every day from its
 *   start on.
 * - One period may start on the day another ends. That shared changeover day
 *   is not an overlap. This is what "End today", then adding the next period
 *   starting today, produces. It is safe because the estimate never reads one
 *   day from two periods: it picks a single period per calendar year, the one
 *   with the latest start among those that reach into the year.
 * - Two periods that start on the same day always overlap, even one-day ones.
 * - The entity type does not matter: a business is one type at a time, so a
 *   sole proprietor period and an LLC period over the same days conflict.
 *
 * Periods with `deletedAt` set are ignored. A period with the candidate's own
 * `id` is ignored too, so editing a period never conflicts with itself.
 *
 * When several periods conflict, the one that starts first is returned.
 *
 * A candidate whose end is before its start is not this function's business:
 * it covers no day and overlaps nothing here. Reject it with
 * `endsBeforeStart` first, as the entity repo does.
 */
export const findEntityOverlap = <T extends EntityPeriod>(
  periods: readonly T[],
  candidate: Pick<EntityPeriod, "id" | "startDate" | "endDate">,
): T | null => {
  // ISO dates compare correctly as strings. An open end is after every date.
  const end = (p: Pick<EntityPeriod, "endDate">) => p.endDate ?? "9999-12-31";
  const conflicts = periods.filter((other) => {
    if (other.deletedAt) return false;
    if (candidate.id !== undefined && other.id === candidate.id) return false;
    if (other.startDate === candidate.startDate) return true;
    return other.startDate < end(candidate) && candidate.startDate < end(other);
  });
  if (conflicts.length === 0) return null;
  return conflicts.reduce((first, p) => (p.startDate < first.startDate ? p : first));
};

/** True when a period has an end date that is before its start date. */
export const endsBeforeStart = (period: Pick<EntityPeriod, "startDate" | "endDate">): boolean =>
  period.endDate !== null && period.endDate < period.startDate;

/** The sentence shown when a save is blocked because the dates are in the wrong order. */
export const entityDatesMessage = (period: Pick<EntityPeriod, "startDate" | "endDate">): string =>
  `The end date (${formatDisplayDate(period.endDate ?? "")}) is before the start date (${formatDisplayDate(period.startDate)}). Pick an end date on or after the start date, or leave it empty for a period that is still open.`;

/** A period the way the user knows it: type label and dates. */
export const describeEntityPeriod = (period: EntityPeriod): string => {
  const label = labelFor(ENTITY_TYPE_LABELS, period.type);
  const start = formatDisplayDate(period.startDate);
  return period.endDate === null
    ? `${label} period that started ${start} and is still open`
    : `${label} period from ${start} to ${formatDisplayDate(period.endDate)}`;
};

/**
 * The sentence shown when a save is blocked by an overlap. It names the other
 * period the way the user knows it (type label and dates) and says what to do.
 *
 * `preexisting` is for a period that already overlapped the other one before
 * this change (two such periods can come from a file, or from before this rule
 * existed). "End that period first" would then send the user back and forth,
 * so the message says how to separate the two instead.
 */
export const entityOverlapMessage = (
  conflict: EntityPeriod,
  options: { preexisting?: boolean } = {},
): string => {
  const other = describeEntityPeriod(conflict);
  if (options.preexisting) {
    return `This period already overlaps your ${other}, and these dates would not separate them. End one of the two on or before the day the other one starts. Ending either of them is always allowed.`;
  }
  return conflict.endDate === null
    ? `This overlaps your ${other}. End that period first, or change these dates. A period may start on the day the other one ends.`
    : `This overlaps your ${other}. Change these dates so the two do not overlap. A period may start on the day the other one ends.`;
};

/**
 * The base of every rejection the entity repo raises on purpose. `message` is
 * written for the user and can be shown as it is.
 */
export class EntityPeriodError extends Error {
  override readonly name: string = "EntityPeriodError";
}

/** Thrown by the entity repo when a write would overlap another period. */
export class EntityOverlapError extends EntityPeriodError {
  override readonly name = "EntityOverlapError";
  readonly conflict: EntityPeriod;
  /** True when the two periods already overlapped before this write. */
  readonly preexisting: boolean;

  constructor(conflict: EntityPeriod, options: { preexisting?: boolean } = {}) {
    super(entityOverlapMessage(conflict, options));
    this.conflict = conflict;
    this.preexisting = options.preexisting ?? false;
  }
}

/** Thrown by the entity repo when a period's end date is before its start date. */
export class EntityDatesError extends EntityPeriodError {
  override readonly name = "EntityDatesError";

  constructor(period: Pick<EntityPeriod, "startDate" | "endDate">) {
    super(entityDatesMessage(period));
  }
}

/**
 * Why a write of `candidate` would be rejected, or null when it is allowed.
 * The one rule the entity repo enforces and a form checks early, so the two
 * cannot disagree.
 *
 * `live` is every stored period (deleted ones are ignored). `before` is the
 * stored row when this is an edit of a live period; an overlap with a period
 * it already overlapped is "pre-existing" (such pairs come from a file, or
 * from before this rule existed).
 *
 * - An end before the start: `EntityDatesError`.
 * - An overlap the write adds: `EntityOverlapError` naming that period.
 * - Only pre-existing overlaps: allowed when the edit only shortens the
 *   period (start not earlier, end not later than stored), so either of two
 *   overlapping periods can always be ended. Otherwise `EntityOverlapError`
 *   (preexisting) naming the earliest.
 * - Any overlap a shortening creates is still rejected: moving a start onto
 *   the day it ends, when the next period starts that day, leaves two periods
 *   with one start day.
 */
export const periodProblem = (
  live: readonly EntityPeriod[],
  candidate: Pick<EntityPeriod, "id" | "startDate" | "endDate">,
  before?: Pick<EntityPeriod, "startDate" | "endDate">,
): EntityPeriodError | null => {
  if (endsBeforeStart(candidate)) return new EntityDatesError(candidate);
  const endOf = (p: Pick<EntityPeriod, "endDate">) => p.endDate ?? "9999-12-31";
  // Every conflict, not only the first: one may be old and another new.
  const conflicts = live
    .filter((other) => findEntityOverlap([other], candidate) !== null)
    .toSorted((x, y) => (x.startDate < y.startDate ? -1 : x.startDate > y.startDate ? 1 : 0));
  if (conflicts.length === 0) return null;
  const overlappedBefore = (other: EntityPeriod): boolean =>
    before !== undefined && findEntityOverlap([other], { ...before, id: undefined }) !== null;
  const added = conflicts.find((other) => !overlappedBefore(other));
  if (added) return new EntityOverlapError(added, { preexisting: false });
  const shrinks =
    before !== undefined &&
    candidate.startDate >= before.startDate &&
    endOf(candidate) <= endOf(before);
  if (shrinks) return null;
  return new EntityOverlapError(conflicts[0]!, { preexisting: true });
};

/** `periodProblem` for moving a stored period's start to `newStart`. */
export const canMoveEntityStart = (
  live: readonly EntityPeriod[],
  period: EntityPeriod,
  newStart: string,
): EntityPeriodError | null => periodProblem(live, { ...period, startDate: newStart }, period);
