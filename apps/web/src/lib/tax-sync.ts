import {
  DEFAULT_TAX_DATA_BASE_URL,
  HARDCODED_CONFIG_YEARS,
  TAX_YEAR_WIRE_SCHEMA_VERSION,
  clearOverlay,
  getOverlayMeta,
  registerOverlayYearConfig,
  taxYearDataUrl,
  taxYearWireSchema,
  wireToYearConfig,
} from "@fiscode/tax";
import { taxYearCacheRepo, type TaxYearCacheRow } from "@fiscode/db";

/**
 * Tax-year data sync orchestration. Bridges the @fiscode/tax overlay (pure,
 * in-memory) and the @fiscode/db cache (OPFS-backed, durable).
 *
 * Flow:
 *   - On app boot, `hydrateOverlayFromCache` reads every cached row, validates
 *     each through the wire schema, and registers it into the in-memory
 *     overlay so `getYearConfig(year)` picks up the latest cached numbers.
 *   - `syncTaxYearData(year)` fetches the remote JSON, validates, persists,
 *     and updates the overlay. Throws on failure — callers decide whether to
 *     surface the error or swallow it.
 *   - `syncTaxYearDataSilently(years)` is the boot-time fire-and-forget
 *     entry point — every error is caught and logged to console.debug only.
 */

const STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const FETCH_TIMEOUT_MS = 10_000;

const baseUrl = (): string => {
  // Vite exposes env vars prefixed with VITE_. Falls back to the default URL.
  const override = (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_TAX_DATA_BASE_URL;
  return override || DEFAULT_TAX_DATA_BASE_URL;
};

export type TaxYearSyncStatus = {
  year: number;
  source: "remote" | "hardcoded" | "missing";
  schemaVersion: string | undefined;
  remoteSource: string | undefined;
  sourceUrl: string;
  fetchedAt: string | undefined;
  ageMs: number | undefined;
  isStale: boolean;
};

/**
 * Read all cached rows and populate the @fiscode/tax overlay. Rows whose
 * schemaVersion mismatches the current build are skipped (a follow-up sync
 * will replace them with the new shape).
 */
export const hydrateOverlayFromCache = async (): Promise<{
  loaded: number;
  skipped: number;
}> => {
  clearOverlay();
  const rows = await taxYearCacheRepo.list();
  let loaded = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.schemaVersion !== TAX_YEAR_WIRE_SCHEMA_VERSION) {
      skipped++;
      continue;
    }
    const parsed = taxYearWireSchema.safeParse(JSON.parse(row.json));
    if (!parsed.success) {
      skipped++;
      continue;
    }
    registerOverlayYearConfig(wireToYearConfig(parsed.data), {
      fetchedAt: row.fetchedAt,
      source: row.source,
      sourceUrl: row.sourceUrl,
      schemaVersion: row.schemaVersion,
    });
    loaded++;
  }
  return { loaded, skipped };
};

const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`fetch timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export class TaxSyncError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TaxSyncError";
  }
}

/**
 * Fetch + validate + persist + overlay-register a single year. Throws
 * `TaxSyncError` on any failure. Callers decide whether to surface to UI
 * (foreground "Sync" button) or swallow (background boot sync).
 */
export const syncTaxYearData = async (year: number): Promise<TaxYearCacheRow> => {
  const url = taxYearDataUrl(year, baseUrl());
  let response: Response;
  try {
    response = await withTimeout(
      fetch(url, { headers: { accept: "application/json" } }),
      FETCH_TIMEOUT_MS,
    );
  } catch (e) {
    throw new TaxSyncError(`Network error fetching ${url}`, e);
  }
  if (!response.ok) {
    throw new TaxSyncError(`Mirror returned ${response.status} for ${url}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (e) {
    throw new TaxSyncError(`Mirror returned non-JSON for ${url}`, e);
  }
  const parsed = taxYearWireSchema.safeParse(json);
  if (!parsed.success) {
    throw new TaxSyncError(
      `Mirror payload failed schema validation: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }
  if (parsed.data.year !== year) {
    throw new TaxSyncError(`Mirror returned year ${parsed.data.year} but we requested ${year}`);
  }
  const row = await taxYearCacheRepo.upsert({
    year,
    json: JSON.stringify(parsed.data),
    schemaVersion: parsed.data.schemaVersion,
    source: parsed.data.source,
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    etag: response.headers.get("etag") ?? null,
  });
  // Update the in-session overlay so the UI sees fresh numbers without reload.
  registerOverlayYearConfig(wireToYearConfig(parsed.data), {
    fetchedAt: row.fetchedAt,
    source: row.source,
    sourceUrl: row.sourceUrl,
    schemaVersion: row.schemaVersion,
  });
  return row;
};

/**
 * Background sync. Iterates a list of years; per-year failures are caught
 * and logged at debug level only. Resolves once every attempt has completed.
 */
export const syncTaxYearDataSilently = async (years: number[]): Promise<void> => {
  await Promise.all(
    years.map(async (year) => {
      try {
        await syncTaxYearData(year);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.debug(`[fiscode/tax-sync] silent sync failed for ${year}:`, e);
      }
    }),
  );
};

/**
 * Status row for the settings UI: per-year source, freshness, stale flag.
 */
export const statusForYear = async (year: number): Promise<TaxYearSyncStatus> => {
  const url = taxYearDataUrl(year, baseUrl());
  const cached = await taxYearCacheRepo.get(year);
  if (cached) {
    const meta = getOverlayMeta(year);
    const fetchedAt = cached.fetchedAt;
    const ageMs = Date.now() - new Date(fetchedAt).getTime();
    return {
      year,
      source: "remote",
      schemaVersion: cached.schemaVersion,
      remoteSource: meta?.source ?? cached.source,
      sourceUrl: cached.sourceUrl,
      fetchedAt,
      ageMs,
      isStale: ageMs > STALE_AFTER_MS,
    };
  }
  if (HARDCODED_CONFIG_YEARS.includes(year)) {
    return {
      year,
      source: "hardcoded",
      schemaVersion: undefined,
      remoteSource: undefined,
      sourceUrl: url,
      fetchedAt: undefined,
      ageMs: undefined,
      isStale: false,
    };
  }
  return {
    year,
    source: "missing",
    schemaVersion: undefined,
    remoteSource: undefined,
    sourceUrl: url,
    fetchedAt: undefined,
    ageMs: undefined,
    isStale: false,
  };
};

/**
 * Which years to keep synchronized in the background. Currently:
 * the current calendar year + the prior year (for tax-prep flows in Q1).
 */
export const yearsToTrack = (now = new Date()): number[] => {
  const y = now.getFullYear();
  return [y - 1, y];
};

/**
 * Yes/no — should we attempt a background sync for this year?
 * Returns false if a fresh cached row exists (saves a roundtrip).
 */
export const shouldSyncInBackground = async (year: number): Promise<boolean> => {
  const cached = await taxYearCacheRepo.get(year);
  if (!cached) return true;
  if (cached.schemaVersion !== TAX_YEAR_WIRE_SCHEMA_VERSION) return true;
  const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
  return ageMs > STALE_AFTER_MS;
};
