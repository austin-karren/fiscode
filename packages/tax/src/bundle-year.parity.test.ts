import { describe, expect, it } from "vitest";
import { exampleBundle, type Bundle } from "@fiscode/csv";

import { estimateBundleYear } from "./bundle-year.ts";
import demo from "./fixtures/parity-demo.json";
import midyear from "./fixtures/parity-midyear.json";

// The scenarios the estimateBundleYear refactor was checked against (invented
// values only). Each runs both quarterly methods.

/** The demo data with a July 1 SE start: income and expenses on both sides, plus a startup cost. */
const midYearBundle = (): Bundle => {
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

const runScenario = (b: Bundle) => {
  const out: Record<string, unknown> = {};
  for (const method of ["even", "annualized"] as const) {
    out[method] = estimateBundleYear(
      { ...b, profile: { ...b.profile!, quarterlyMethod: method } },
      2026,
    ).result;
  }
  // activeEntityType was renamed entityType when entityUnsupported was added.
  const {
    entityType,
    entityUnsupported: _unsupported,
    ...derived
  } = estimateBundleYear(b, 2026).derived;
  out.derived = { ...derived, activeEntityType: entityType };
  return out;
};

// Parity gate: the numbers recorded on main before estimateBundleYear existed
// (fixtures/parity-*.json). A change here changes a number the app shows.
describe("estimateBundleYear parity", () => {
  it("demo data: every total, quarterly amount and the safe harbor match", () => {
    expect(runScenario(exampleBundle())).toEqual(demo);
  });
  it("SE start Jul 1 with rows on both sides and a startup cost: everything matches", () => {
    expect(runScenario(midYearBundle())).toEqual(midyear);
  });
});
