import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Singleton row: id is hardcoded to "profile" so we can upsert by PK.
export const profile = sqliteTable("profile", {
  id: text("id").primaryKey(),
  filingStatus: text("filing_status").notNull(),
  state: text("state").notNull(),
  seStartDate: text("se_start_date").notNull(),
  dependents: integer("dependents").notNull().default(0),
  // Feature flags surfaced in the UI even when no data records exist yet.
  tracksRoth: integer("tracks_roth", { mode: "boolean" }).notNull().default(false),
  usesRetirement: integer("uses_retirement", { mode: "boolean" }).notNull().default(false),
  // Quarterly method preference; defaults to annualized.
  quarterlyMethod: text("quarterly_method").notNull().default("annualized"),
  // Lead time (days) before due date to start preparing.
  prepLeadDays: integer("prep_lead_days").notNull().default(14),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type ProfileRow = typeof profile.$inferSelect;
export type ProfileInsert = typeof profile.$inferInsert;
