import { expenseYearExclusion, isBeforeSeStart, type ExpenseForYear } from "./year-inclusion.ts";

/**
 * A startup cost under §195: ticked as startup and paid before the SE start.
 * Self-employed health insurance never is one: it is a Schedule 1 line 17
 * adjustment (Form 7206), and a premium paid before the business began covers no
 * month of self-employment, so it counts nowhere. Equipment never is one either:
 * §195(c)(1)(B) covers an amount which "if paid or incurred in connection with the
 * operation of an existing active trade or business ... would be allowable as a
 * deduction for the taxable year in which paid or incurred", and equipment is
 * capital property, placed in service instead (`countedExpenseDate`).
 */
export const isPreStartStartupCost = (
  expense: Pick<ExpenseForYear, "date" | "startupExpense" | "deletedAt" | "category">,
  seStartDate: string | null | undefined,
): boolean =>
  expense.deletedAt === null &&
  expense.startupExpense === true &&
  expense.category !== "health_insurance" &&
  expense.category !== "equipment" &&
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
 * - the date it counts toward a year on (`expenseYearDate`: its own date, or
 *   for equipment its placed-in-service date) is in `year`, on or after the SE
 *   start date (`expenseYearExclusion`);
 * - so a startup cost paid before the SE start does not count here. Those are deducted as a
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
): T[] => expenses.filter((e) => expenseYearExclusion(e, year, seStartDate) === null);
