import { describe, expect, it } from "vitest";
import { emptyBundle, type Bundle } from "./bundle-types.ts";
import { exportBundle } from "./export.ts";
import { countRows, planImport, readImportFile } from "./import-plan.ts";

const FIXED = "2026-06-04T12:00:00.000Z";

const profile = () => ({
  id: "profile",
  filingStatus: "single",
  state: "UT",
  seStartDate: "2024-01-01",
  dependents: 0,
  tracksRoth: false,
  usesRetirement: false,
  quarterlyMethod: "annualized",
  prepLeadDays: 14,
  createdAt: FIXED,
  updatedAt: FIXED,
});

const income = (id: string, date: string, deletedAt: string | null = null) => ({
  id,
  date,
  clientId: null,
  amountCents: 100_00,
  sourceType: "1099",
  kind: "recurring",
  description: null,
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt,
});

const historyRow = (id: string) => ({
  id,
  entity: "income",
  entityId: "in_1",
  op: "insert",
  beforeJson: null,
  afterJson: "{}",
  at: FIXED,
});

const state = (): Bundle => ({
  ...emptyBundle(),
  profile: profile(),
  income: [
    income("in_2025", "2025-03-01"),
    income("in_2026", "2026-03-01"),
    income("in_gone", "2026-04-01", FIXED),
  ],
  history: [historyRow("h_1"), historyRow("h_2")],
});

