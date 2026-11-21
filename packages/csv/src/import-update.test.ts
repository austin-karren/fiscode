import { describe, expect, it } from "vitest";
import { applyImport } from "./apply-import.ts";
import { emptyBundle, type Bundle } from "./bundle-types.ts";
import { exampleBundle } from "./example.ts";
import { exportBundle } from "./export.ts";
import { parseCsv } from "./import.ts";
import { planImport, readImportFile } from "./import-plan.ts";

// "Update rows": an accountant's amended file. Rows whose id is here take the
// file's values, new ids are added, nothing is removed, and rows deleted on
// either side keep their state here.

const FIXED = "2026-06-04T12:00:00.000Z";
const LATER = "2026-07-01T12:00:00.000Z";

const app = (): Bundle => exampleBundle();
const clone = (b: Bundle): Bundle => structuredClone(b);

describe("applyImport: update", () => {
  it("takes the file's values for matching ids, adds new ids, removes nothing", () => {
    const existing = app();
    const file = clone(existing);
    file.expenses[0] = { ...file.expenses[0]!, amountCents: 123_45, updatedAt: LATER };
    const added = { ...file.expenses[1]!, id: "exp_new" as never, amountCents: 50_00 };
    file.expenses.push(added);
    file.income = []; // the file lacks every income row: they stay here

    const { next } = applyImport(existing, file, "update");
    expect(next.expenses.find((e) => e.id === existing.expenses[0]!.id)!.amountCents).toBe(123_45);
    expect(next.expenses.find((e) => e.id === "exp_new")).toEqual(added);
    expect(next.income).toEqual(existing.income);
    expect(next.expenses).toHaveLength(existing.expenses.length + 1);
  });

  it("never deletes or brings back a row: deleted state here wins over the file", () => {
    const existing = app();
    existing.expenses[1] = { ...existing.expenses[1]!, deletedAt: FIXED };
    const file = clone(app());
    // Here deleted, file live and changed: stays deleted, unchanged.
    file.expenses[1] = { ...file.expenses[1]!, amountCents: 1_00 };
    // Here live, file deleted: stays live.
    file.expenses[2] = { ...file.expenses[2]!, deletedAt: LATER };

    const { next } = applyImport(existing, file, "update");
    expect(next.expenses[1]).toEqual(existing.expenses[1]);
    expect(next.expenses[2]).toEqual(existing.expenses[2]);
  });

  it("takes the file's profile when it has one; keeps this one otherwise", () => {
    const existing = app();
    const file = clone(existing);
    file.profile = { ...file.profile!, dependents: 2 };
    expect(applyImport(existing, file, "update").next.profile!.dependents).toBe(2);
    expect(applyImport(existing, { ...file, profile: undefined }, "update").next.profile).toEqual(
      existing.profile,
    );
  });

  it("appends the file's history entries as Add rows does", () => {
    const existing = app();
    const entry = {
      id: "h_new",
      entity: "income",
      entityId: "x",
      op: "insert",
      beforeJson: null,
      afterJson: "{}",
      at: FIXED,
    };
    const { next } = applyImport(existing, { ...clone(existing), history: [entry] }, "update");
    expect(next.history).toContainEqual(entry);
  });
});

