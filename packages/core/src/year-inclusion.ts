/** The fields of a row (income, expense, mileage) that decide whether it counts toward a tax year. */
export type RowForYear = {
  date: string;
  deletedAt: string | null;
};

/** Why a row does not count toward a year, or null when it counts. */
export type YearExclusion = "deleted" | "other_year" | "before_se_start";

/**
 * Whether a row dated `date` is dated before the SE start. With no SE start
 * (null or blank: legacy data, a broken import) nothing is before it.
 */
export const isBeforeSeStart = (date: string, seStartDate: string | null | undefined): boolean =>
  Boolean(seStartDate) && date < seStartDate!;

/**
 * Why `row` does not count toward `year`, or null when it counts. A row counts
 * when it is live, dated in `year` (the `YYYY` of its ISO date), and dated on or
 * after the SE start. A null or blank `seStartDate` is read as January 1 of
 * `year`, so every live row dated in the year counts. Rows that do not count
 * stay in the user's data; the dashboard and the row badges say why.
 *
 * The estimate, the year-end packet and the badges all use this rule, so they
 * cannot disagree. Startup costs paid before the SE start are excluded here
 * too: §195 deducts them as a group (`startupDeductionBetween`).
 */
export const yearExclusion = (
  row: RowForYear,
  year: number,
  seStartDate: string | null | undefined,
): YearExclusion | null => {
  if (row.deletedAt !== null) return "deleted";
  if (row.date.slice(0, 4) !== String(year)) return "other_year";
  if (isBeforeSeStart(row.date, seStartDate)) return "before_se_start";
  return null;
};

/** Whether `row` counts toward `year` (see `yearExclusion`). */
export const countsInYear = (
  row: RowForYear,
  year: number,
  seStartDate: string | null | undefined,
): boolean => yearExclusion(row, year, seStartDate) === null;

/** The rows that count toward `year`, in their given order (see `yearExclusion`). */
export const countedInYear = <T extends RowForYear>(
  rows: readonly T[],
  year: number,
  seStartDate: string | null | undefined,
): T[] => rows.filter((r) => countsInYear(r, year, seStartDate));
