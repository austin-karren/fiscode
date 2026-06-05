import { getRawSqlocal } from "./client.ts";

// `import.meta.glob` is injected by Vite at build time. Cast through `any`
// to keep this package independent of `vite/client` types — the consumer
// (apps/web) provides the runtime.
const migrationModules = (
  import.meta as unknown as {
    glob: (
      pattern: string,
      options: { eager: true; query: "?raw"; import: "default" },
    ) => Record<string, string>;
  }
).glob("./migrations/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
});

let _bootPromise: Promise<void> | undefined;

const runMigrations = async (): Promise<void> => {
  const sqlocal = getRawSqlocal();
  // Track applied migrations in-DB so re-running boot is a no-op.
  await sqlocal.sql(`CREATE TABLE IF NOT EXISTS __migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (current_timestamp)
  )`);
  const appliedRows = (await sqlocal.sql(`SELECT name FROM __migrations`)) as Array<{
    name: string;
  }>;
  const applied = new Set(appliedRows.map((r) => r.name));
  const sortedKeys = Object.keys(migrationModules).sort();
  for (const key of sortedKeys) {
    const name = key.split("/").pop()!;
    if (applied.has(name)) continue;
    const sql = migrationModules[key]!;
    // Split on `;\n` for multi-statement files. SQLocal's sql tag accepts
    // single statements, so iterate.
    const statements = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await sqlocal.sql(stmt);
    }
    await sqlocal.sql(
      `INSERT INTO __migrations (name) VALUES (${"'" + name.replaceAll("'", "''") + "'"})`,
    );
  }
};

/**
 * Idempotent boot: open the DB, apply any unapplied migrations. Resolves once
 * the DB is ready to read/write. Safe to call multiple times.
 */
export const boot = (): Promise<void> => {
  if (!_bootPromise) {
    _bootPromise = runMigrations();
  }
  return _bootPromise;
};

export const __resetBootForTests = () => {
  _bootPromise = undefined;
};