describe("planImport: update", () => {
  it("counts changed, added and unchanged rows; nothing removed; no refusal", () => {
    const existing = app();
    const file = clone(existing);
    file.expenses[0] = { ...file.expenses[0]!, amountCents: 123_45 };
    file.income[0] = { ...file.income[0]!, description: "Amended" };
    file.expenses.push({ ...file.expenses[1]!, id: "exp_new" as never });

    const plan = planImport(existing, file, "update");
    const fileRows =
      1 +
      file.entities.length +
      file.spouses.length +
      file.clients.length +
      file.income.length +
      file.timeEntries.length +
      file.vehicles.length +
      file.mileage.length +
      file.homeOffice.length +
      file.expenses.length +
      file.retirementContributions.length;
    expect(plan.changed).toBe(2);
    expect(plan.written).toEqual({ live: 1, deleted: 0, history: 0 });
    expect(plan.unchanged).toBe(fileRows - 2 - 1);
    expect(plan.removed).toEqual({ live: 0, deleted: 0 });
    expect(plan.refusal).toBeUndefined();
    expect(plan.snapshot).toBe(true);
  });

  it("counts rows whose deleted state keeps them as they are here", () => {
    const existing = app();
    existing.expenses[1] = { ...existing.expenses[1]!, deletedAt: FIXED };
    const file = clone(app());
    file.expenses[1] = { ...file.expenses[1]!, amountCents: 1_00 };
    file.expenses[2] = { ...file.expenses[2]!, deletedAt: LATER };
    const plan = planImport(existing, file, "update");
    expect(plan.keptDeleted).toBe(1);
    expect(plan.keptLive).toBe(1);
    expect(plan.changed).toBe(0);
  });

  it("accepts a yearly file (the point of the mode); Restore of it over data stays refused", () => {
    const existing = app();
    const yearly = exportBundle(existing, { scope: "yearly", year: 2026 });
    const read = readImportFile(yearly);
    if (!read.ok) throw new Error("expected a readable file");
    expect(read.scope).toBe("yearly");
    expect(planImport(existing, read.bundle, "update", read).refusal).toBeUndefined();
    expect(planImport(existing, read.bundle, "restore", read).refusal).toBeDefined();
  });

  it("the app's own full export over the same data changes nothing", () => {
    const existing = app();
    const { bundle } = parseCsv(exportBundle(existing, { scope: "full" }));
    const plan = planImport(existing, bundle, "update");
    expect(plan.changed).toBe(0);
    expect(plan.written).toEqual({ live: 0, deleted: 0, history: 0 });
    expect(applyImport(existing, bundle, "update").next).toEqual(existing);
  });
});

describe("planImport warnings: values the forms would not accept (Add rows, Update rows)", () => {
  const withRows = (mutate: (b: Bundle) => void): { existing: Bundle; file: Bundle } => {
    const existing = app();
    const file = clone(existing);
    mutate(file);
    return { existing, file };
  };

  it("names negative amounts and negative miles, with spreadsheet rows, and counts them", () => {
    const { existing, file } = withRows((b) => {
      b.expenses[0] = { ...b.expenses[0]!, amountCents: -45_00 };
      b.mileage[0] = { ...b.mileage[0]!, businessMiles: -12 };
    });
    const csv = exportBundle(file, { scope: "full" });
    const read = readImportFile(csv);
    if (!read.ok) throw new Error("expected a readable file");
    const plan = planImport(existing, read.bundle, "update", read);
    expect(plan.warnings.outOfRange.count).toBe(2);
    expect(plan.warnings.outOfRange.summary).toMatch(/negative amounts/);
    expect(plan.warnings.outOfRange.summary).toMatch(/negative miles/);
    const expenseLine = csv.split("\r\n").findIndex((l) => l.includes(",-45.00,")) + 1;
    expect(plan.warnings.outOfRange.rows).toContain(
      `Row ${expenseLine} (expense): amount -$45.00 is negative. The form needs more than $0.`,
    );
    expect(
      plan.warnings.outOfRange.rows.some((r) =>
        /\(mileage\): business_miles -12 is negative\. The form needs 1 to 9,999\./.test(r),
      ),
    ).toBe(true);
  });

  it("names $0 where more than $0 is needed, $100,000,000 or more, and whole numbers out of range", () => {
    const { existing, file } = withRows((b) => {
      b.income[0] = { ...b.income[0]!, amountCents: 0 };
      b.expenses[0] = { ...b.expenses[0]!, amountCents: 100_000_000_00 };
      b.mileage[0] = { ...b.mileage[0]!, businessMiles: 10_000 };
      b.profile = { ...b.profile!, dependents: 100 };
    });
    const plan = planImport(existing, file, "update");
    expect(plan.warnings.outOfRange.count).toBe(4);
    const all = plan.warnings.outOfRange.rows.join("\n");
    expect(all).toMatch(/\(income\): amount \$0\.00 is \$0\. The form needs more than \$0\./);
    expect(all).toMatch(/amount \$100,000,000\.00 is \$100,000,000 or more/);
    expect(all).toMatch(/business_miles 10000 is outside 1 to 9,999/);
    expect(all).toMatch(/\(profile\): dependents 100 is outside 0 to 99/);
  });

  it("checks only rows the mode writes: Add rows skips rows already here; Restore never warns", () => {
    const { existing, file } = withRows((b) => {
      b.expenses[0] = { ...b.expenses[0]!, amountCents: -1_00 }; // id already here
    });
    expect(planImport(existing, file, "append").warnings.outOfRange.count).toBe(0);
    expect(planImport(existing, file, "update").warnings.outOfRange.count).toBe(1);
    expect(planImport(existing, file, "restore").warnings.outOfRange.count).toBe(0);
    file.expenses.push({ ...file.expenses[0]!, id: "exp_new" as never });
    expect(planImport(existing, file, "append").warnings.outOfRange.count).toBe(1);
  });

  it("lists the first few rows and counts the rest", () => {
    const { existing, file } = withRows((b) => {
      for (let i = 0; i < 7; i++) {
        b.expenses.push({ ...b.expenses[0]!, id: `exp_neg_${i}` as never, amountCents: -1_00 });
      }
    });
    const w = planImport(existing, file, "append").warnings.outOfRange;
    expect(w.count).toBe(7);
    expect(w.rows).toHaveLength(5);
  });
});

