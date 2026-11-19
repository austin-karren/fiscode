import { expensesCountedForYear, type ExpenseForYear } from "@fiscode/core";

/**
 * The year-end packet's expense breakdown: totals in cents per category, over
 * the same expenses that make up its "Direct expenses" line
 * (`expensesCountedForYear`), so the two always agree.
 */
export const expenseTotalsByCategory = (
  expenses: readonly (ExpenseForYear & { category: string; amountCents: number })[],
  year: number,
  seStartDate: string | null | undefined,
): Record<string, number> => {
  const totals: Record<string, number> = {};
  for (const e of expensesCountedForYear(expenses, year, seStartDate)) {
    totals[e.category] = (totals[e.category] ?? 0) + e.amountCents;
  }
  return totals;
};
