import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { EntityDatesError, EntityOverlapError } from "@fiscode/core";
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
      "This overlaps your Sole proprietor period that started Jan 1, 2024 and is still open. End that period first, or change these dates. A period may start on the day the other one ends.",
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

describe("shortening a period", () => {
  // A ends on day D and B starts on day D: the allowed changeover.
  const changeover = async () => {
    const a = await entityRepo.create(input("sole_prop", "2024-01-01", "2026-11-18"));
    const b = await entityRepo.create(input("single_member_llc", "2026-11-18", null));
    return { a, b };
  };

  it("is rejected when it would leave two periods starting on one day", async () => {
    const { a, b } = await changeover();

    // Creating that one-day period is rejected ...
    await rejection(entityRepo.create(input("sole_prop", "2026-11-18", "2026-11-18")));
    // ... so shrinking an existing period into it is rejected too.
    const err = await rejection(entityRepo.update(a.id, { startDate: "2026-11-18" }));

    expect(err.conflict).toMatchObject({ id: b.id });
    expect(err.preexisting).toBe(false);
    expect(err.message).toContain("This overlaps your Single-member LLC period");
    expect((await entityRepo.get(a.id))?.startDate).toBe("2024-01-01");
  });

  it("is saved when it creates no overlap", async () => {
    const { a } = await changeover();
    const saved = await entityRepo.update(a.id, { startDate: "2026-11-17" });
    expect(saved?.startDate).toBe("2026-11-17");
  });

  it("is rejected for a conflict it creates, also for a period that already overlapped another", async () => {
    // ent_a already overlaps ent_b. ent_c starts on the day ent_a ends.
    await importBundle(
      {
        ...emptyBundle(),
        entities: [
          row("ent_a", "sole_prop", "2024-01-01", "2026-12-31"),
          row("ent_b", "single_member_llc", "2026-11-02", "2026-11-30"),
          row("ent_c", "sole_prop", "2026-12-31", null),
        ],
      },
      "import-restore",
    );

    const err = await rejection(entityRepo.update("ent_a", { startDate: "2026-12-31" }));

    expect(err.conflict).toMatchObject({ id: "ent_c" });
    expect(err.preexisting).toBe(false);
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

  it("either period can be ended, even on a day that leaves them overlapping", async () => {
    await importBundle(overlapping(), "import-restore");

    // "End today" on the older one: it still overlaps the newer one, but that
    // overlap was already there and the edit only made the period shorter.
    const older = await entityRepo.update("ent_a", { endDate: "2026-11-18" });
    expect(older?.endDate).toBe("2026-11-18");

    const newer = await entityRepo.update("ent_b", { endDate: "2026-11-18" });
    expect(newer?.endDate).toBe("2026-11-18");
  });

  it("a save that changes no date goes through, as the edit dialog sends it", async () => {
    await importBundle(overlapping(), "import-restore");
    const saved = await entityRepo.update("ent_a", {
      type: "sole_prop",
      startDate: "2024-01-01",
      endDate: null,
    });
    expect(saved).toMatchObject({ startDate: "2024-01-01", endDate: null });
  });

  it("moving the start later, still overlapping as before, goes through", async () => {
    await importBundle(overlapping(), "import-restore");
    const saved = await entityRepo.update("ent_a", { startDate: "2025-01-01" });
    expect(saved?.startDate).toBe("2025-01-01");
  });

  it("widening one of them is still rejected, with a message that is not circular", async () => {
    await importBundle(overlapping(), "import-restore");

    const err = await rejection(entityRepo.update("ent_a", { startDate: "2023-01-01" }));

    expect(err.preexisting).toBe(true);
    expect(err.message).toContain("already overlaps your Single-member LLC period");
    expect(err.message).not.toContain("End that period first");
    expect((await entityRepo.get("ent_a"))?.startDate).toBe("2024-01-01");
  });

  it("an overlap the edit itself would create is not called pre-existing", async () => {
    await entityRepo.create(input("sole_prop", "2024-01-01", "2024-12-31"));
    const second = await entityRepo.create(input("single_member_llc", "2025-01-01", null));
    const err = await rejection(entityRepo.update(second.id, { startDate: "2024-06-01" }));
    expect(err.preexisting).toBe(false);
    expect(err.message).toContain("Change these dates");
  });

  it("separating them is saved", async () => {
    await importBundle(overlapping(), "import-restore");
    const fixed = await entityRepo.update("ent_a", { endDate: "2026-11-02" });
    expect(fixed?.endDate).toBe("2026-11-02");
  });

  it("an edit that touches no date is not blocked", async () => {
    await importBundle(overlapping(), "import-restore");
    const noted = await entityRepo.update("ent_a", { notes: "restored from a backup" });
    expect(noted?.notes).toBe("restored from a backup");
  });
});

describe("an end date before the start date", () => {
  const datesRejection = async (write: Promise<unknown>): Promise<EntityDatesError> => {
    const err = await write.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EntityDatesError);
    return err as EntityDatesError;
  };

  it("create rejects it, so it cannot be used to get around the overlap rule", async () => {
    await entityRepo.create(input("sole_prop", "2024-01-01", null));

    const err = await datesRejection(
      entityRepo.create(input("single_member_llc", "2026-11-02", "2023-01-01")),
    );

    expect(err.message).toBe(
      "The end date (Jan 1, 2023) is before the start date (Nov 2, 2026). Pick an end date on or after the start date, or leave it empty for a period that is still open.",
    );
    expect(await entityRepo.list()).toHaveLength(1);
  });

  it("update rejects it, also when the change only shortens the period", async () => {
    const only = await entityRepo.create(input("sole_prop", "2024-01-01", null));
    await datesRejection(entityRepo.update(only.id, { endDate: "2023-12-31" }));
    expect((await entityRepo.get(only.id))?.endDate).toBeNull();
  });

  it("revertTo rejects it", async () => {
    const only = await entityRepo.create(input("sole_prop", "2024-01-01", null));
    await datesRejection(entityRepo.revertTo(only.id, { ...only, endDate: "2023-12-31" }));
  });

  it("a one-day period is fine", async () => {
    const day = await entityRepo.create(input("sole_prop", "2024-05-05", "2024-05-05"));
    expect(day.endDate).toBe("2024-05-05");
  });

  it("a file that holds such a row restores exactly, and the row can still be given notes", async () => {
    const inverted: Bundle = {
      ...emptyBundle(),
      entities: [row("ent_inv", "sole_prop", "2026-11-02", "2023-01-01")],
    };
    const file = exportBundle(inverted, { scope: "full" });
    await importBundle(inverted, "import-restore");

    expect(
      exportBundle(await buildBundle({ includeDeleted: true, includeHistory: true }), {
        scope: "full",
      }),
    ).toBe(file);
    const noted = await entityRepo.update("ent_inv", { notes: "from a file" });
    expect(noted?.notes).toBe("from a file");
  });
});
