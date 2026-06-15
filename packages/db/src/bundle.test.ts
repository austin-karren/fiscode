import { describe, expect, it } from "vitest";
import { emptyBundle } from "./bundle.ts";

/**
 * Pin the Bundle shape at the field level. @fiscode/csv mirrors this shape
 * with its own redeclared types; the round-trip test in @fiscode/csv proves
 * row-shape parity end-to-end. This test catches "I added a new top-level
 * field" drift without requiring a cross-package import.
 *
 * If you add a new top-level Bundle field, update both bundles and bump the
 * pinned key list below.
 */
describe("Bundle shape", () => {
  it("has the pinned top-level keys (csv mirror must match)", () => {
    const keys = Object.keys(emptyBundle()).sort();
    expect(keys).toEqual(
      [
        "clients",
        "entities",
        "expenses",
        "homeOffice",
        "income",
        "mileage",
        "profile",
        "retirementContributions",
        "spouses",
        "timeEntries",
        "vehicles",
      ].sort(),
    );
  });

  it("array-typed fields all start empty; profile starts undefined", () => {
    const b = emptyBundle();
    expect(b.profile).toBeUndefined();
    expect(b.entities).toEqual([]);
    expect(b.spouses).toEqual([]);
    expect(b.clients).toEqual([]);
    expect(b.income).toEqual([]);
    expect(b.timeEntries).toEqual([]);
    expect(b.vehicles).toEqual([]);
    expect(b.mileage).toEqual([]);
    expect(b.homeOffice).toEqual([]);
    expect(b.expenses).toEqual([]);
    expect(b.retirementContributions).toEqual([]);
  });
});
