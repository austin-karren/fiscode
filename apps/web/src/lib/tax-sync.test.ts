import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, teardownTestDb } from "@fiscode/db/test";
import { taxYearCacheRepo } from "@fiscode/db";
import {
  TAX_YEAR_WIRE_SCHEMA_VERSION,
  clearOverlay,
  config2026,
  getOverlayMeta,
  getOverlayYearConfig,
  yearConfigToWire,
} from "@fiscode/tax";
import {
  hydrateOverlayFromCache,
  shouldSyncInBackground,
  statusForYear,
  syncTaxYearData,
  syncTaxYearDataSilently,
  TaxSyncError,
  yearsToTrack,
} from "./tax-sync";

const FIXED = "2026-06-04T12:00:00.000Z";

const validWire = (year = 2026, overrides: Partial<ReturnType<typeof yearConfigToWire>> = {}) => ({
  ...yearConfigToWire(config2026, "Test Mirror", FIXED),
  year,
  ...overrides,
});

const mockFetchJson = (body: unknown, init: { status?: number; etag?: string } = {}) => {
  const res = new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.etag
      ? { "content-type": "application/json", etag: init.etag }
      : { "content-type": "application/json" },
  });
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
};

let sqlite: ReturnType<typeof setupTestDb>;
beforeEach(() => {
  sqlite = setupTestDb();
  clearOverlay();
});
afterEach(() => {
  teardownTestDb(sqlite);
  vi.restoreAllMocks();
});

describe("syncTaxYearData — happy path", () => {
  it("fetches, validates, persists, and overlays", async () => {
    mockFetchJson(validWire(2026));
    const row = await syncTaxYearData(2026);
    expect(row.year).toBe(2026);
    expect(row.schemaVersion).toBe(TAX_YEAR_WIRE_SCHEMA_VERSION);
    expect(row.source).toBe("Test Mirror");

    // Cache row landed.
    const cached = await taxYearCacheRepo.get(2026);
    expect(cached?.year).toBe(2026);

    // Overlay updated.
    expect(getOverlayYearConfig(2026)?.year).toBe(2026);
    expect(getOverlayMeta(2026)?.source).toBe("Test Mirror");
  });

  it("captures ETag when the server provides one", async () => {
    mockFetchJson(validWire(2026), { etag: 'W/"abc123"' });
    const row = await syncTaxYearData(2026);
    expect(row.etag).toBe('W/"abc123"');
  });
});

describe("syncTaxYearData — failure modes throw TaxSyncError", () => {
  it("network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENETUNREACH"));
    await expect(syncTaxYearData(2026)).rejects.toBeInstanceOf(TaxSyncError);
  });

  it("non-2xx status", async () => {
    mockFetchJson({}, { status: 404 });
    await expect(syncTaxYearData(2026)).rejects.toThrow(/404/);
  });

  it("non-JSON body", async () => {
    const res = new Response("<!DOCTYPE html>", { status: 200 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
    await expect(syncTaxYearData(2026)).rejects.toThrow(/non-JSON/);
  });

  it("payload fails schema validation", async () => {
    mockFetchJson({ year: 2026, schemaVersion: "v1" }); // missing most fields
    await expect(syncTaxYearData(2026)).rejects.toThrow(/schema validation/);
  });

  it("payload year mismatches requested year", async () => {
    mockFetchJson(validWire(2027));
    await expect(syncTaxYearData(2026)).rejects.toThrow(/year 2027 but we requested 2026/);
  });

  it("on failure, no cache row is written and no overlay is registered", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(syncTaxYearData(2026)).rejects.toBeInstanceOf(TaxSyncError);
    expect(await taxYearCacheRepo.get(2026)).toBeUndefined();
    expect(getOverlayYearConfig(2026)).toBeUndefined();
  });
});

describe("syncTaxYearDataSilently — background sync", () => {
  it("never throws even when every year fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(syncTaxYearDataSilently([2025, 2026])).resolves.toBeUndefined();
  });

  it("a single failing year doesn't prevent others from succeeding", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("first failed");
      return new Response(JSON.stringify(validWire(2026)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await syncTaxYearDataSilently([2025, 2026]);
    expect(await taxYearCacheRepo.get(2025)).toBeUndefined();
    expect(await taxYearCacheRepo.get(2026)).toBeDefined();
  });
});

