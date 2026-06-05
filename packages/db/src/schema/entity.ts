import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Date-ranged entity periods. type in ('sole_prop' | 'single_member_llc' | 's_corp').
export const entity = sqliteTable("entity", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type EntityRow = typeof entity.$inferSelect;
export type EntityInsert = typeof entity.$inferInsert;

// Date-ranged spouse W-2 block.
export const spouse = sqliteTable("spouse", {
  id: text("id").primaryKey(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  annualW2WagesCents: integer("annual_w2_wages_cents").notNull().default(0),
  annualFederalWithholdingCents: integer("annual_federal_withholding_cents").notNull().default(0),
  annualStateWithholdingCents: integer("annual_state_withholding_cents").notNull().default(0),
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type SpouseRow = typeof spouse.$inferSelect;
export type SpouseInsert = typeof spouse.$inferInsert;
