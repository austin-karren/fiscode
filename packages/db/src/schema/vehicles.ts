import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const vehicle = sqliteTable("vehicle", {
  id: text("id").primaryKey(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year"),
  mpg: integer("mpg"),
  // First-year election is locked in for owned vehicles (standard mileage vs
  // actual expense). Track per-vehicle which method applies.
  // todo: enforce first-year election lock-in in UI; for now this is informational.
  method: text("method").notNull().default("standard_mileage"),
  inServiceDate: text("in_service_date"),
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type VehicleRow = typeof vehicle.$inferSelect;
export type VehicleInsert = typeof vehicle.$inferInsert;

export const mileage = sqliteTable("mileage", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  vehicleId: text("vehicle_id"),
  businessMiles: integer("business_miles").notNull(),
  purpose: text("purpose"),
  notes: text("notes"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type MileageRow = typeof mileage.$inferSelect;
export type MileageInsert = typeof mileage.$inferInsert;
