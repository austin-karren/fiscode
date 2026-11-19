import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetDbForTests, __setDbForTests, runAtomic, type AtomicQuery } from "./client.ts";

// The repo tests run on better-sqlite3 with their own BEGIN/COMMIT runner, so
// they never reach the line the app runs. These tests do: no runner is set,
// and the database is a stub that records what it is asked.

/** A query that fails the test if anything runs it on its own. */
const query = (name: string) => {
  const then = vi.fn(() => {
    throw new Error(`${name} was awaited outside the batch`);
  });
  // A drizzle query is a thenable, and awaiting one runs it. The stub has to be one too.
  // oxlint-disable-next-line unicorn/no-thenable
  return { name, then } as unknown as AtomicQuery & { then: typeof then };
};

afterEach(() => {
  __resetDbForTests();
});

describe("runAtomic, the app path", () => {
  it("hands every query to one batch call and runs none of them alone", async () => {
    const batch = vi.fn(async () => []);
    __setDbForTests({ batch } as never);
    const queries = [query("snapshot"), query("delete"), query("insert")];

    await runAtomic(queries);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(queries);
    for (const q of queries) expect(q.then).not.toHaveBeenCalled();
  });

  it("passes a failed batch on to the caller", async () => {
    const batch = vi.fn(async () => {
      throw new Error("UNIQUE constraint failed");
    });
    __setDbForTests({ batch } as never);

    await expect(runAtomic([query("insert")])).rejects.toThrow("UNIQUE constraint failed");
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an empty list, which a batch would reject", async () => {
    const batch = vi.fn(async () => []);
    __setDbForTests({ batch } as never);

    await runAtomic([]);

    expect(batch).not.toHaveBeenCalled();
  });
});
