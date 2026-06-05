import { newId, todayIso } from "@fiscode/core";
import { eq } from "drizzle-orm";
import type { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import { getDb } from "../client.ts";
import { history } from "../schema/history.ts";

type AnyTable = SQLiteTableWithColumns<{
  name: string;
  schema: undefined;
  columns: Record<string, any>;
  dialect: "sqlite";
}>;

const nowIso = () => new Date().toISOString();

/**
 * Append a history row for a mutation. Called inside a transaction with the
 * write itself so history and state can never disagree.
 *
 * The `entity` arg is the table name string (e.g. "income"), not the Drizzle
 * table object — keeps the type surface small.
 */
export const writeHistory = async (
  entity: string,
  entityId: string,
  op: "insert" | "update" | "delete" | "revert",
  before: unknown,
  after: unknown,
): Promise<void> => {
  const db = getDb();
  await db.insert(history).values({
    id: newId(),
    entity,
    entityId,
    op,
    beforeJson: before === undefined ? null : JSON.stringify(before),
    afterJson: after === undefined ? null : JSON.stringify(after),
    at: nowIso(),
  });
};

/** Default timestamps for a freshly created row. */
export const newRowTimestamps = () => ({
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

export const touchTimestamps = () => ({ updatedAt: nowIso() });

export { newId, todayIso, eq };
export type { AnyTable };
