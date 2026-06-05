import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Gated by profile.usesRetirement / tracksRoth feature flags.
// Schema exists so CSV round-trip works even before the UI lights it up.
export const retirementContribution = sqliteTable("retirement_contribution", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  // 'sep_ira' | 'solo_401k' | 'roth_ira'. Roth is informational only.
  account: text("account").notNull(),
  amountCents: integer("amount_cents").notNull(),
  // For solo 401(k): split employee/employer? Future. Single amount for now.
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type RetirementContributionRow = typeof retirementContribution.$inferSelect;
export type RetirementContributionInsert = typeof retirementContribution.$inferInsert;
