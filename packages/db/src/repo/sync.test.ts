import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { applyImport, emptyBundle as emptyCsvBundle, exportBundle, parseCsv } from "@fiscode/csv";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import type { Bundle as DbBundle } from "../bundle.ts";
import { buildBundle, clientRepo, expenseRepo, historyRepo, importBundle } from "./index.ts";

const FIXED = "2026-06-04T12:00:00.000Z";

/**
 * End-to-end CSV ↔ DB sync test. This is the path users actually trigger:
 *
 *   1. exportBundle(currentDbBundle) → CSV text
 *   2. parseCsv(text) → in-memory Bundle
 *   3. applyImport(existing, parsed, mode) → merged Bundle
 *   4. importBundle(merged, reason) → DB rows written
 *   5. buildBundle() → DB rows read back
 *
 * If any step drops, mangles, or reorders a field, the final comparison
 * against the seed bundle catches it.
 */

const bundle: DbBundle = {
  ...emptyCsvBundle(),
  profile: {
    id: "profile",
    filingStatus: "mfj",
    state: "UT",
    seStartDate: "2026-01-01",
    dependents: 0,
    tracksRoth: true,
    usesRetirement: false,
    quarterlyMethod: "annualized",
    prepLeadDays: 14,
    createdAt: FIXED,
    updatedAt: FIXED,
  },
  entities: [
    {
      id: "ent_1",
      type: "sole_prop",
      startDate: "2026-01-01",
      endDate: null,
      notes: "open-ended",
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  spouses: [],
  clients: [
    {
      id: "cl_1",
      name: "Acme",
      type: null,
      notes: null,
      defaultRateCents: 15_000_00,
      defaultCommissionRate: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  income: [
    {
      id: "in_1",
      date: "2026-01-15",
      clientId: "cl_1",
      amountCents: 10_000_00,
      sourceType: "1099",
      kind: "recurring",
      description: "First payment + WFH stipend",
      notes: "$1,500 stipend included",
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  timeEntries: [],
  vehicles: [],
  mileage: [
    {
      id: "mi_1",
      date: "2026-02-10",
      vehicleId: null,
      businessMiles: 47,
      purpose: "Client visit",
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  homeOffice: [
    {
      id: "ho_1",
      startDate: "2026-01-01",
      endDate: null,
      method: "simplified",
      officeSqft: 150,
      homeSqft: 2000,
      monthlyRentMortgageCents: null,
      monthlyUtilitiesCents: null,
      monthlyInsuranceCents: null,
      regularExclusiveAck: true,
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  expenses: [
    {
      id: "ex_1",
      date: "2026-01-20",
      amountCents: 89_999,
      category: "equipment",
      clientId: null,
      description: "Standing desk",
      reason: "WFH stipend purchase",
      notes: null,
      flagForSection179: true,
      startupExpense: false,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  retirementContributions: [],
};

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = setupTestDb();
});
afterEach(() => {
  teardownTestDb(sqlite);
});

const sortById = <T extends { id: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

const normalize = (b: DbBundle): DbBundle => ({
  ...b,
  entities: sortById(b.entities),
  spouses: sortById(b.spouses),
  clients: sortById(b.clients),
  income: sortById(b.income),
  timeEntries: sortById(b.timeEntries),
  vehicles: sortById(b.vehicles),
  mileage: sortById(b.mileage),
  homeOffice: sortById(b.homeOffice),
  expenses: sortById(b.expenses),
  retirementContributions: sortById(b.retirementContributions),
});

describe("CSV ↔ DB sync (full chain)", () => {
  it("export → parse → applyImport → importBundle → buildBundle equals the seed bundle", async () => {
    // 1. Seed the DB with the original bundle.
    await importBundle(bundle, "import-overwrite");

    // 2. Export to CSV.
    const csv = exportBundle(await buildBundle(), {
      scope: "full",
    });

    // 3. Parse the CSV into a fresh in-memory Bundle.
    const { bundle: parsed, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);

    // 4. Merge against an empty bundle (overwrite semantics).
    const applied = applyImport(emptyCsvBundle(), parsed, "overwrite");

    // 5. Wipe the DB and re-import via the merged bundle.
    await importBundle(applied.next as DbBundle, "import-overwrite");

    // 6. Read everything back; compare cents-exact.
    const round = await buildBundle();
    expect(normalize(round)).toEqual(normalize(bundle));
  });

  it("export with scope='yearly' filters dated rows and survives the full chain", async () => {
    await importBundle(bundle, "import-overwrite");
    const csv = exportBundle(await buildBundle(), {
      scope: "yearly",
      year: 2026,
    });
    const { bundle: parsed } = parseCsv(csv);
    const applied = applyImport(emptyCsvBundle(), parsed, "overwrite");
    await importBundle(applied.next as DbBundle, "import-overwrite");
    const round = await buildBundle();
    // Income, mileage, expenses are all dated in 2026 — present.
    expect(round.income.map((r) => r.id)).toEqual(["in_1"]);
    expect(round.mileage.map((r) => r.id)).toEqual(["mi_1"]);
    expect(round.expenses.map((r) => r.id)).toEqual(["ex_1"]);
    expect(round.clients.map((c) => c.id)).toEqual(["cl_1"]);
  });

  it("append mode through the full chain preserves existing DB rows", async () => {
    // Seed DB with an existing client + income.
    await importBundle(
      {
        ...emptyCsvBundle(),
        clients: [
          {
            id: "cl_existing",
            name: "Existing",
            type: null,
            notes: null,
            defaultRateCents: null,
            defaultCommissionRate: null,
            createdAt: FIXED,
            updatedAt: FIXED,
            deletedAt: null,
          },
        ],
      },
      "import-overwrite",
    );

    // Now feed `bundle` in via the append chain.
    const csv = exportBundle(bundle, { scope: "full" });
    const { bundle: parsed } = parseCsv(csv);
    const existing = await buildBundle();
    const applied = applyImport(existing, parsed, "append");
    expect(applied.conflicts).toEqual([]);
    await importBundle(applied.next as DbBundle, "import-append");

    const round = await buildBundle();
    expect(round.clients.map((c) => c.name).sort()).toEqual(["Acme", "Existing"]);
    expect(round.income.map((r) => r.id)).toEqual(["in_1"]);
  });

  it("append mode flags conflicts when an incoming id collides with an existing row", async () => {
    // Seed DB with cl_1 already present.
    await importBundle(
      {
        ...emptyCsvBundle(),
        clients: [
          {
            id: "cl_1",
            name: "Already here",
            type: null,
            notes: null,
            defaultRateCents: null,
            defaultCommissionRate: null,
            createdAt: FIXED,
            updatedAt: FIXED,
            deletedAt: null,
          },
        ],
      },
      "import-overwrite",
    );
    const csv = exportBundle(bundle, { scope: "full" });
    const { bundle: parsed } = parseCsv(csv);
    const existing = await buildBundle();
    const applied = applyImport(existing, parsed, "append");
    expect(applied.conflicts).toEqual([{ table: "client", id: "cl_1" }]);
    // Existing row keeps its name (existing-wins).
    expect(applied.next.clients.find((c) => c.id === "cl_1")?.name).toBe("Already here");
  });
});

describe("the export is the whole state, and the same bytes every time", () => {
  const exportAll = async (): Promise<string> =>
    exportBundle(await buildBundle({ includeDeleted: true, includeHistory: true }), {
      scope: "full",
    });

  // Restore a CSV into a database that has never held anything.
  const restoreIntoEmptyDb = async (csv: string): Promise<void> => {
    teardownTestDb(sqlite);
    sqlite = setupTestDb();
    expect(await buildBundle({ includeDeleted: true, includeHistory: true })).toEqual(
      emptyCsvBundle(),
    );
    const { bundle: parsed, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);
    const applied = applyImport(emptyCsvBundle(), parsed, "overwrite");
    await importBundle(applied.next as DbBundle, "import-overwrite");
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("two exports of the same state at different clock times are equal bytes", async () => {
    await importBundle(bundle, "import-overwrite");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T08:00:00.000Z"));
    const first = await exportAll();
    vi.setSystemTime(new Date("2027-11-30T23:59:59.000Z"));
    const second = await exportAll();
    expect(second).toBe(first);
    expect(first).not.toMatch(/exported/);
  });

  it("export -> import into an empty db -> export is equal bytes", async () => {
    await importBundle(bundle, "import-overwrite");
    const first = await exportAll();
    await restoreIntoEmptyDb(first);
    expect(await exportAll()).toBe(first);
  });

  it("a soft-deleted row is exported with deleted_at and restored as deleted", async () => {
    await importBundle(bundle, "import-overwrite");
    expect(await expenseRepo.softDelete("ex_1")).toBe(true);
    const deleted = (await expenseRepo.listIncludingDeleted()).find((r) => r.id === "ex_1")!;
    expect(deleted.deletedAt).not.toBeNull();

    const first = await exportAll();
    expect(first).toContain(deleted.deletedAt!);

    await restoreIntoEmptyDb(first);
    // Still there, still deleted: hidden from the live list, kept in the table.
    expect((await expenseRepo.list()).map((r) => r.id)).not.toContain("ex_1");
    const restored = (await expenseRepo.listIncludingDeleted()).find((r) => r.id === "ex_1");
    expect(restored).toEqual(deleted);
    expect(await exportAll()).toBe(first);
  });

  it("the edit history is exported and restored into an empty db as the same log", async () => {
    await importBundle(bundle, "import-overwrite");
    // Make real history: an insert, an update and a delete.
    const made = await clientRepo.create({
      name: 'Quote "and", comma',
      type: null,
      notes: "=not a formula",
      defaultRateCents: 12_345,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    await clientRepo.update(made.id, { name: "Renamed" });
    await expenseRepo.softDelete("ex_1");
    const byId = (rows: Awaited<ReturnType<typeof historyRepo.listAll>>) =>
      [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
    const log = byId(await historyRepo.listAll());
    expect(log.map((h) => h.op).sort()).toEqual(["delete", "insert", "update"]);

    const first = await exportAll();
    expect(first).toContain("# History");

    await restoreIntoEmptyDb(first);
    // Same rows, same history: no entry lost, changed or added by the restore.
    expect(byId(await historyRepo.listAll())).toEqual(log);
    expect(await exportAll()).toBe(first);
  });

  it("an import over existing state adds one snapshot entry and keeps both logs", async () => {
    await importBundle(bundle, "import-overwrite");
    await expenseRepo.softDelete("ex_1");
    const first = await exportAll();
    const before = await historyRepo.listAll();
    expect(before).toHaveLength(1);

    // Same database, not emptied: the import must stay revertible.
    const { bundle: parsed } = parseCsv(first);
    await importBundle(parsed as DbBundle, "import-overwrite");
    const after = await historyRepo.listAll();
    expect(after).toHaveLength(2);
    const snapshot = after.find((h) => h.entity === "__import_snapshot")!;
    // The snapshot holds the prior rows but never nests the log inside itself.
    expect(JSON.parse(snapshot.beforeJson!).history).toEqual([]);
    expect(JSON.parse(snapshot.afterJson!).history).toEqual([]);
    expect(JSON.parse(snapshot.beforeJson!).expenses).toHaveLength(1);
  });

  it("the yearly file carries deleted rows but no history", async () => {
    await importBundle(bundle, "import-overwrite");
    await expenseRepo.softDelete("ex_1");
    const yearly = exportBundle(await buildBundle({ includeDeleted: true, includeHistory: true }), {
      scope: "yearly",
      year: 2026,
    });
    expect(yearly).toContain("ex_1");
    expect(yearly).not.toContain("# History");
  });

  it("the default bundle still holds live rows only", async () => {
    await importBundle(bundle, "import-overwrite");
    await expenseRepo.softDelete("ex_1");
    expect((await buildBundle()).expenses).toEqual([]);
    expect((await buildBundle({ includeDeleted: true })).expenses.map((r) => r.id)).toEqual([
      "ex_1",
    ]);
  });
});