describe("readImportFile", () => {
  it("refuses text that is not a fiscode file, in plain words", () => {
    const file = readImportFile("hello world");
    expect(file).toMatchObject({
      ok: false,
      headline: "This is not a fiscode file. Nothing was imported.",
      errors: [],
    });
  });

  it("refuses an empty file and a spreadsheet with other columns", () => {
    expect(readImportFile("")).toMatchObject({ ok: false, errors: [] });
    expect(readImportFile("name,amount\r\nDesk,12.00\r\n")).toMatchObject({
      ok: false,
      headline: "This is not a fiscode file. Nothing was imported.",
    });
  });

  it("refuses a file that has headers and no rows", () => {
    const headersOnly =
      "# fiscode export (schema: v2; scope: full)\r\n\r\nrecord_type,date,amount,id\r\n";
    expect(readImportFile(headersOnly)).toMatchObject({
      ok: false,
      headline: "This file has no rows. Nothing was imported.",
    });
    // The export of an empty app is such a file.
    expect(readImportFile(exportBundle(emptyBundle(), { scope: "full" })).ok).toBe(false);
  });

  it("lists every rejected row with its spreadsheet row number", () => {
    const csv = [
      "record_type,date,amount,id",
      "income,1/15/2026,10.00,in_1",
      "income,2026-01-16,12.345,in_2",
      "income,2026-01-17,10.00,in_3",
    ].join("\r\n");
    const file = readImportFile(csv);
    expect(file.ok).toBe(false);
    if (file.ok) return;
    expect(file.headline).toBe("Nothing was imported. 2 rows need fixing.");
    expect(file.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it("refuses an id used twice in one table, naming both rows", () => {
    const csv = [
      "record_type,date,amount,id",
      "income,2026-01-15,10.00,in_1",
      "income,2026-01-16,20.00,in_2",
      "income,2026-01-17,30.00,in_1",
    ].join("\r\n");
    const file = readImportFile(csv);
    expect(file.ok).toBe(false);
    if (file.ok) return;
    expect(file.headline).toBe("Nothing was imported. 1 row needs fixing.");
    expect(file.errors).toHaveLength(1);
    expect(file.errors[0]).toMatchObject({ line: 4, recordType: "income" });
    expect(file.errors[0]!.message).toBe(
      'id: "in_1" is also used on row 2. Each income row needs its own id',
    );
  });

  it("allows one id in two different tables", () => {
    const csv = [
      "record_type,date,amount,id",
      "income,2026-01-15,10.00,shared_1",
      "",
      "record_type,date,category,amount,id",
      "expense,2026-01-16,supplies,20.00,shared_1",
    ].join("\r\n");
    expect(readImportFile(csv)).toMatchObject({ ok: true, counts: { live: 2 } });
  });

  it("passes the newer-schema message through as the reason", () => {
    const file = readImportFile("# fiscode export (schema: v9; scope: full)\r\nrecord_type,id\r\n");
    expect(file.ok).toBe(false);
    if (file.ok) return;
    expect(file.errors).toHaveLength(1);
    expect(file.errors[0]!.message).toContain("newer fiscode");
  });

  it("reads a full export: scope, and live, deleted and history counts", () => {
    const file = readImportFile(exportBundle(state(), { scope: "full" }));
    expect(file).toMatchObject({
      ok: true,
      scope: "full",
      counts: { live: 3, deleted: 1, history: 2 },
    });
  });

  it("reads a yearly export as yearly, with its year", () => {
    const file = readImportFile(exportBundle(state(), { scope: "yearly", year: 2026 }));
    expect(file).toMatchObject({
      ok: true,
      scope: "yearly",
      year: 2026,
      counts: { live: 2, deleted: 0, history: 0 },
    });
  });
});

describe("planImport", () => {
  it("restore into an empty database writes the file and records no snapshot", () => {
    const plan = planImport(emptyBundle(), state(), "restore", { scope: "full" });
    expect(plan).toMatchObject({
      written: { live: 3, deleted: 1, history: 2 },
      removed: { live: 0, deleted: 0 },
      snapshot: false,
      refusal: undefined,
    });
  });

  it("restore counts live and deleted rows apart, and the rows it removes", () => {
    const existing: Bundle = {
      ...emptyBundle(),
      profile: profile(),
      income: [income("in_2026", "2026-03-01"), income("in_only_here", "2026-05-01")],
      history: [historyRow("h_1")],
    };
    const plan = planImport(existing, state(), "restore", { scope: "full" });
    expect(plan.current).toEqual({ live: 3, deleted: 0, history: 1 });
    expect(plan.written).toEqual({ live: 3, deleted: 1, history: 1 });
    expect(plan.removed).toEqual({ live: 1, deleted: 0 });
    expect(plan.snapshot).toBe(true);
    expect(plan.refusal).toBeUndefined();
  });

  it("refuses to restore from a yearly file over existing data, naming the loss", () => {
    const yearly = readImportFile(exportBundle(state(), { scope: "yearly", year: 2026 }));
    if (!yearly.ok) throw new Error("yearly file should parse");
    const plan = planImport(state(), yearly.bundle, "restore", yearly);
    // in_2025 (another year) and in_gone (a deleted row) are not in the file.
    expect(plan.removed).toEqual({ live: 1, deleted: 1 });
    expect(plan.refusal).toContain("yearly file for 2026");
    expect(plan.refusal).toContain("remove 2 rows");
  });

  it("refuses a yearly file over data without inventing a loss when no row would go", () => {
    const yearly = readImportFile(exportBundle(state(), { scope: "yearly", year: 2026 }));
    if (!yearly.ok) throw new Error("yearly file should parse");
    // The app holds exactly the rows of the file.
    const plan = planImport(yearly.bundle, yearly.bundle, "restore", yearly);
    expect(plan.removed).toEqual({ live: 0, deleted: 0 });
    expect(plan.refusal).toContain("yearly file for 2026");
    expect(plan.refusal).not.toContain("remove");
  });

  it("allows a yearly file into an empty database, and in append mode", () => {
    const yearly = readImportFile(exportBundle(state(), { scope: "yearly", year: 2026 }));
    if (!yearly.ok) throw new Error("yearly file should parse");
    expect(planImport(emptyBundle(), yearly.bundle, "restore", yearly).refusal).toBeUndefined();
    expect(planImport(state(), yearly.bundle, "append", yearly).refusal).toBeUndefined();
  });

  it("append counts what is added and what is skipped, the profile included", () => {
    const existing: Bundle = {
      ...emptyBundle(),
      profile: profile(),
      income: [income("in_2026", "2026-03-01")],
    };
    const plan = planImport(existing, state(), "append");
    expect(plan.written).toEqual({ live: 1, deleted: 1, history: 2 });
    // The profile and in_2026 are already here.
    expect(plan.skipped).toBe(2);
    expect(plan.removed).toEqual({ live: 0, deleted: 0 });
  });
});

describe("planImport: entity periods added by Add rows", () => {
  const entity = (id: string, deletedAt: string | null = null) => ({
    id,
    type: "single_member_llc",
    startDate: "2026-11-02",
    endDate: null,
    notes: null,
    createdAt: FIXED,
    updatedAt: FIXED,
    deletedAt,
  });

  it("counts the live entity periods that would be added, not the skipped or deleted ones", () => {
    const existing: Bundle = {
      ...emptyBundle(),
      profile: profile(),
      entities: [entity("ent_here")],
    };
    const incoming: Bundle = {
      ...emptyBundle(),
      entities: [entity("ent_here"), entity("ent_new"), entity("ent_gone", FIXED)],
    };
    expect(planImport(existing, incoming, "append").addedEntityPeriods).toBe(1);
    expect(planImport(existing, incoming, "restore").addedEntityPeriods).toBe(0);
  });
});

describe("countRows", () => {
  it("counts the profile as one live row", () => {
    expect(countRows({ ...emptyBundle(), profile: profile() })).toEqual({
      live: 1,
      deleted: 0,
      history: 0,
    });
  });
});
