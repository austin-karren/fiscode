import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { SQLocalDrizzle } from "sqlocal/drizzle";
import { tables } from "./schema/index.ts";

const DB_FILE = "fiscode.sqlite";

let _sqlocal: SQLocalDrizzle | undefined;
let _db: ReturnType<typeof makeDb> | undefined;

const makeDb = (sqlocal: SQLocalDrizzle) =>
  drizzle(sqlocal.driver, sqlocal.batchDriver, { schema: tables, casing: "snake_case" });

/**
 * Returns a singleton Drizzle client over OPFS. Safe to call from anywhere in
 * the app. The first call instantiates SQLocal in a worker; subsequent calls
 * return the same handle.
 */
export const getDb = () => {
  if (_db) return _db;
  _sqlocal = new SQLocalDrizzle({ databasePath: DB_FILE });
  _db = makeDb(_sqlocal);
  return _db;
};

export const getRawSqlocal = (): SQLocalDrizzle => {
  if (!_sqlocal) {
    getDb();
  }
  return _sqlocal!;
};

/** For tests: tear down the singleton so a fresh in-memory db can be re-init'd. */
export const __resetDbForTests = () => {
  _atomicForTests = undefined;
  _db = undefined;
  _sqlocal = undefined;
};

/**
 * For tests: inject a Drizzle handle (typically built on better-sqlite3) so the
 * repo layer can be exercised in Node. The injected handle bypasses the
 * SQLocal/OPFS path entirely; callers must apply migrations themselves before
 * issuing queries. Pass `undefined` to clear.
 */
export const __setDbForTests = (
  db: ReturnType<typeof makeDb> | undefined,
  atomic?: AtomicRunner,
) => {
  _db = db;
  _sqlocal = undefined;
  _atomicForTests = db ? atomic : undefined;
};

export type AtomicQuery = BatchItem<"sqlite">;
type AtomicRunner = (queries: readonly AtomicQuery[]) => Promise<void>;

let _atomicForTests: AtomicRunner | undefined;

/**
 * Run write queries as one transaction: every one is applied, or none is.
 *
 * In the app this is Drizzle's `batch`, which SQLocal runs as a single worker
 * message inside one SQLite transaction. No other query can land in the
 * middle, and a page that is closed or navigated away mid-way leaves either
 * the old state or the new one. Drizzle's own `db.transaction` is not used:
 * over SQLocal its BEGIN and COMMIT are separate messages, so queries from
 * other screens would join the open transaction.
 *
 * Build the queries without awaiting them; awaiting one would run it alone.
 */
export const runAtomic = async (queries: readonly AtomicQuery[]): Promise<void> => {
  if (queries.length === 0) return;
  if (_atomicForTests) return _atomicForTests(queries);
  await getDb().batch(queries as [AtomicQuery, ...AtomicQuery[]]);
};

export type Db = ReturnType<typeof getDb>;
