import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const income = sqliteTable("income", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  clientId: text("client_id"),
  amountCents: integer("amount_cents").notNull(),
  // '1099' or 'w2'. All entries are 1099 today; the flag must exist because
  // tax math forks on it (W-2 not subject to SE tax, no QBI, no home office).
  sourceType: text("source_type").notNull().default("1099"),
  kind: text("kind").notNull().default("recurring"),
  description: text("description"),
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type IncomeRow = typeof income.$inferSelect;
export type IncomeInsert = typeof income.$inferInsert;
