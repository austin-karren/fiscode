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
  _db = undefined;
  _sqlocal = undefined;
};

export type Db = ReturnType<typeof getDb>;
