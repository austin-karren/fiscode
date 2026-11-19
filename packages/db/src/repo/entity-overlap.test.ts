import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { EntityOverlapError } from "@fiscode/core";
import { exportBundle } from "@fiscode/csv";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import { emptyBundle, type Bundle } from "../bundle.ts";
import { buildBundle, entityRepo, historyRepo, importBundle } from "./index.ts";

const FIXED = "2026-06-04T12:00:00.000Z";

const input = (type: string, startDate: string, endDate: string | null) => ({
  type,
  startDate,
  endDate,
  notes: null,
  deletedAt: null,
});

const row = (id: string, type: string, startDate: string, endDate: string | null) => ({
  id,
  ...input(type, startDate, endDate),
  createdAt: FIXED,
  updatedAt: FIXED,
});

const rejection = async (write: Promise<unknown>): Promise<EntityOverlapError> => {
  const err = await write.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EntityOverlapError);
  return err as EntityOverlapError;
};

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = setupTestDb();
});
afterEach(() => {
  teardownTestDb(sqlite);
});

describe("entityRepo.create", () => {
  it("rejects a second open-ended period, names the first, and writes nothing", async () => {
    const first = await entityRepo.create(input("sole_prop", "2024-01-01", null));
    const historyBefore = await historyRepo.listAll();

    const err = await rejection(entityRepo.create(input("single_member_llc", "2026-11-02", null)));

    expect(err.conflict).toMatchObject({ id: first.id, type: "sole_prop" });
    expect(err.message).toBe(
      "This overlaps your Sole proprietor period that started Jan 1, 2024 and is still open. End that period first, or change these dates.",
    );
    expect(await entityRepo.list()).toEqual([first]);
    expect(await historyRepo.listAll()).toEqual(historyBefore);
  });

  it("accepts a period that starts on the day the other one ends", async () => {
    await entityRepo.create(input("sole_prop", "2024-01-01", "2026-11-18"));
    await entityRepo.create(input("single_member_llc", "2026-11-18", null));
    expect((await entityRepo.list()).map((e) => e.type)).toEqual([
      "sole_prop",
      "single_member_llc",
    ]);
  });

  it("ignores a deleted period", async () => {
    const gone = await entityRepo.create(input("sole_prop", "2024-01-01", null));
    await entityRepo.softDelete(gone.id);
    await entityRepo.create(input("single_member_llc", "2025-01-01", null));
    expect(await entityRepo.list()).toHaveLength(1);
  });
});

describe("entityRepo.update", () => {
  it("rejects moving a period onto another one and leaves the row as it was", async () => {
    const first = await entityRepo.create(input("sole_prop", "2024-01-01", "2024-12-31"));
    const second = await entityRepo.create(input("single_member_llc", "2025-01-01", null));

    const err = await rejection(entityRepo.update(first.id, { endDate: "2025-06-30" }));

    expect(err.conflict).toMatchObject({ id: second.id });
    expect(await entityRepo.get(first.id)).toEqual(first);
  });

  it("lets a period be edited without conflicting with itself", async () => {
    const only = await entityRepo.create(input("sole_prop", "2024-01-01", null));
    const updated = await entityRepo.update(only.id, { startDate: "2023-06-01" });
    expect(updated?.startDate).toBe("2023-06-01");
  });

  it("ending the open period makes room for the next one", async () => {
    const first = await entityRepo.create(input("sole_prop", "2024-01-01", null));
    await entityRepo.update(first.id, { endDate: "2026-11-18" });
    await entityRepo.create(input("single_member_llc", "2026-11-18", null));
    expect(await entityRepo.list()).toHaveLength(2);
  });

  it("returns undefined for an id that does not exist, as before", async () => {
    expect(await entityRepo.update("missing", { endDate: "2025-01-01" })).toBeUndefined();
  });
});

describe("entityRepo.revertTo", () => {
  it("rejects bringing back a deleted period that would now overlap", async () => {
    const old = await entityRepo.create(input("sole_prop", "2024-01-01", null));
    await entityRepo.softDelete(old.id);
    await entityRepo.create(input("single_member_llc", "2025-01-01", null));

    await rejection(entityRepo.revertTo(old.id, { ...old, deletedAt: null }));

    expect(await entityRepo.list()).toHaveLength(1);
  });
});

describe("periods that came in overlapping from a file", () => {
  // Lossless restore wins over the rule: the file is reproduced as it is.
  const overlapping = (): Bundle => ({
    ...emptyBundle(),
    entities: [
      row("ent_a", "sole_prop", "2024-01-01", null),
      row("ent_b", "single_member_llc", "2026-11-02", null),
    ],
  });

  const fullExport = async () =>
    exportBundle(await buildBundle({ includeDeleted: true, includeHistory: true }), {
      scope: "full",
    });

  it("a restore keeps both periods and exports to the same bytes", async () => {
    const file = exportBundle(overlapping(), { scope: "full" });
    await importBundle(overlapping(), "import-restore");
    expect(await entityRepo.list()).toHaveLength(2);
    expect(await fullExport()).toBe(file);
  });

  it("an edit that leaves them overlapping is rejected; one that separates them is saved", async () => {
    await importBundle(overlapping(), "import-restore");

    await rejection(entityRepo.update("ent_a", { endDate: "2026-12-31" }));

    const fixed = await entityRepo.update("ent_a", { endDate: "2026-11-02" });
    expect(fixed?.endDate).toBe("2026-11-02");
  });

  it("an edit that touches no date is not blocked", async () => {
    await importBundle(overlapping(), "import-restore");
    const noted = await entityRepo.update("ent_a", { notes: "restored from a backup" });
    expect(noted?.notes).toBe("restored from a backup");
  });
});
