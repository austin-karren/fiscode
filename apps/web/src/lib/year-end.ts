import type { Bundle } from "@fiscode/csv";
import { countedInYear, expensesCountedForYear, type ExpenseForYear } from "@fiscode/core";
import { getYearConfig, mileageRateOn } from "@fiscode/tax";

/**
 * The year-end packet's Schedule C expense breakdown: totals in cents per
 * category, over the same expenses that make up its "Direct expenses" line
 * (`expensesCountedForYear`), so the two always agree. Self-employed health
 * insurance is left out, as it is from Direct expenses.
 */
export const expenseTotalsByCategory = (
  expenses: readonly (ExpenseForYear & { category: string; amountCents: number })[],
  year: number,
  seStartDate: string | null | undefined,
): Record<string, number> => {
  const totals: Record<string, number> = {};
  for (const e of expensesCountedForYear(expenses, year, seStartDate)) {
    // Not Schedule C: a Schedule 1 line 17 adjustment, on its own line.
    if (e.category === "health_insurance") continue;
    totals[e.category] = (totals[e.category] ?? 0) + e.amountCents;
  }
  return totals;
};

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

/**
 * The year-end packet's lists, over the rows behind its totals
 * (`countedInYear`): the 1099 income, oldest first; 1099 income per client,
 * largest first, with income that has no client on its own line; and the
 * mileage log, oldest first, each trip with the rate in force on its date.
 * Per-trip dollars are left out: the deduction is rounded once per rate, so
 * per-trip amounts would not add up to it.
 */
export const yearEndLists = (
  bundle: Pick<Bundle, "income" | "mileage">,
  year: number,
  seStartDate: string,
) => {
  const income = countedInYear(
    bundle.income.filter((i) => i.sourceType === "1099"),
    year,
    seStartDate,
  ).sort(byDate);

  const totals = new Map<string | null, number>();
  for (const i of income) totals.set(i.clientId, (totals.get(i.clientId) ?? 0) + i.amountCents);
  const clientTotals = [...totals]
    .map(([clientId, amountCents]) => ({ clientId, amountCents }))
    .sort((a, b) =>
      a.clientId === null ? 1 : b.clientId === null ? -1 : b.amountCents - a.amountCents,
    );

  const cfg = getYearConfig(year);
  const mileage = countedInYear(bundle.mileage, year, seStartDate)
    .sort(byDate)
    .map((t) => ({ ...t, ratePerMile: mileageRateOn(cfg, t.date) }));

  return { income, clientTotals, mileage };
};
