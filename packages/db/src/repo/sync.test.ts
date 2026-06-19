import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { applyImport, emptyBundle as emptyCsvBundle, exportBundle, parseCsv } from "@fiscode/csv";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import type { Bundle as DbBundle } from "../bundle.ts";
import { buildBundle, importBundle } from "./index.ts";

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
      exportedAt: FIXED,
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
      exportedAt: FIXED,
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
    const csv = exportBundle(bundle, { scope: "full", exportedAt: FIXED });
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
    const csv = exportBundle(bundle, { scope: "full", exportedAt: FIXED });
    const { bundle: parsed } = parseCsv(csv);
    const existing = await buildBundle();
    const applied = applyImport(existing, parsed, "append");
    expect(applied.conflicts).toEqual([{ table: "client", id: "cl_1" }]);
    // Existing row keeps its name (existing-wins).
    expect(applied.next.clients.find((c) => c.id === "cl_1")?.name).toBe("Already here");
  });
});
