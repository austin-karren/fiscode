import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The taxpayer's own W-2s and the estimated tax payments they made (DF-07). The spouse's W-2
// income stays in `spouse` blocks.

/** One W-2: one employer, one tax year. Amounts are the W-2 boxes, in cents. */
export const w2Job = sqliteTable("w2_job", {
  id: text("id").primaryKey(),
  taxYear: integer("tax_year").notNull(),
  employer: text("employer").notNull(),
  // The days worked that year, for display; the amounts are the W-2's.
  startDate: text("start_date"),
  endDate: text("end_date"),
  wagesCents: integer("wages_cents").notNull().default(0), // box 1
  federalWithholdingCents: integer("federal_withholding_cents").notNull().default(0), // box 2
  ssWagesCents: integer("ss_wages_cents").notNull().default(0), // box 3
  ssTaxWithheldCents: integer("ss_tax_withheld_cents").notNull().default(0), // box 4
  medicareWagesCents: integer("medicare_wages_cents").notNull().default(0), // box 5
  ssTipsCents: integer("ss_tips_cents").notNull().default(0), // box 7
  stateWagesCents: integer("state_wages_cents").notNull().default(0), // box 16
  stateWithholdingCents: integer("state_withholding_cents").notNull().default(0), // box 17
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** An estimated tax payment made, federal or Utah, for one tax year. */
export const estimatedPayment = sqliteTable("estimated_payment", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  // 'federal' | 'UT'
  jurisdiction: text("jurisdiction").notNull(),
  // The year it is for: a January payment is usually the prior year's fourth installment.
  taxYear: integer("tax_year").notNull(),
  // 1-4, or null: derived from the date by the year's due dates.
  appliedQuarter: integer("applied_quarter"),
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type W2JobRow = typeof w2Job.$inferSelect;
export type W2JobInsert = typeof w2Job.$inferInsert;
export type EstimatedPaymentRow = typeof estimatedPayment.$inferSelect;
export type EstimatedPaymentInsert = typeof estimatedPayment.$inferInsert;
