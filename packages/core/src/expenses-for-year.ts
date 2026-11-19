/** The fields of an expense that decide whether it counts toward a tax year. */
export type ExpenseForYear = {
  date: string;
  deletedAt: string | null;
  startupExpense?: boolean | null;
};

/**
 * The expenses that count toward `year`'s Schedule C, in their given order.
 *
 * An expense counts when all of these hold:
 * - it is not deleted (`deletedAt` is null);
 * - it is dated in `year` (by the `YYYY` of its ISO date);
 * - it is dated on or after the SE start date, or it is a startup expense
 *   (Section 195): costs paid before the business began are deductible once it
 *   is active, so a startup expense dated in `year` counts even before the SE
 *   start date. A startup expense dated in an earlier year never counts here.
 *
 * A null or blank `seStartDate` is read as January 1 of `year`, so every live
 * expense dated in the year counts. The estimate and the year-end packet both
 * use this, so their totals cannot disagree.
 */
export const expensesCountedForYear = <T extends ExpenseForYear>(
  expenses: readonly T[],
  year: number,
  seStartDate: string | null | undefined,
): T[] => {
  const yearPrefix = String(year);
  const floor = seStartDate || `${yearPrefix}-01-01`;
  return expenses.filter(
    (e) =>
      e.deletedAt === null &&
      e.date.slice(0, 4) === yearPrefix &&
      (e.date >= floor || e.startupExpense === true),
  );
};
