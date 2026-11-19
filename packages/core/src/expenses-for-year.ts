/** The fields of an expense that decide whether it counts toward a tax year. */
export type ExpenseForYear = {
  date: string;
  deletedAt: string | null;
  startupExpense?: boolean | null;
};

/**
 * The date an expense counts on. A startup expense (Section 195) paid before
 * the SE start counts on the SE start date: IRC §195(b)(1)(A) allows the
 * deduction "for the taxable year in which the active trade or business begins"
 * (https://www.law.cornell.edu/uscode/text/26/195). Every other expense counts
 * on its own date. With no SE start, every expense counts on its own date.
 */
export const countedExpenseDate = (
  expense: Pick<ExpenseForYear, "date" | "startupExpense">,
  seStartDate: string | null | undefined,
): string =>
  expense.startupExpense === true && seStartDate && expense.date < seStartDate
    ? seStartDate
    : expense.date;

/**
 * The expenses that count toward `year`'s Schedule C, in their given order.
 *
 * An expense counts when all of these hold:
 * - it is not deleted (`deletedAt` is null);
 * - its counted date (`countedExpenseDate`) is in `year` (by the `YYYY`);
 * - that date is on or after the SE start date.
 *
 * So a startup expense (Section 195) paid before the business began counts in
 * the year the business begins, whatever year it was paid in, and never in the
 * year it was paid if that is earlier. A startup expense dated on or after the
 * SE start is an ordinary expense of its own year.
 *
 * Not modelled: §195(b) allows at most $5,000 in that year (reduced by the
 * amount over $50,000) and amortizes the rest over 180 months; fiscode deducts
 * the whole amount.
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
  return expenses.filter((e) => {
    if (e.deletedAt !== null) return false;
    const date = countedExpenseDate(e, seStartDate);
    return date.slice(0, 4) === yearPrefix && date >= floor;
  });
};