describe("planImport warnings: overlapping entity periods (Add rows, Update rows)", () => {
  const period = (id: string, startDate: string, endDate: string | null) => ({
    id: id as never,
    type: "sole_prop",
    startDate,
    endDate,
    notes: null,
    createdAt: FIXED,
    updatedAt: FIXED,
    deletedAt: null,
  });

  it("names both periods when an added period overlaps a live one", () => {
    const existing: Bundle = { ...app(), entities: [period("ent_a", "2026-01-01", null)] };
    const file: Bundle = { ...emptyBundle(), entities: [period("ent_b", "2026-06-01", null)] };
    const plan = planImport(existing, file, "append");
    expect(plan.warnings.overlaps).toEqual([
      "The file's Sole proprietor period that started Jun 1, 2026 and is still open overlaps your Sole proprietor period that started Jan 1, 2026 and is still open.",
    ]);
  });

  it("an updated period that now overlaps is named; one that doesn't is not; Restore never warns", () => {
    const existing: Bundle = {
      ...app(),
      entities: [period("ent_a", "2026-01-01", "2026-05-31"), period("ent_b", "2026-06-01", null)],
    };
    const file: Bundle = {
      ...emptyBundle(),
      entities: [period("ent_a", "2026-01-01", "2026-07-31")],
    };
    expect(planImport(existing, file, "update").warnings.overlaps).toHaveLength(1);
    expect(planImport(existing, file, "restore").warnings.overlaps).toEqual([]);
    const fine: Bundle = {
      ...emptyBundle(),
      entities: [period("ent_a", "2026-01-01", "2026-06-01")],
    };
    expect(planImport(existing, fine, "update").warnings.overlaps).toEqual([]);
  });
});

