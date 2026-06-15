import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import { taxYearCacheRepo } from "./tax-year-cache.ts";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = setupTestDb();
});
afterEach(() => {
  teardownTestDb(sqlite);
});

const sample = (year: number) => ({
  year,
  json: JSON.stringify({ year, marker: "test" }),
  schemaVersion: "v1",
  source: "IRS Rev. Proc. test",
  sourceUrl: `https://example.com/${year}.json`,
  fetchedAt: "2026-01-01T00:00:00.000Z",
  etag: null,
});

describe("taxYearCacheRepo", () => {
  it("upsert inserts a new row and reads it back", async () => {
    const row = await taxYearCacheRepo.upsert(sample(2026));
    expect(row.year).toBe(2026);
    expect(row.source).toBe("IRS Rev. Proc. test");
    const got = await taxYearCacheRepo.get(2026);
    expect(got?.json).toBe(JSON.stringify({ year: 2026, marker: "test" }));
  });

  it("upsert overwrites an existing row for the same year", async () => {
    await taxYearCacheRepo.upsert(sample(2026));
    await taxYearCacheRepo.upsert({
      ...sample(2026),
      source: "Updated source",
      fetchedAt: "2026-06-01T00:00:00.000Z",
    });
    const row = await taxYearCacheRepo.get(2026);
    expect(row?.source).toBe("Updated source");
    expect(row?.fetchedAt).toBe("2026-06-01T00:00:00.000Z");
    const all = await taxYearCacheRepo.list();
    // Still exactly one row.
    expect(all.filter((r) => r.year === 2026)).toHaveLength(1);
  });

  it("list returns rows in year-ascending order", async () => {
    await taxYearCacheRepo.upsert(sample(2027));
    await taxYearCacheRepo.upsert(sample(2025));
    await taxYearCacheRepo.upsert(sample(2026));
    const all = await taxYearCacheRepo.list();
    expect(all.map((r) => r.year)).toEqual([2025, 2026, 2027]);
  });

  it("delete removes a row and returns true; false if not found", async () => {
    await taxYearCacheRepo.upsert(sample(2026));
    expect(await taxYearCacheRepo.delete(2026)).toBe(true);
    expect(await taxYearCacheRepo.get(2026)).toBeUndefined();
    expect(await taxYearCacheRepo.delete(2026)).toBe(false);
  });
});
