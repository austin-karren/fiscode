import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Recurring clients/companies. Used as optional FK on income/time/expense.
export const client = sqliteTable("client", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type"), // user-defined freeform
  notes: text("notes"),
  defaultRateCents: integer("default_rate_cents"),
  defaultCommissionRate: integer("default_commission_rate_basis_points"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ClientRow = typeof client.$inferSelect;
export type ClientInsert = typeof client.$inferInsert;
