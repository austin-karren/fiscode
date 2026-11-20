import { countedInYear, isBeforeSeStart } from "./year-inclusion.ts";

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
 * (https://www.govinfo.gov/link/uscode/26/195). Every other expense counts on
 * its own date. With no SE start, every expense counts on its own date.
 *
 * The yearly CSV uses this to put a startup cost in the year it counts.
 */
export const countedExpenseDate = (
  expense: Pick<ExpenseForYear, "date" | "startupExpense">,
  seStartDate: string | null | undefined,
): string =>
  expense.startupExpense === true && seStartDate && expense.date < seStartDate
    ? seStartDate
    : expense.date;

/** A startup cost under §195: ticked as startup and paid before the SE start. */
export const isPreStartStartupCost = (
  expense: Pick<ExpenseForYear, "date" | "startupExpense" | "deletedAt">,
  seStartDate: string | null | undefined,
): boolean =>
  expense.deletedAt === null &&
  expense.startupExpense === true &&
  isBeforeSeStart(expense.date, seStartDate);

const isoFirstOfMonth = (monthIndex: number): string => {
  const y = Math.floor(monthIndex / 12);
  const m = (monthIndex % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
};

/**
 * The startup-cost deduction that falls within [from, to] (inclusive ISO dates),
 * in cents. IRC §195(b)(1) (https://www.govinfo.gov/link/uscode/26/195):
 * "(A) the taxpayer shall be allowed a deduction for the taxable year in which
 * the active trade or business begins in an amount equal to the lesser of— (i)
 * the amount of start-up expenditures with respect to the active trade or
 * business, or (ii) $5,000, reduced (but not below zero) by the amount by which
 * such start-up expenditures exceed $50,000, and (B) the remainder of such
 * start-up expenditures shall be allowed as a deduction ratably over the
 * 180-month period beginning with the month in which the active trade or
 * business begins."
 *
 * The start-year amount counts on the SE start date. The remainder counts
 * 1/180 a month: the start month on the SE start date, every later month on its
 * first day. A year is the window Jan 1 – Dec 31; an annualized period ends at
 * its cutoff.
 */
export const startupDeductionBetween = (
  expenses: readonly (ExpenseForYear & { amountCents: number })[],
  seStartDate: string | null | undefined,
  from: string,
  to: string,
): number => {
  if (!seStartDate) return 0;
  const total = expenses
    .filter((e) => isPreStartStartupCost(e, seStartDate))
    .reduce((sum, e) => sum + e.amountCents, 0);
  if (total <= 0) return 0;
  const first = Math.max(0, Math.min(total, 500_000 - Math.max(0, total - 5_000_000)));
  const amortized = total - first;
  const startMonth = Number(seStartDate.slice(0, 4)) * 12 + Number(seStartDate.slice(5, 7)) - 1;
  // Everything deducted through `date`, rounded once. A window takes the difference, so
  // the windows over the 180 months add up to the total exactly, with no rounding drift.
  const through = (date: string): number => {
    if (date < seStartDate) return 0;
    let months = 0;
    for (let k = 0; k < 180; k++) {
      const counted = k === 0 ? seStartDate : isoFirstOfMonth(startMonth + k);
      if (counted <= date) months++;
    }
    return first + Math.round((amortized * months) / 180);
  };
  return through(to) - through(dayBeforeIso(from));
};

const dayBeforeIso = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
};

/**
 * The expenses that count toward `year`'s Schedule C one by one, in their given
 * order. An expense counts when all of these hold:
 * - it is not deleted (`deletedAt` is null);
 * - it is dated in `year` (by the `YYYY` of its ISO date);
 * - it is dated on or after the SE start date;
 * - it is not a startup cost paid before the SE start. Those are deducted as a
 *   group under §195(b) (`startupDeductionBetween`): at most $5,000 in the year
 *   the business begins, the rest over 180 months.
 *
 * A startup expense dated on or after the SE start is an ordinary expense of its
 * own year.
 *
 * A null or blank `seStartDate` is read as January 1 of `year`, so every live
 * expense dated in the year counts. The estimate and the year-end packet both
 * use this, so their totals cannot disagree.
 */
export const expensesCountedForYear = <T extends ExpenseForYear>(
  expenses: readonly T[],
  year: number,
  seStartDate: string | null | undefined,
): T[] => countedInYear(expenses, year, seStartDate);
