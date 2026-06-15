import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import { emptyBundle, type Bundle } from "../bundle.ts";
import { buildBundle, clientRepo, expenseRepo, historyRepo, importBundle } from "./index.ts";

const FIXED = "2026-06-04T12:00:00.000Z";

const profile = () => ({
  id: "profile",
  filingStatus: "mfj",
  state: "UT",
  seStartDate: "2026-01-01",
  dependents: 0,
  tracksRoth: false,
  usesRetirement: false,
  quarterlyMethod: "annualized",
  prepLeadDays: 14,
  createdAt: FIXED,
  updatedAt: FIXED,
});

const client = (id: string, name: string) => ({
  id,
  name,
  type: null,
  notes: null,
  defaultRateCents: null,
  defaultCommissionRate: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});

const income = (id: string, date: string, amount: number) => ({
  id,
  date,
  clientId: null,
  amountCents: amount,
  sourceType: "1099",
  kind: "recurring",
  description: null,
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});

const fullBundle = (): Bundle => ({
  ...emptyBundle(),
  profile: profile(),
  clients: [client("cl_1", "Acme"), client("cl_2", "Zeta")],
  income: [income("in_1", "2026-01-15", 100_000), income("in_2", "2026-06-15", 250_000)],
});

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = setupTestDb();
});
afterEach(() => {
  teardownTestDb(sqlite);
});

describe("importBundle — overwrite", () => {
  it("loads the bundle into an empty DB and buildBundle returns the same shape", async () => {
    await importBundle(fullBundle(), "import-overwrite");
    const round = await buildBundle();
    expect(round.profile?.filingStatus).toBe("mfj");
    expect(round.clients.map((c) => c.id).sort()).toEqual(["cl_1", "cl_2"]);
    expect(round.income.map((r) => r.id).sort()).toEqual(["in_1", "in_2"]);
  });

  it("snapshot row captures the prior state in history", async () => {
    // Seed the DB with one row, then overwrite.
    await clientRepo.create({
      name: "Prior",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    await importBundle(fullBundle(), "import-overwrite");
    const snapshots = (await historyRepo.listAll()).filter((h) => h.entity === "__import_snapshot");
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0]!;
    expect(snap.entityId).toBe("import-overwrite");
    const before = JSON.parse(snap.beforeJson!);
    expect(before.clients.some((c: { name: string }) => c.name === "Prior")).toBe(true);
  });

  it("truncates existing rows before inserting", async () => {
    await clientRepo.create({
      name: "WillBeGone",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    await importBundle(fullBundle(), "import-overwrite");
    const round = await buildBundle();
    expect(round.clients.map((c) => c.name).sort()).toEqual(["Acme", "Zeta"]);
  });

  it("history rows are PRESERVED across overwrite (only data tables are truncated)", async () => {
    const c = await clientRepo.create({
      name: "Earlier",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    // Before: history has at least the insert.
    const beforeHist = await historyRepo.listFor("client", c.id);
    expect(beforeHist).toHaveLength(1);

    await importBundle(fullBundle(), "import-overwrite");

    // After: that history row still exists.
    const afterHist = await historyRepo.listFor("client", c.id);
    expect(afterHist).toHaveLength(1);
    expect(afterHist[0]!.op).toBe("insert");
  });
});

describe("importBundle — append", () => {
  it("does NOT truncate; merged data sits on top of existing rows", async () => {
    await clientRepo.create({
      name: "Existing",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    // Append a bundle that contains different rows.
    const appended: Bundle = {
      ...emptyBundle(),
      clients: [client("cl_new", "Brought in")],
    };
    await importBundle(appended, "import-append");
    const round = await buildBundle();
    expect(round.clients.map((c) => c.name).sort()).toEqual(["Brought in", "Existing"]);
  });

  it("snapshot is still recorded for append", async () => {
    await importBundle(fullBundle(), "import-append");
    const snapshots = (await historyRepo.listAll()).filter((h) => h.entity === "__import_snapshot");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.entityId).toBe("import-append");
  });
});

describe("importBundle → buildBundle — full round-trip parity", () => {
  it("every field of every row survives import → buildBundle (cents-exact)", async () => {
    const bundle: Bundle = {
      ...emptyBundle(),
      profile: profile(),
      clients: [client("cl_1", "Acme"), client("cl_2", "Zeta")],
      income: [
        income("in_1", "2026-01-15", 1_000_00),
        { ...income("in_2", "2026-06-15", 2_500_00), description: "kept" },
      ],
      expenses: [
        {
          id: "ex_1",
          date: "2026-02-15",
          amountCents: 12_500,
          category: "supplies",
          clientId: "cl_1",
          description: "Notebooks",
          reason: null,
          notes: null,
          flagForSection179: false,
          createdAt: FIXED,
          updatedAt: FIXED,
          deletedAt: null,
        },
        {
          id: "ex_2",
          date: "2026-08-01",
          amountCents: 99_999,
          category: "equipment",
          clientId: null,
          description: "Standing desk",
          reason: "Home office setup stipend",
          notes: null,
          flagForSection179: true,
          createdAt: FIXED,
          updatedAt: FIXED,
          deletedAt: null,
        },
      ],
    };
    await importBundle(bundle, "import-overwrite");
    const round = await buildBundle();
    expect(round.profile).toEqual(bundle.profile);
    expect(round.clients.sort((a, b) => a.id.localeCompare(b.id))).toEqual(bundle.clients);
    expect(round.income.sort((a, b) => a.id.localeCompare(b.id))).toEqual(bundle.income);
    expect(round.expenses.sort((a, b) => a.id.localeCompare(b.id))).toEqual(bundle.expenses);
  });

  it("creating rows via repo then buildBundle reads them back exactly", async () => {
    const created = await expenseRepo.create({
      date: "2026-03-15",
      amountCents: 4_999,
      category: "supplies",
      clientId: null,
      description: "USB-C cable",
      reason: null,
      notes: null,
      flagForSection179: false,
      deletedAt: null,
    });
    const round = await buildBundle();
    expect(round.expenses).toHaveLength(1);
    expect(round.expenses[0]).toEqual(created);
  });
});

describe("buildBundle — empty DB", () => {
  it("returns emptyBundle()-equivalent (profile undefined, arrays empty)", async () => {
    const b = await buildBundle();
    expect(b.profile).toBeUndefined();
    expect(b.clients).toEqual([]);
    expect(b.income).toEqual([]);
    expect(b.expenses).toEqual([]);
    expect(b.mileage).toEqual([]);
  });
});
