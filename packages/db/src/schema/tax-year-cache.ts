import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Cached remote tax-year configs. One row per year. The full validated wire
 * JSON is stored verbatim so we can reproduce the exact remote payload (and
 * re-validate against a newer schema version later).
 *
 * Keyed by `year` (INTEGER PK). Not a soft-delete table — overwrite on sync.
 */
export const taxYearCache = sqliteTable("tax_year_cache", {
  year: integer("year").primaryKey(),
  // Full validated wire JSON.
  json: text("json").notNull(),
  // Wire schema version. Mismatches trigger a re-fetch.
  schemaVersion: text("schema_version").notNull(),
  // Human-readable provenance from the wire envelope.
  source: text("source").notNull(),
  // URL we actually fetched (after any base-url override).
  sourceUrl: text("source_url").notNull(),
  // ISO timestamp of the successful local persist.
  fetchedAt: text("fetched_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  // Optional ETag from the response, for conditional refetches.
  etag: text("etag"),
});

export type TaxYearCacheRow = typeof taxYearCache.$inferSelect;
export type TaxYearCacheInsert = typeof taxYearCache.$inferInsert;
