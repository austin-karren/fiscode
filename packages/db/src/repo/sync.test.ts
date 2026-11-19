import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { applyImport, emptyBundle as emptyCsvBundle, exportBundle, parseCsv } from "@fiscode/csv";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import type { Bundle as DbBundle } from "../bundle.ts";
import {
  buildBundle,
  clientRepo,
  expenseRepo,
  historyRepo,
  importBundle,
  mileageRepo,
  vehicleRepo,
} from "./index.ts";

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
    await importBundle(bundle, "import-restore");

    // 2. Export to CSV.
    const csv = exportBundle(await buildBundle(), {
      scope: "full",
    });

    // 3. Parse the CSV into a fresh in-memory Bundle.
    const { bundle: parsed, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);

    // 4. Merge against an empty bundle (overwrite semantics).
    const applied = applyImport(emptyCsvBundle(), parsed, "restore");

    // 5. Wipe the DB and re-import via the merged bundle.
    await importBundle(applied.next as DbBundle, "import-restore");

    // 6. Read everything back; compare cents-exact.
    const round = await buildBundle();
    expect(normalize(round)).toEqual(normalize(bundle));
  });

  it("export with scope='yearly' filters dated rows and survives the full chain", async () => {
    await importBundle(bundle, "import-restore");
    const csv = exportBundle(await buildBundle(), {
      scope: "yearly",
      year: 2026,
    });
    const { bundle: parsed } = parseCsv(csv);
    const applied = applyImport(emptyCsvBundle(), parsed, "restore");
    await importBundle(applied.next as DbBundle, "import-restore");
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
      "import-restore",
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
      "import-restore",
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
    const applied = applyImport(emptyCsvBundle(), parsed, "restore");
    await importBundle(applied.next as DbBundle, "import-restore");
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("two exports of the same state at different clock times are equal bytes", async () => {
    await importBundle(bundle, "import-restore");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T08:00:00.000Z"));
    const first = await exportAll();
    vi.setSystemTime(new Date("2027-11-30T23:59:59.000Z"));
    const second = await exportAll();
    expect(second).toBe(first);
    expect(first).not.toMatch(/exported/);
  });

  it("export -> import into an empty db -> export is equal bytes", async () => {
    await importBundle(bundle, "import-restore");
    const first = await exportAll();
    await restoreIntoEmptyDb(first);
    expect(await exportAll()).toBe(first);
  });

  it("a soft-deleted row is exported with deleted_at and restored as deleted", async () => {
    await importBundle(bundle, "import-restore");
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
    await importBundle(bundle, "import-restore");
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
    await importBundle(bundle, "import-restore");
    await expenseRepo.softDelete("ex_1");
    const first = await exportAll();
    const before = await historyRepo.listAll();
    expect(before).toHaveLength(1);

    // Same database, not emptied: the import must stay revertible.
    const { bundle: parsed } = parseCsv(first);
    await importBundle(parsed as DbBundle, "import-restore");
    const after = await historyRepo.listAll();
    expect(after).toHaveLength(2);
    const snapshot = after.find((h) => h.entity === "__import_snapshot")!;
    // The snapshot holds the prior rows but never nests the log inside itself.
    expect(JSON.parse(snapshot.beforeJson!).history).toEqual([]);
    expect(JSON.parse(snapshot.afterJson!).history).toEqual([]);
    expect(JSON.parse(snapshot.beforeJson!).expenses).toHaveLength(1);
  });

  it("the full file keeps a deleted row in a table of its own, after the live rows", async () => {
    await importBundle(bundle, "import-restore");
    const live = await expenseRepo.create({
      date: "2026-03-06",
      amountCents: 8950,
      category: "supplies",
      clientId: null,
      description: "Still here",
      reason: null,
      notes: null,
      flagForSection179: false,
      startupExpense: false,
      deletedAt: null,
    });
    await expenseRepo.softDelete("ex_1");
    const lines = (await exportAll()).split("\r\n");
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at("# Expenses")).toBeGreaterThan(0);
    expect(at(live.id)).toBeGreaterThan(at("# Expenses"));
    expect(at("# Expenses (deleted - not part of your books)")).toBeGreaterThan(at(live.id));
    expect(at("ex_1")).toBeGreaterThan(at("# Expenses (deleted - not part of your books)"));
  });

  it("an archived client and vehicle keep their live income and mileage rows through a restore", async () => {
    await importBundle(bundle, "import-restore");
    const car = await vehicleRepo.create({
      make: "Toyota",
      model: "RAV4",
      year: 2022,
      mpg: 28,
      method: "standard_mileage",
      inServiceDate: "2026-01-01",
      notes: null,
      deletedAt: null,
    });
    const trip = await mileageRepo.create({
      date: "2026-03-03",
      vehicleId: car.id,
      businessMiles: 31,
      purpose: "Site visit",
      notes: null,
      deletedAt: null,
    });
    // Archive both parents. Their children stay live.
    await clientRepo.softDelete("cl_1");
    await vehicleRepo.softDelete(car.id);
    const parents = async () => ({
      client: (await clientRepo.listIncludingDeleted()).find((r) => r.id === "cl_1")!,
      vehicle: (await vehicleRepo.listIncludingDeleted()).find((r) => r.id === car.id)!,
    });
    const before = await parents();
    expect(before.client.deletedAt).not.toBeNull();
    expect(before.vehicle.deletedAt).not.toBeNull();

    // In the file a child row names its parent even though the parent is archived.
    const childNames = (csv: string) => {
      const line = (id: string) => csv.split("\r\n").find((l) => l.split(",").includes(id))!;
      return { income: line("in_1").split(",")[2], mileage: line(trip.id).split(",")[2] };
    };
    const first = await exportAll();
    expect(childNames(first)).toEqual({ income: "Acme", mileage: "2022 Toyota RAV4" });
    // The archived parents sit in the deleted tables; the children are in the live ones.
    const lines = first.split("\r\n");
    const at = (needle: string) => lines.findIndex((l) => l.startsWith(needle));
    expect(at("client,Acme")).toBeGreaterThan(at("# Clients (deleted"));
    expect(at("vehicle,Toyota")).toBeGreaterThan(at("# Vehicles (deleted"));
    expect(at("# Income (deleted")).toBe(-1);
    expect(at("# Mileage (deleted")).toBe(-1);

    // The yearly file leaves the archived parents out but still names them.
    const yearly = exportBundle(await buildBundle({ includeDeleted: true }), {
      scope: "yearly",
      year: 2026,
    });
    expect(yearly).not.toContain("# Clients");
    expect(yearly).not.toContain("# Vehicles");
    expect(childNames(yearly)).toEqual({ income: "Acme", mileage: "2022 Toyota RAV4" });

    await restoreIntoEmptyDb(first);
    expect(await parents()).toEqual(before);
    const live = await buildBundle();
    expect(live.clients).toEqual([]);
    expect(live.vehicles).toEqual([]);
    expect(live.income.find((r) => r.id === "in_1")?.clientId).toBe("cl_1");
    expect(live.mileage.find((r) => r.id === trip.id)?.vehicleId).toBe(car.id);
    expect(await exportAll()).toBe(first);
  });

  it("the yearly file leaves out deleted rows and history", async () => {
    await importBundle(bundle, "import-restore");
    await expenseRepo.softDelete("ex_1");
    const yearly = exportBundle(await buildBundle({ includeDeleted: true, includeHistory: true }), {
      scope: "yearly",
      year: 2026,
    });
    // The accountant's view: what the app shows, nothing a sum would double count.
    expect(yearly).not.toContain("ex_1");
    expect(yearly).not.toContain("(deleted");
    expect(yearly).not.toContain("# History");
    expect(yearly).toContain("in_1");
  });

  it("the default bundle still holds live rows only", async () => {
    await importBundle(bundle, "import-restore");
    await expenseRepo.softDelete("ex_1");
    expect((await buildBundle()).expenses).toEqual([]);
    expect((await buildBundle({ includeDeleted: true })).expenses.map((r) => r.id)).toEqual([
      "ex_1",
    ]);
  });
});
