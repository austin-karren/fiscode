import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { exampleBundle, exportBundle } from "@fiscode/csv";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import {
  buildBundle,
  clientRepo,
  entityRepo,
  historyRepo,
  importBundle,
  incomeRepo,
  profileRepo,
} from "./index.ts";

// A save that changes nothing (the form re-submitted as it was) must leave no
// trace: no history row and no new updatedAt. Otherwise every such save adds a
// row to the History screen and changes the backup file.

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = setupTestDb();
});
afterEach(() => {
  teardownTestDb(sqlite);
});

const profileInput = {
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
};

describe("a save that changes nothing", () => {
  it("crud update: no history row, updatedAt unchanged, returns the stored row", async () => {
    const c = await clientRepo.create({
      name: "Demo Client",
      type: "recurring",
      notes: null,
      defaultRateCents: 10_000,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    const historyBefore = await historyRepo.listAll();
    const same = await clientRepo.update(c.id, { name: "Demo Client", defaultRateCents: 10_000 });
    expect(same).toEqual(c);
    expect(await historyRepo.listAll()).toEqual(historyBefore);
  });

  it("crud update with one real change still writes and records it", async () => {
    const c = await clientRepo.create({
      name: "Demo Client",
      type: "recurring",
      notes: null,
      defaultRateCents: 10_000,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    const updated = await clientRepo.update(c.id, {
      name: "Demo Client",
      defaultRateCents: 12_000,
    });
    expect(updated?.defaultRateCents).toBe(12_000);
    const ops = (await historyRepo.listFor("client", c.id)).map((e) => e.op);
    expect(ops).toEqual(["insert", "update"]);
  });

  it("entityRepo.update: no history row when the dates and type are the same", async () => {
    const e = await entityRepo.create({
      type: "sole_prop",
      startDate: "2026-01-01",
      endDate: null,
      notes: null,
      deletedAt: null,
    });
    const historyBefore = await historyRepo.listAll();
    expect(await entityRepo.update(e.id, { type: "sole_prop", startDate: "2026-01-01" })).toEqual(
      e,
    );
    expect(await historyRepo.listAll()).toEqual(historyBefore);
  });

  it("profileRepo.upsert: no history row and no updatedAt bump for the same values", async () => {
    const first = await profileRepo.upsert(profileInput);
    const historyBefore = await historyRepo.listAll();
    expect(await profileRepo.upsert({ ...profileInput })).toEqual(first);
    expect(await historyRepo.listAll()).toEqual(historyBefore);
  });

  it("the full export is byte-identical after no-op saves (demo data)", async () => {
    await importBundle(exampleBundle(), "import-restore");
    const before = exportBundle(await buildBundle(), { scope: "full" });

    const bundle = await buildBundle();
    const p = bundle.profile!;
    await profileRepo.upsert({
      filingStatus: p.filingStatus,
      state: p.state,
      seStartDate: p.seStartDate,
      dependents: p.dependents,
      tracksRoth: p.tracksRoth,
      usesRetirement: p.usesRetirement,
      quarterlyMethod: p.quarterlyMethod,
      prepLeadDays: p.prepLeadDays,
    });
    const inc = bundle.income[0]!;
    await incomeRepo.update(inc.id, {
      date: inc.date,
      amountCents: inc.amountCents,
      clientId: inc.clientId,
      description: inc.description,
    });
    const ent = bundle.entities[0]!;
    await entityRepo.update(ent.id, { startDate: ent.startDate, endDate: ent.endDate });

    expect(exportBundle(await buildBundle(), { scope: "full" })).toBe(before);
  });
});
