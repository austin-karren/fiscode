import { asc, eq } from "drizzle-orm";
import { getDb } from "../client.ts";
import {
  taxYearCache,
  type TaxYearCacheInsert,
  type TaxYearCacheRow,
} from "../schema/tax-year-cache.ts";

/**
 * Repo for the remote tax-year cache. Upsert-by-year semantics — each sync
 * either inserts a new row or replaces the existing one for that year.
 *
 * Not history-tracked: the cache is derived, not user-authored. A foreground
 * re-sync overwrites the prior payload.
 */
export const taxYearCacheRepo = {
  async list(): Promise<TaxYearCacheRow[]> {
    const db = getDb();
    return (await db
      .select()
      .from(taxYearCache)
      .orderBy(asc(taxYearCache.year))) as TaxYearCacheRow[];
  },

  async get(year: number): Promise<TaxYearCacheRow | undefined> {
    const db = getDb();
    const rows = (await db
      .select()
      .from(taxYearCache)
      .where(eq(taxYearCache.year, year))
      .limit(1)) as TaxYearCacheRow[];
    return rows[0];
  },

  async upsert(input: TaxYearCacheInsert & { year: number }): Promise<TaxYearCacheRow> {
    const db = getDb();
    const year = input.year;
    const existing = await taxYearCacheRepo.get(year);
    if (existing) {
      await db.update(taxYearCache).set(input).where(eq(taxYearCache.year, year));
    } else {
      await db.insert(taxYearCache).values(input);
    }
    const after = (await db
      .select()
      .from(taxYearCache)
      .where(eq(taxYearCache.year, year))
      .limit(1)) as TaxYearCacheRow[];
    return after[0]!;
  },

  async delete(year: number): Promise<boolean> {
    const db = getDb();
    const before = await taxYearCacheRepo.get(year);
    if (!before) return false;
    await db.delete(taxYearCache).where(eq(taxYearCache.year, year));
    return true;
  },
};
