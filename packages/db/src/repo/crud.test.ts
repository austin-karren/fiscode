import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import {
  clientRepo,
  expenseRepo,
  historyRepo,
  homeOfficeRepo,
  incomeRepo,
  mileageRepo,
  profileRepo,
  vehicleRepo,
} from "./index.ts";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = setupTestDb();
});
afterEach(() => {
  teardownTestDb(sqlite);
});

describe("clientRepo — create / list / get / update / softDelete", () => {
  it("round-trips a client through every CRUD verb", async () => {
    const created = await clientRepo.create({
      name: "Acme",
      type: "recurring",
      notes: null,
      defaultRateCents: 15_000_00,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    expect(created.id).toMatch(/.+/);
    expect(created.name).toBe("Acme");

    const got = await clientRepo.get(created.id);
    expect(got?.id).toBe(created.id);

    const updated = await clientRepo.update(created.id, { name: "Acme Inc" });
    expect(updated?.name).toBe("Acme Inc");

    const before = await clientRepo.list();
    expect(before.map((c) => c.id)).toContain(created.id);

    const ok = await clientRepo.softDelete(created.id);
    expect(ok).toBe(true);

    const after = await clientRepo.list();
    expect(after.map((c) => c.id)).not.toContain(created.id);

    // Soft-deleted, not gone — listIncludingDeleted still sees it.
    const all = await clientRepo.listIncludingDeleted();
    expect(all.map((c) => c.id)).toContain(created.id);
  });

  it("get() returns undefined for soft-deleted rows", async () => {
    const c = await clientRepo.create({
      name: "Gone",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    await clientRepo.softDelete(c.id);
    expect(await clientRepo.get(c.id)).toBeUndefined();
  });

  it("update returns undefined for an unknown id", async () => {
    expect(await clientRepo.update("nope", { name: "x" })).toBeUndefined();
  });

  it("softDelete returns false for an unknown id", async () => {
    expect(await clientRepo.softDelete("nope")).toBe(false);
  });
});

describe("repo — history rows are written for every mutation", () => {
  it("writes insert/update/delete history rows in order", async () => {
    const c = await clientRepo.create({
      name: "HistCo",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    await clientRepo.update(c.id, { name: "HistCo v2" });
    await clientRepo.softDelete(c.id);

    const events = await historyRepo.listFor("client", c.id);
    expect(events.map((e) => e.op)).toEqual(["insert", "update", "delete"]);

    // After-state JSON should reflect each mutation.
    const insertAfter = JSON.parse(events[0]!.afterJson!);
    expect(insertAfter.name).toBe("HistCo");
    const updateAfter = JSON.parse(events[1]!.afterJson!);
    expect(updateAfter.name).toBe("HistCo v2");
    const deleteAfter = JSON.parse(events[2]!.afterJson!);
    expect(deleteAfter.deletedAt).not.toBeNull();
  });

  it("revertTo writes a revert history event and restores the snapshot", async () => {
    const c = await clientRepo.create({
      name: "RevertCo",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    const snapshot = { ...c };
    await clientRepo.update(c.id, { name: "Changed" });
    const restored = await clientRepo.revertTo(c.id, snapshot);
    expect(restored?.name).toBe("RevertCo");

    const events = await historyRepo.listFor("client", c.id);
    expect(events.map((e) => e.op)).toEqual(["insert", "update", "revert"]);
  });
});

describe("repo — ordering follows the configured orderBy column", () => {
  it("incomeRepo lists by date ASC", async () => {
    await incomeRepo.create({
      date: "2026-06-15",
      clientId: null,
      amountCents: 200_00,
      sourceType: "1099",
      kind: "recurring",
      description: null,
      notes: null,
      deletedAt: null,
    });
    await incomeRepo.create({
      date: "2026-01-15",
      clientId: null,
      amountCents: 100_00,
      sourceType: "1099",
      kind: "recurring",
      description: null,
      notes: null,
      deletedAt: null,
    });
    const list = await incomeRepo.list();
    expect(list.map((r) => r.date)).toEqual(["2026-01-15", "2026-06-15"]);
  });

  it("clientRepo lists by name ASC", async () => {
    await clientRepo.create({
      name: "Zeta",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    await clientRepo.create({
      name: "Alpha",
      type: null,
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    const list = await clientRepo.list();
    expect(list.map((c) => c.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("profileRepo — singleton semantics", () => {
  it("upsert inserts on first call, updates on second; exists() reflects state", async () => {
    expect(await profileRepo.exists()).toBe(false);
    const inserted = await profileRepo.upsert({
      filingStatus: "mfj",
      state: "UT",
      seStartDate: "2026-01-01",
      dependents: 0,
      tracksRoth: false,
      usesRetirement: false,
      quarterlyMethod: "annualized",
      prepLeadDays: 14,
    });
    expect(inserted.filingStatus).toBe("mfj");
    expect(inserted.id).toBe("profile");
    expect(await profileRepo.exists()).toBe(true);

    const updated = await profileRepo.upsert({
      filingStatus: "single",
      state: "CA",
      seStartDate: "2026-04-01",
      dependents: 1,
      tracksRoth: true,
      usesRetirement: true,
      quarterlyMethod: "even",
      prepLeadDays: 7,
    });
    expect(updated.filingStatus).toBe("single");
    expect(updated.state).toBe("CA");

    // Still a singleton — only one row, even after upsert.
    const events = await historyRepo.listFor("profile", "profile");
    expect(events.map((e) => e.op)).toEqual(["insert", "update"]);
  });
});

describe("repo — cross-table soft-delete + history isolation", () => {
  it("soft-deleting an expense does not affect mileage rows", async () => {
    const e = await expenseRepo.create({
      date: "2026-03-01",
      amountCents: 12_500,
      category: "supplies",
      clientId: null,
      description: null,
      reason: null,
      notes: null,
      flagForSection179: false,
      deletedAt: null,
    });
    await mileageRepo.create({
      date: "2026-03-15",
      vehicleId: null,
      businessMiles: 47,
      purpose: null,
      notes: null,
      deletedAt: null,
    });
    await expenseRepo.softDelete(e.id);
    const expenses = await expenseRepo.list();
    const miles = await mileageRepo.list();
    expect(expenses).toEqual([]);
    expect(miles).toHaveLength(1);

    // History should record the expense delete but no mileage events.
    const all = await historyRepo.listAll();
    const ops = all.map((h) => `${h.entity}:${h.op}`);
    expect(ops).toContain("expense:delete");
    expect(ops.filter((o) => o.startsWith("mileage")).length).toBe(1); // just the insert
  });
});

describe("repo — exhaustive table coverage", () => {
  it("vehicleRepo, homeOfficeRepo accept their full insert shapes", async () => {
    const v = await vehicleRepo.create({
      make: "Toyota",
      model: "RAV4",
      year: 2022,
      mpg: 28,
      method: "standard_mileage",
      inServiceDate: "2024-01-01",
      notes: null,
      deletedAt: null,
    });
    expect(v.make).toBe("Toyota");

    const ho = await homeOfficeRepo.create({
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
      deletedAt: null,
    });
    expect(ho.officeSqft).toBe(150);
  });
});
