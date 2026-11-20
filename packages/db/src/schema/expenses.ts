import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const expense = sqliteTable(
  "expense",
  {
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
    flagForSection179: integer("flag_for_section_179", { mode: "boolean" })
      .notNull()
      .default(false),
    // Section 195 startup expense — counts toward the year even if dated before
    // the user's SE start. Items purchased in anticipation of beginning 1099 work
    // (ordinary, necessary, used exclusively for the business once active).
    startupExpense: integer("startup_expense", { mode: "boolean" }).notNull().default(false),
    // Equipment: the date it was placed in service (ISO YYYY-MM-DD), when that
    // differs from the purchase date. Pub 946: "You begin to depreciate your
    // property when you place it in service for use in your trade or business".
    // Equipment bought before the business began is placed in service when it
    // begins. Null means the purchase date.
    placedInServiceDate: text("placed_in_service_date"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // Matches the index created by 0000_bootstrap.sql.
  (t) => [index("expense_date_idx").on(t.date)],
);

export type ExpenseRow = typeof expense.$inferSelect;
export type ExpenseInsert = typeof expense.$inferInsert;
