import { describe, expect, it } from "vitest";
import { exampleBundle, type Bundle } from "@fiscode/csv";

import { estimateBundleYear } from "./bundle-year.ts";
import { edgesBundle, midYearBundle, priorYearStartBundle } from "./fixtures/parity-bundles.ts";
import demo from "./fixtures/parity-demo.json";
import edges from "./fixtures/parity-edges.json";
import midyear from "./fixtures/parity-midyear.json";
import priorYearStart from "./fixtures/parity-prior-year-start.json";

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

// Parity gate: the numbers main computed before estimateBundleYear existed
// (fixtures/parity-*.json). A change here changes a number the app shows.
describe("estimateBundleYear parity", () => {
  it("demo data: every total, quarterly amount and the safe harbor match", () => {
    expect(runScenario(exampleBundle())).toEqual(demo);
  });
  it("SE start Jul 1 with rows on both sides and a startup cost", () => {
    expect(runScenario(midYearBundle())).toEqual(midyear);
  });
  it("rows on the SE start date, deleted rows of every kind, a deleted startup cost", () => {
    expect(runScenario(edgesBundle())).toEqual(edges);
  });
  it("SE start in the prior year with a prior-year startup cost", () => {
    expect(runScenario(priorYearStartBundle())).toEqual(priorYearStart);
  });
});
