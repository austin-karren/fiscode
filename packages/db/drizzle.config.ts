import { defineConfig } from "drizzle-kit";

// `bun run db:generate` (drizzle-kit generate) diffs the schema against the
// latest snapshot in src/migrations/meta and writes the next migration there.
// The app (boot.ts) and the tests (test/setup-db.ts) apply every
// src/migrations/*.sql in name order; meta/ is drizzle-kit's bookkeeping only.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  // Matches the drizzle() calls in client.ts and test/setup-db.ts.
  casing: "snake_case",
});
