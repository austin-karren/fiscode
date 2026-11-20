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

/** The fields of an expense that decide whether it counts toward a tax year. */
export type ExpenseForYear = {
  date: string;
  deletedAt: string | null;
  startupExpense?: boolean | null;
  /** Equipment: the date it was placed in service, when not the purchase date. */
  placedInServiceDate?: string | null;
  /** The expense category; health insurance is never a startup cost. */
  category?: string;
};

/**
 * The date an expense counts on.
 * - Equipment counts on the date it is placed in service: its stored
 *   placed-in-service date, or its purchase date when none is stored, and
 *   never before the SE start. Pub 946 (https://www.irs.gov/publications/p946):
 *   "You begin to depreciate your property when you place it in service for use
 *   in your trade or business"; property converted to business use is placed in
 *   service "on the date of the change", so equipment bought before the business
 *   began counts on the SE start date (the date the form prefills).
 * - A startup expense (Section 195) paid before the SE start counts on the SE
 *   start date: IRC §195(b)(1)(A) allows the deduction "for the taxable year in
 *   which the active trade or business begins"
 *   (https://www.govinfo.gov/link/uscode/26/195).
 * - Every other expense counts on its own date. A placed-in-service date on a
 *   row that isn't equipment (possible only from a CSV) is ignored.
 */
export const countedExpenseDate = (
  expense: Pick<ExpenseForYear, "date" | "startupExpense" | "placedInServiceDate" | "category">,
  seStartDate: string | null | undefined,
): string => {
  if (expense.category === "equipment") {
    const placed = expense.placedInServiceDate || expense.date;
    return seStartDate && placed < seStartDate ? seStartDate : placed;
  }
  if (
    expense.startupExpense === true &&
    expense.category !== "health_insurance" &&
    seStartDate &&
    expense.date < seStartDate
  ) {
    return seStartDate;
  }
  return expense.date;
};

/**
 * The date an expense counts toward a year on: equipment counts on the date it
 * is placed in service (`countedExpenseDate`), every other expense on its own
 * date. A startup cost paid before the SE start stays on its own date, so it is
 * excluded here and deducted as a group under §195 (`startupDeductionBetween`).
 */
export const expenseYearDate = (
  expense: Pick<ExpenseForYear, "date" | "placedInServiceDate" | "category">,
  seStartDate: string | null | undefined,
): string =>
  expense.category === "equipment" ? countedExpenseDate(expense, seStartDate) : expense.date;

/** `yearExclusion` for an expense, on the date it counts toward a year on (`expenseYearDate`). */
export const expenseYearExclusion = (
  expense: ExpenseForYear,
  year: number,
  seStartDate: string | null | undefined,
): YearExclusion | null =>
  yearExclusion(
    { date: expenseYearDate(expense, seStartDate), deletedAt: expense.deletedAt },
    year,
    seStartDate,
  );
