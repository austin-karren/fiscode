import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Time tracking is for the user's own visibility; does not feed the tax estimate.
export const timeEntry = sqliteTable("time_entry", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  clientId: text("client_id"),
  minutes: integer("minutes").notNull(),
  description: text("description"),
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type TimeEntryRow = typeof timeEntry.$inferSelect;
export type TimeEntryInsert = typeof timeEntry.$inferInsert;
