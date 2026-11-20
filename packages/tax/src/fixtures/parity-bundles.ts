// Test fixtures only (exempt from the type-only @fiscode/csv rule in .oxlintrc.json).
import { exampleBundle, type Bundle } from "@fiscode/csv";

// The scenarios the estimateBundleYear refactor was checked against, invented
// values only. fixtures/parity-*.json hold the numbers main computed for them.

/** The demo data with a July 1 SE start: income and expenses on both sides, plus a startup cost. */
export const midYearBundle = (): Bundle => {
  const b = exampleBundle();
  b.profile = { ...b.profile!, seStartDate: "2026-07-01" };
  const e0 = b.expenses[0]!;
  b.expenses = [
    ...b.expenses,
    {
      ...e0,
      id: "startup-1" as never,
      date: "2026-03-01",
      amountCents: 720_000,
      startupExpense: true,
    },
  ];
  return b;
};

const DELETED = "2026-08-01T00:00:00.000Z";

/**
 * SE start Jul 15: income, an expense and a trip dated exactly on it; deleted income,
 * expense, trip and startup rows; and a live startup cost.
 */
export const edgesBundle = (): Bundle => {
  const b = exampleBundle();
  const start = "2026-07-15";
  b.profile = { ...b.profile!, seStartDate: start };
  const [i0] = b.income;
  const [e0] = b.expenses;
  const [m0] = b.mileage;
  b.income = [
    ...b.income,
    { ...i0!, id: "on-start" as never, date: start, amountCents: 300_000 },
    {
      ...i0!,
      id: "deleted" as never,
      date: "2026-09-01",
      amountCents: 999_900,
      deletedAt: DELETED,
    },
  ];
  b.expenses = [
    ...b.expenses,
    { ...e0!, id: "on-start" as never, date: start, amountCents: 12_345, startupExpense: false },
    { ...e0!, id: "deleted" as never, date: "2026-09-01", amountCents: 88_800, deletedAt: DELETED },
    {
      ...e0!,
      id: "startup" as never,
      date: "2026-02-01",
      amountCents: 610_000,
      startupExpense: true,
    },
    {
      ...e0!,
      id: "startup-deleted" as never,
      date: "2026-03-01",
      amountCents: 400_000,
      startupExpense: true,
      deletedAt: DELETED,
    },
  ];
  b.mileage = [
    ...b.mileage,
    { ...m0!, id: "on-start" as never, date: start, businessMiles: 33 },
    { ...m0!, id: "deleted" as never, date: "2026-09-01", businessMiles: 500, deletedAt: DELETED },
  ];
  return b;
};

/** SE start in the prior year (Nov 20, 2025) with a 2025 startup cost: 2026 amortizes it. */
export const priorYearStartBundle = (): Bundle => {
  const b = exampleBundle();
  b.profile = { ...b.profile!, seStartDate: "2025-11-20" };
  const e0 = b.expenses[0]!;
  b.expenses = [
    ...b.expenses,
    {
      ...e0,
      id: "startup-2025" as never,
      date: "2025-10-01",
      amountCents: 1_800_000,
      startupExpense: true,
    },
  ];
  return b;
};
