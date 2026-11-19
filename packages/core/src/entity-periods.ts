import { ENTITY_TYPE_LABELS, labelFor } from "./labels.ts";

// The rule that a business has one entity type at a time. Pure: the database
// layer enforces it on every write, and a form can call it to check early.

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
 *   is not an overlap; it belongs to the later period, which is also the one
 *   the estimate picks. This is what "End today", then adding the next period
 *   starting today, produces.
 * - Two periods that start on the same day always overlap, even one-day ones.
 * - The entity type does not matter: a business is one type at a time, so a
 *   sole proprietor period and an LLC period over the same days conflict.
 *
 * Periods with `deletedAt` set are ignored. A period with the candidate's own
 * `id` is ignored too, so editing a period never conflicts with itself.
 *
 * When several periods conflict, the one that starts first is returned.
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

/**
 * The sentence shown when a save is blocked. It names the other period the way
 * the user knows it (type label and dates) and says what to do next.
 */
export const entityOverlapMessage = (conflict: EntityPeriod): string => {
  const label = labelFor(ENTITY_TYPE_LABELS, conflict.type);
  const start = formatDisplayDate(conflict.startDate);
  return conflict.endDate === null
    ? `This overlaps your ${label} period that started ${start} and is still open. End that period first, or change these dates.`
    : `This overlaps your ${label} period from ${start} to ${formatDisplayDate(conflict.endDate)}. Change these dates so the two do not overlap. A period may start on the day the other one ends.`;
};

/**
 * Thrown by the entity repo when a write would overlap another period.
 * `message` is `entityOverlapMessage(conflict)`, ready to show as it is.
 */
export class EntityOverlapError extends Error {
  override readonly name = "EntityOverlapError";
  readonly conflict: EntityPeriod;

  constructor(conflict: EntityPeriod) {
    super(entityOverlapMessage(conflict));
    this.conflict = conflict;
  }
}
