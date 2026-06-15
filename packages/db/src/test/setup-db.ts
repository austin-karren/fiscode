import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { __resetDbForTests, __setDbForTests } from "../client.ts";
import { tables } from "../schema/index.ts";

/**
 * Spin up a fresh in-memory SQLite database, run the migration files against
 * it, and inject the resulting Drizzle handle into the @fiscode/db singleton.
 * The repo layer then operates on this DB transparently.
 *
 * The boot.ts path (which uses sqlocal + import.meta.glob) is bypassed —
 * migrations are loaded directly from disk via node:fs.
 */
export const setupTestDb = () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(here, "..", "migrations");
  const sqlite = new Database(":memory:");
  // Match production: enable foreign keys & WAL would not matter for an
  // in-memory DB, but mirror sane defaults.
  sqlite.pragma("foreign_keys = ON");

  // Apply every .sql migration in sorted order.
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    sqlite.exec(sql);
  }

  const db = drizzle(sqlite, { schema: tables, casing: "snake_case" });
  __setDbForTests(db as never);
  return sqlite;
};

export const teardownTestDb = (sqlite: Database.Database) => {
  __resetDbForTests();
  sqlite.close();
};
