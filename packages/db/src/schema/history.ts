import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// Append-only version table. Every mutation writes a row here in the same
// transaction as the actual change, so we have a full revertible history.
export const history = sqliteTable("history", {
  id: text("id").primaryKey(),
  entity: text("entity").notNull(), // table name
  entityId: text("entity_id").notNull(),
  op: text("op").notNull(), // 'insert' | 'update' | 'delete' | 'revert'
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  at: text("at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type HistoryRow = typeof history.$inferSelect;
export type HistoryInsert = typeof history.$inferInsert;
