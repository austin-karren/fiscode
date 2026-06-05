import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const expense = sqliteTable("expense", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  category: text("category").notNull(),
  clientId: text("client_id"),
  description: text("description"),
  reason: text("reason"),
  notes: text("notes"),
  // Flag for large purchases / potential Section 179 / bonus depreciation review.
  // todo: tie this to a year-end review prompt in the dashboard.
  flagForSection179: integer("flag_for_section_179", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ExpenseRow = typeof expense.$inferSelect;
export type ExpenseInsert = typeof expense.$inferInsert;
