import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * A vault plan whose rows committed (ADR 0001 § 6). Written in the same transaction as the rows;
 * on boot a journal left behind is rolled forward when its plan id is here, back when not.
 */
export const vaultApplied = sqliteTable("vault_applied", {
  planId: text("plan_id").primaryKey(),
});

/** Small app-wide facts, one per key: e.g. that the vault migration is done, and its report. */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
