import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Date-ranged home office config so a move recomputes per period.
export const homeOffice = sqliteTable("home_office", {
  id: text("id").primaryKey(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  method: text("method").notNull().default("simplified"),
  officeSqft: integer("office_sqft"),
  homeSqft: integer("home_sqft"),
  // Actual-method monthly costs, in cents.
  monthlyRentMortgageCents: integer("monthly_rent_mortgage_cents"),
  monthlyUtilitiesCents: integer("monthly_utilities_cents"),
  monthlyInsuranceCents: integer("monthly_insurance_cents"),
  // IRS requires regular-and-exclusive-use acknowledgment.
  regularExclusiveAck: integer("regular_exclusive_ack", { mode: "boolean" })
    .notNull()
    .default(false),
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type HomeOfficeRow = typeof homeOffice.$inferSelect;
export type HomeOfficeInsert = typeof homeOffice.$inferInsert;