describe("hydrateOverlayFromCache", () => {
  it("loads every valid cache row into the overlay", async () => {
    await taxYearCacheRepo.upsert({
      year: 2026,
      json: JSON.stringify(validWire(2026)),
      schemaVersion: TAX_YEAR_WIRE_SCHEMA_VERSION,
      source: "Test Mirror",
      sourceUrl: "https://example.com/2026.json",
      fetchedAt: FIXED,
      etag: null,
    });
    const { loaded, skipped } = await hydrateOverlayFromCache();
    expect(loaded).toBe(1);
    expect(skipped).toBe(0);
    expect(getOverlayYearConfig(2026)?.year).toBe(2026);
  });

  it("skips rows whose schemaVersion is stale", async () => {
    await taxYearCacheRepo.upsert({
      year: 2026,
      json: JSON.stringify(validWire(2026)),
      schemaVersion: "v0",
      source: "Old Mirror",
      sourceUrl: "x",
      fetchedAt: FIXED,
      etag: null,
    });
    const { loaded, skipped } = await hydrateOverlayFromCache();
    expect(loaded).toBe(0);
    expect(skipped).toBe(1);
    expect(getOverlayYearConfig(2026)).toBeUndefined();
  });

  it("skips rows whose payload no longer matches the schema", async () => {
    await taxYearCacheRepo.upsert({
      year: 2026,
      json: JSON.stringify({ year: 2026, schemaVersion: "v1" }), // missing fields
      schemaVersion: TAX_YEAR_WIRE_SCHEMA_VERSION,
      source: "Corrupt",
      sourceUrl: "x",
      fetchedAt: FIXED,
      etag: null,
    });
    const { loaded, skipped } = await hydrateOverlayFromCache();
    expect(loaded).toBe(0);
    expect(skipped).toBe(1);
  });
});

describe("statusForYear", () => {
  it("reports 'remote' + freshness for a cached year", async () => {
    mockFetchJson(validWire(2026));
    await syncTaxYearData(2026);
    const s = await statusForYear(2026);
    expect(s.source).toBe("remote");
    expect(s.fetchedAt).toBeDefined();
    expect(s.isStale).toBe(false);
  });

  it("reports 'hardcoded' for years bundled with the app", async () => {
    const s = await statusForYear(2025);
    expect(s.source).toBe("hardcoded");
    expect(s.fetchedAt).toBeUndefined();
  });

  it("reports 'missing' for years with neither cache nor hardcoded config", async () => {
    const s = await statusForYear(2030);
    expect(s.source).toBe("missing");
  });

  it("marks rows older than the stale threshold as stale", async () => {
    const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
    await taxYearCacheRepo.upsert({
      year: 2026,
      json: JSON.stringify(validWire(2026)),
      schemaVersion: TAX_YEAR_WIRE_SCHEMA_VERSION,
      source: "old",
      sourceUrl: "x",
      fetchedAt: longAgo,
      etag: null,
    });
    const s = await statusForYear(2026);
    expect(s.isStale).toBe(true);
  });
});

describe("shouldSyncInBackground", () => {
  it("returns true when no cache exists", async () => {
    expect(await shouldSyncInBackground(2026)).toBe(true);
  });

  it("returns false when cache is fresh", async () => {
    mockFetchJson(validWire(2026));
    await syncTaxYearData(2026);
    expect(await shouldSyncInBackground(2026)).toBe(false);
  });

  it("returns true when cache schemaVersion is stale", async () => {
    await taxYearCacheRepo.upsert({
      year: 2026,
      json: JSON.stringify(validWire(2026)),
      schemaVersion: "v0",
      source: "old schema",
      sourceUrl: "x",
      fetchedAt: new Date().toISOString(),
      etag: null,
    });
    expect(await shouldSyncInBackground(2026)).toBe(true);
  });
});

describe("yearsToTrack", () => {
  it("returns [prev, current] given the current date", () => {
    // Use local-time constructors to avoid UTC/local boundary flakiness on
    // dates like "2027-01-01T00:00:00Z" which becomes 2026 in TZs west of UTC.
    expect(yearsToTrack(new Date(2026, 5, 15))).toEqual([2025, 2026]);
    expect(yearsToTrack(new Date(2027, 0, 5))).toEqual([2026, 2027]);
  });
});