describe("Update rows takes only the columns the file's format has (review #78 r1)", () => {
  // The app holds prior-year figures and a placed-in-service date; the file is the app's own
  // yearly export, unedited, written in an older format that lacks those columns.
  const withNewerFields = (): Bundle => {
    const b = app();
    b.profile = {
      ...b.profile!,
      priorYearTotalTaxCents: 3_000_00,
      priorYearAgiCents: 100_000_00,
      priorYearStateTaxCents: 500_00,
      priorYearFiguresYear: 2025,
      priorYearNotFiled: false,
    };
    b.w2Jobs = [
      {
        id: "w2_kept",
        taxYear: 2026,
        employer: "Demo Employer Inc",
        startDate: null,
        endDate: null,
        wagesCents: 18_000_00,
        federalWithholdingCents: 500_00,
        ssWagesCents: 18_000_00,
        ssTaxWithheldCents: 1_116_00,
        medicareWagesCents: 18_000_00,
        ssTipsCents: 0,
        stateWagesCents: 18_000_00,
        stateWithholdingCents: 300_00,
        notes: null,
        createdAt: FIXED,
        updatedAt: FIXED,
        deletedAt: null,
      },
    ];
    b.estimatedPayments = [
      {
        id: "ep_kept",
        date: "2026-04-15",
        amountCents: 400_00,
        jurisdiction: "federal",
        taxYear: 2026,
        appliedQuarter: null,
        notes: null,
        createdAt: FIXED,
        updatedAt: FIXED,
        deletedAt: null,
      },
    ];
    const i = b.expenses.findIndex((e) => e.category === "equipment");
    b.expenses[i] = { ...b.expenses[i]!, placedInServiceDate: "2026-02-01" };
    return b;
  };
  // Drop a format's newer columns from every header and row, and mark the file with its version.
  const asOlder = (csv: string, version: string, drop: string[]): string => {
    const lines = csv.split("\r\n");
    let cut: number[] = [];
    return lines
      .map((l) => {
        if (l.startsWith("﻿# fiscode export") || l.startsWith("# fiscode export")) {
          return l.replace(/schema: v\d+/, `schema: ${version}`);
        }
        if (l.startsWith("record_type,")) {
          const cols = l.split(",");
          cut = drop.map((d) => cols.indexOf(d)).filter((i) => i >= 0);
          return cols.filter((_, i) => !cut.includes(i)).join(",");
        }
        if (l === "" || l.startsWith("#")) return l;
        return l
          .split(",")
          .filter((_, i) => !cut.includes(i))
          .join(",");
      })
      .join("\r\n");
  };
  const V5 = ["prior_year_not_filed"];
  // A v4 file has no w2_job or estimated_payment sections at all.
  const withoutV5Sections = (csv: string): string =>
    csv
      .split("\r\n")
      .filter((l) => !/^(w2_job|estimated_payment),/.test(l))
      .join("\r\n");
  const PRIOR = [
    ...V5,
    "prior_year_total_tax",
    "prior_year_agi",
    "prior_year_state_tax",
    "prior_year_figures_year",
  ];

  it.each([
    ["v4", V5],
    ["v3", PRIOR],
    ["v2", [...PRIOR, "placed_in_service_date"]],
  ])("an unedited %s yearly file changes nothing and keeps the newer fields", (version, drop) => {
    const existing = withNewerFields();
    const csv = asOlder(
      withoutV5Sections(exportBundle(existing, { scope: "yearly", year: 2026 })),
      version,
      drop,
    );
    const read = readImportFile(csv);
    if (!read.ok) throw new Error(`expected a readable file: ${read.headline}`);
    const plan = planImport(existing, read.bundle, "update", read);
    expect(plan.changed).toBe(0);
    const { next } = applyImport(existing, read.bundle, "update", read);
    expect(next.profile).toEqual(existing.profile);
    expect(next.expenses).toEqual(existing.expenses);
    expect(next.w2Jobs).toEqual(existing.w2Jobs);
    expect(next.estimatedPayments).toEqual(existing.estimatedPayments);
  });

  it("an edit in an older file still applies; the columns it lacks stay as they are here", () => {
    const existing = withNewerFields();
    const edited = clone(existing);
    edited.profile = { ...edited.profile!, dependents: 2 };
    const csv = asOlder(exportBundle(edited, { scope: "yearly", year: 2026 }), "v3", PRIOR);
    const read = readImportFile(csv);
    if (!read.ok) throw new Error("expected a readable file");
    expect(planImport(existing, read.bundle, "update", read).changed).toBe(1);
    const { next } = applyImport(existing, read.bundle, "update", read);
    expect(next.profile).toEqual({ ...existing.profile!, dependents: 2 });
  });
});

