import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import { emptyBundle, type Bundle } from "../bundle.ts";
import { applyImport, exportBundle, parseCsv } from "@fiscode/csv";
import {
  buildBundle,
  clientRepo,
  expenseRepo,
  folderRepo,
  historyRepo,
  importBundle,
} from "./index.ts";

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
  priorYearTotalTaxCents: null,
  priorYearAgiCents: null,
  priorYearStateTaxCents: null,
  priorYearFiguresYear: null,
  priorYearNotFiled: null,
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

describe("importBundle — restore", () => {
  it("loads the bundle into an empty DB and buildBundle returns the same shape", async () => {
    await importBundle(fullBundle(), "import-restore");
    const round = await buildBundle();
    expect(round.profile?.filingStatus).toBe("mfj");
    expect(round.clients.map((c) => c.id).sort()).toEqual(["cl_1", "cl_2"]);
    expect(round.income.map((r) => r.id).sort()).toEqual(["in_1", "in_2"]);
  });

  it("snapshot row captures the prior state in history", async () => {
    // Seed the DB with one row, then restore over it.
    await clientRepo.create({
      name: "Prior",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    await importBundle(fullBundle(), "import-restore");
    const snapshots = (await historyRepo.listAll()).filter((h) => h.entity === "__import_snapshot");
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0]!;
    expect(snap.entityId).toBe("import-restore");
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
    await importBundle(fullBundle(), "import-restore");
    const round = await buildBundle();
    expect(round.clients.map((c) => c.name).sort()).toEqual(["Acme", "Zeta"]);
  });

  it("history rows are PRESERVED across a restore (only data tables are truncated)", async () => {
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

    await importBundle(fullBundle(), "import-restore");

    // After: that history row still exists.
    const afterHist = await historyRepo.listFor("client", c.id);
    expect(afterHist).toHaveLength(1);
    expect(afterHist[0]!.op).toBe("insert");
  });
});

describe("importBundle — all or nothing", () => {
  const fullExport = async () =>
    exportBundle(await buildBundle({ includeDeleted: true, includeHistory: true }), {
      scope: "full",
    });

  const seed = async () => {
    await importBundle(fullBundle(), "import-restore");
    // An edit and a delete, so the prior state has history and a deleted row.
    const extra = await clientRepo.create({
      name: "Added later",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    await clientRepo.softDelete(extra.id);
  };

  // Two income rows with one id: the second insert breaks the primary key,
  // after the snapshot, the deletes and most inserts have already run.
  const failsMidway = (): Bundle => ({
    ...emptyBundle(),
    profile: { ...profile(), state: "CA" },
    clients: [client("cl_9", "Never lands")],
    income: [income("in_dup", "2026-02-01", 1), income("in_dup", "2026-02-02", 2)],
  });

  it("a restore that fails midway leaves the prior state byte-identical on export", async () => {
    await seed();
    const before = await fullExport();

    await expect(importBundle(failsMidway(), "import-restore")).rejects.toThrow();

    expect(await fullExport()).toBe(before);
    // Not even the snapshot entry, which is written first, survives.
    const snapshots = (await historyRepo.listAll()).filter((h) => h.entity === "__import_snapshot");
    expect(snapshots).toHaveLength(0);
  });

  it("an append that fails midway adds nothing", async () => {
    await seed();
    const before = await fullExport();
    // Append ignores id collisions, so break it with a row the table rejects.
    const bad = {
      ...emptyBundle(),
      clients: [client("cl_new", "Lands first"), { ...client("cl_bad", "x"), name: null as never }],
    };

    await expect(importBundle(bad, "import-append")).rejects.toThrow();

    expect(await fullExport()).toBe(before);
  });

  it("a failed restore into an empty database leaves it empty", async () => {
    await expect(importBundle(failsMidway(), "import-restore")).rejects.toThrow();
    expect(await fullExport()).toBe(
      exportBundle({ ...emptyBundle(), history: [] }, { scope: "full" }),
    );
    expect(await historyRepo.listAll()).toEqual([]);
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

  it("an import into a database that holds nothing records no snapshot", async () => {
    // Nothing to revert to, and a restore into an empty db must be exact.
    await importBundle(fullBundle(), "import-append");
    expect(await historyRepo.listAll()).toEqual([]);
  });

  it("snapshot is still recorded for append", async () => {
    await clientRepo.create({
      name: "Existing",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
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
          startupExpense: false,
          placedInServiceDate: null,
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
          startupExpense: false,
          placedInServiceDate: null,
          createdAt: FIXED,
          updatedAt: FIXED,
          deletedAt: null,
        },
      ],
    };
    await importBundle(bundle, "import-restore");
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
      startupExpense: false,
      placedInServiceDate: null,
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

describe("importBundle — history-restore (a past snapshot from the History screen)", () => {
  const fullExport = async () =>
    exportBundle(await buildBundle({ includeDeleted: true }), { scope: "full" });

  const snapshots = async () =>
    (await historyRepo.listAll()).filter((h) => h.entity === "__import_snapshot");

  it("puts back the state a file restore replaced, and records history-restore", async () => {
    await clientRepo.create({
      name: "Prior",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    const priorExport = await fullExport();
    await importBundle(fullBundle(), "import-restore");
    const [fileRestore] = await snapshots();

    await importBundle(JSON.parse(fileRestore!.beforeJson!) as Bundle, "history-restore");

    expect(await fullExport()).toBe(priorExport);
    expect((await snapshots()).map((s) => s.entityId)).toEqual([
      "import-restore",
      "history-restore",
    ]);
    // The new snapshot holds what the history restore replaced, so it can be undone too.
    const last = (await snapshots())[1]!;
    expect(
      JSON.parse(last.beforeJson!)
        .clients.map((c: { name: string }) => c.name)
        .sort(),
    ).toEqual(["Acme", "Zeta"]);
  });

  it("is all or nothing, like a file restore", async () => {
    await importBundle(fullBundle(), "import-restore");
    const before = await fullExport();
    const snapshotsBefore = await snapshots();
    const broken: Bundle = {
      ...emptyBundle(),
      income: [income("in_dup", "2026-02-01", 1), income("in_dup", "2026-02-02", 2)],
    };

    await expect(importBundle(broken, "history-restore")).rejects.toThrow();

    expect(await fullExport()).toBe(before);
    expect(await snapshots()).toEqual(snapshotsBefore);
  });
});

describe("importBundle — import-update (Update rows)", () => {
  const fullExport = async () =>
    exportBundle(await buildBundle({ includeDeleted: true }), { scope: "full" });
  const snapshots = async () =>
    (await historyRepo.listAll()).filter((h) => h.entity === "__import_snapshot");
  const everything = () => buildBundle({ includeDeleted: true, includeHistory: true });

  it("writes the merged rows, removes nothing, records one snapshot with the reason", async () => {
    await importBundle(fullBundle(), "import-restore");
    const existing = await everything();
    const file: Bundle = {
      ...emptyBundle(),
      income: [{ ...income("in_1", "2026-01-15", 123_45) }, income("in_3", "2026-09-01", 50_00)],
    };
    const { next } = applyImport(existing, file, "update");
    await importBundle(next, "import-update");

    const after = await buildBundle({ includeDeleted: true });
    expect(after.income.map((i) => [i.id, i.amountCents])).toEqual([
      ["in_1", 123_45],
      ["in_2", 250_000],
      ["in_3", 50_00],
    ]);
    expect(after.clients.map((c) => c.id).sort()).toEqual(["cl_1", "cl_2"]);
    const snaps = await snapshots();
    expect(snaps.map((s) => s.entityId)).toEqual(["import-update"]);
  });

  it("is revertable: the snapshot put back by a history restore gives the prior export", async () => {
    await importBundle(fullBundle(), "import-restore");
    const prior = await fullExport();
    const existing = await everything();
    const file: Bundle = { ...emptyBundle(), income: [income("in_1", "2026-01-15", 1_00)] };
    await importBundle(applyImport(existing, file, "update").next, "import-update");
    expect(await fullExport()).not.toBe(prior);

    const [snap] = await snapshots();
    await importBundle(JSON.parse(snap!.beforeJson!) as Bundle, "history-restore");
    expect(await fullExport()).toBe(prior);
  });

  it("is all or nothing", async () => {
    await importBundle(fullBundle(), "import-restore");
    const prior = await fullExport();
    const broken: Bundle = {
      ...(await everything()),
      income: [income("in_dup", "2026-02-01", 1), income("in_dup", "2026-02-02", 2)],
    };
    await expect(importBundle(broken, "import-update")).rejects.toThrow();
    expect(await fullExport()).toBe(prior);
    expect(await snapshots()).toHaveLength(0);
  });

  it("the same file again changes no row: export -> Update rows -> export differs only by the snapshot", async () => {
    await importBundle(fullBundle(), "import-restore");
    const prior = await fullExport();
    const existing = await everything();
    const { bundle } = parseCsv(prior);
    await importBundle(applyImport(existing, bundle, "update").next, "import-update");
    expect(await fullExport()).toBe(prior);
    expect(await snapshots()).toHaveLength(1);
  });
});

describe("importBundle — a Restore stays exact with out-of-range rows and overlapping periods", () => {
  it("export -> restore into an empty database -> export gives the same bytes", async () => {
    const period = (id: string, startDate: string) => ({
      id,
      type: "sole_prop",
      startDate,
      endDate: null,
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    });
    const odd: Bundle = {
      ...fullBundle(),
      income: [income("in_neg", "2026-02-01", -45_00), income("in_zero", "2026-02-02", 0)],
      entities: [period("ent_a", "2026-01-01"), period("ent_b", "2026-06-01")],
    };
    const file = exportBundle(odd, { scope: "full" });
    await importBundle(parseCsv(file).bundle, "import-restore");
    expect(
      exportBundle(await buildBundle({ includeDeleted: true, includeHistory: true }), {
        scope: "full",
      }),
    ).toBe(file);
  });
});

describe("importBundle — document rows (v6)", () => {
  it("a restore brings document folders, documents and links back exactly; bytes are not its business", async () => {
    const withDocs: Bundle = {
      ...fullBundle(),
      documentFolders: [
        {
          id: "df_1",
          parentId: null,
          name: "2026",
          taxYear: 2026,
          sortOrder: 0,
          defaultKey: "year-root",
          createdAt: FIXED,
          updatedAt: FIXED,
          deletedAt: null,
        },
      ],
      documents: [
        {
          id: "doc_1",
          folderId: "df_1",
          name: "Demo receipt.pdf",
          mime: "application/pdf",
          sizeBytes: 10,
          sha256: "c".repeat(64),
          addedAt: FIXED,
          notes: null,
          createdAt: FIXED,
          updatedAt: FIXED,
          deletedAt: null,
        },
      ],
      documentLinks: [
        {
          id: "dl_1",
          documentId: "doc_1",
          recordType: "income",
          recordId: "in_1",
          createdAt: FIXED,
          updatedAt: FIXED,
          deletedAt: null,
        },
      ],
    };
    await importBundle(withDocs, "import-restore");
    const round = await buildBundle({ includeDeleted: true });
    expect(round.documentFolders).toEqual(withDocs.documentFolders);
    expect(round.documents).toEqual(withDocs.documents);
    expect(round.documentLinks).toEqual(withDocs.documentLinks);
  });
});

describe("importBundle — another device's document folders via Add rows (review #84 r4)", () => {
  it("succeeds: the incoming year folders become plain folders; no duplicate keys", async () => {
    await folderRepo.ensureYearDefaults(2026);
    const existing = await buildBundle({ includeDeleted: true, includeHistory: true });
    const at = "2026-06-04T12:00:00.000Z";
    const theirs: Bundle = {
      ...emptyBundle(),
      documentFolders: [
        {
          id: "df_other",
          parentId: null,
          name: "2026",
          taxYear: 2026,
          sortOrder: 0,
          defaultKey: "year-root",
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
        },
        {
          id: "df_other_exp",
          parentId: "df_other",
          name: "Expenses",
          taxYear: 2026,
          sortOrder: 0,
          defaultKey: "expenses",
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
        },
      ],
    };
    await importBundle(applyImport(existing, theirs, "append").next, "import-append");
    const after = await buildBundle({ includeDeleted: true });
    expect(after.documentFolders).toHaveLength(9);
    const keys = after.documentFolders
      .filter((f) => f.defaultKey)
      .map((f) => `${f.taxYear}:${f.defaultKey}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(after.documentFolders.find((f) => f.id === "df_other")!.defaultKey).toBeNull();
  });
});
