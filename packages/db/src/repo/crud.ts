import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../client.ts";
import { newId, newRowTimestamps, touchTimestamps, writeHistory } from "./base.ts";

type AnyRow = Record<string, unknown> & { id: string; deletedAt?: string | null };

/**
 * Returns a small CRUD repo for any table whose row has `id`, `deletedAt`,
 * `createdAt`, and `updatedAt`. Writes append history rows.
 */
export const makeCrudRepo = <TInsert extends Record<string, unknown>, TRow extends AnyRow>(
  table: any,
  entityName: string,
  options: { orderBy?: string } = {},
) => {
  const orderBy = options.orderBy ?? "createdAt";
  return {
    async list(): Promise<TRow[]> {
      const db = getDb();
      return (await db
        .select()
        .from(table)
        .where(isNull(table.deletedAt))
        .orderBy(asc(table[orderBy]))) as TRow[];
    },
    async listIncludingDeleted(): Promise<TRow[]> {
      const db = getDb();
      return (await db.select().from(table).orderBy(asc(table[orderBy]))) as TRow[];
    },
    async get(id: string): Promise<TRow | undefined> {
      const db = getDb();
      const rows = (await db
        .select()
        .from(table)
        .where(and(eq(table.id, id), isNull(table.deletedAt)))
        .limit(1)) as TRow[];
      return rows[0];
    },
    async create(input: Omit<TInsert, "id" | "createdAt" | "updatedAt">): Promise<TRow> {
      const db = getDb();
      const id = newId();
      const row = { id, ...input, ...newRowTimestamps() } as unknown as TInsert;
      await db.insert(table).values(row);
      const after = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as TRow[];
      await writeHistory(entityName, id, "insert", undefined, after[0]);
      return after[0]!;
    },
    async update(
      id: string,
      patch: Partial<Omit<TInsert, "id" | "createdAt">>,
    ): Promise<TRow | undefined> {
      const db = getDb();
      const before = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as TRow[];
      if (before.length === 0) return undefined;
      await db
        .update(table)
        .set({ ...patch, ...touchTimestamps() })
        .where(eq(table.id, id));
      const after = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as TRow[];
      await writeHistory(entityName, id, "update", before[0], after[0]);
      return after[0]!;
    },
    async softDelete(id: string): Promise<boolean> {
      const db = getDb();
      const before = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as TRow[];
      if (before.length === 0) return false;
      const deletedAt = new Date().toISOString();
      await db
        .update(table)
        .set({ deletedAt, ...touchTimestamps() } as any)
        .where(eq(table.id, id));
      const after = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as TRow[];
      await writeHistory(entityName, id, "delete", before[0], after[0]);
      return true;
    },
    async revertTo(id: string, snapshot: TRow): Promise<TRow | undefined> {
      const db = getDb();
      const before = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as TRow[];
      // Restore wholesale; treat snapshot as authoritative.
      const restored = { ...snapshot, updatedAt: new Date().toISOString() };
      if (before.length === 0) {
        await db.insert(table).values(restored as any);
      } else {
        await db
          .update(table)
          .set(restored as any)
          .where(eq(table.id, id));
      }
      const after = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as TRow[];
      await writeHistory(entityName, id, "revert", before[0], after[0]);
      return after[0];
    },
  };
};