describe("review #78 r1 nits: years without separators; retirement and DF-07 amounts checked", () => {
  it("a model year out of range prints as 1900 to <next year>, not 1,900", () => {
    const existing = app();
    const file = clone(existing);
    file.vehicles[0] = { ...file.vehicles[0]!, year: 1800 };
    const rows = planImport(existing, file, "update").warnings.outOfRange.rows.join("\n");
    expect(rows).toMatch(
      /model_year 1800 is outside 1900 to \d{4}\. The form needs 1900 to \d{4}\./,
    );
  });
  it("a negative retirement contribution, a negative W-2 box and a $0 payment warn", () => {
    const existing = app();
    const file = clone(existing);
    file.retirementContributions[0] = { ...file.retirementContributions[0]!, amountCents: -1_00 };
    file.w2Jobs = [
      {
        id: "w2_new",
        taxYear: 2026,
        employer: "Demo Employer Inc",
        startDate: null,
        endDate: null,
        wagesCents: -5_00,
        federalWithholdingCents: 0,
        ssWagesCents: 0,
        ssTaxWithheldCents: 0,
        medicareWagesCents: 0,
        ssTipsCents: 0,
        stateWagesCents: 0,
        stateWithholdingCents: 0,
        notes: null,
        createdAt: FIXED,
        updatedAt: FIXED,
        deletedAt: null,
      },
    ];
    file.estimatedPayments = [
      {
        id: "ep_new",
        date: "2026-04-15",
        amountCents: 0,
        jurisdiction: "federal",
        taxYear: 2026,
        appliedQuarter: null,
        notes: null,
        createdAt: FIXED,
        updatedAt: FIXED,
        deletedAt: null,
      },
    ];
    const rows = planImport(existing, file, "update").warnings.outOfRange.rows.join("\n");
    expect(rows).toMatch(
      /\(retirement_contribution\): amount -\$1\.00 is negative\. The form needs more than \$0\./,
    );
    expect(rows).toMatch(/\(w2_job\): wages -\$5\.00 is negative\. The form needs \$0 or more\./);
    expect(rows).toMatch(
      /\(estimated_payment\): amount \$0\.00 is \$0\. The form needs more than \$0\./,
    );
  });
});

describe("columns are per row, not per record type (review #78 r2)", () => {
  it("two expense sections, the second without placed_in_service_date: changed 0, the date kept", () => {
    const existing = app();
    const i = existing.expenses.findIndex((e) => e.category === "equipment");
    existing.expenses[i] = { ...existing.expenses[i]!, placedInServiceDate: "2026-02-01" };
    const csv = exportBundle(existing, { scope: "full" });
    // Move the equipment row into a second expense table whose header lacks the column.
    const lines = csv.split("\r\n");
    const header = lines.find((l) => l.startsWith("record_type,date,category"))!;
    const cols = header.split(",");
    const cut = cols.indexOf("placed_in_service_date");
    const row = lines.find((l) => l.includes(existing.expenses[i]!.id))!;
    const drop = (l: string) =>
      l
        .split(",")
        .filter((_, k) => k !== cut)
        .join(",");
    const rest = lines.filter((l) => l !== row);
    const second = ["", "# Expenses (more)", drop(header), drop(row)];
    const file = [...rest.slice(0, -1), ...second, ""].join("\r\n");
    const read = readImportFile(file);
    if (!read.ok) throw new Error(`expected a readable file: ${read.headline}`);
    expect(planImport(existing, read.bundle, "update", read).changed).toBe(0);
    const { next } = applyImport(existing, read.bundle, "update", read);
    expect(next.expenses[i]!.placedInServiceDate).toBe("2026-02-01");
    expect(planImport(existing, read.bundle, "update", read).warnings.outOfRange.count).toBe(0);
  });
});
