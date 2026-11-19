import { isoToDate } from "../components/forms/date-picker";

const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

/**
 * A date as every table and card shows it, in the date picker's style:
 * "Nov 18, 2026". A stored date-only string ("2026-11-18") is read as that
 * local calendar day (`isoToDate`), never as UTC midnight, which would show
 * the day before west of UTC. A string that is not a date is returned as is.
 */
export const formatDate = (value: Date | string): string => {
  const date = typeof value === "string" ? isoToDate(value) : value;
  return date ? date.toLocaleDateString("en-US", DATE) : (value as string);
};

/** A stored timestamp in local time with the time of day: "Nov 18, 2026, 9:33 PM". */
export const formatDateTime = (value: Date | string): string =>
  new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
