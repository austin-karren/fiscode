import { VaultIntegrityError, VaultNameTakenError } from "@fiscode/core";
import { describe, expect, it } from "vitest";
import { memoryDir } from "./dir.ts";
import {
  applyOp,
  readJournal,
  vaultJournal,
  writeJournal,
  type Plan,
  type PlanLedger,
} from "./journal.ts";
import { oldBytesPath, sha256Hex, vaultStore } from "./store.ts";

const bytes = (s: string) => new Blob([s]);

/** A fake vault_applied table. */
const fakeLedger = () => {
  const applied = new Set<string>();
  const ledger: PlanLedger & { applied: Set<string> } = {
    applied,
    isApplied: async (id) => applied.has(id),
    forget: async (id) => void applied.delete(id),
  };
  return ledger;
};

/**
 * A soft delete of one file plus a move of another: copy live → trash (copy rule), remove live,
 * move b → c. Covers all three op kinds.
 */
const setup = async () => {
  const root = memoryDir();
  const store = vaultStore(root);
  const ledger = fakeLedger();
  const a = await sha256Hex(bytes("a"));
  const b = await sha256Hex(bytes("b"));
  await store.write("documents/a.pdf", bytes("a"));
  await store.write("documents/b.pdf", bytes("b"));
  const plan: Plan = {
    planId: "p1",
    ops: [
      { op: "copy", from: "documents/a.pdf", to: oldBytesPath("trash", a), sha256: a },
      { op: "remove", from: "documents/a.pdf", sha256: a },
      { op: "move", from: "documents/b.pdf", to: "documents/x/c.pdf", sha256: b },
    ],
  };
  const before = async () =>
    (await store.holds("documents/a.pdf", a)) &&
    (await store.holds("documents/b.pdf", b)) &&
    !(await store.read("documents/x/c.pdf"));
  // A rollback leaves the trash copy: old bytes are never removed (ADR § 2).
  const after = async () =>
    !(await store.read("documents/a.pdf")) &&
    !(await store.read("documents/b.pdf")) &&
    (await store.holds("documents/x/c.pdf", b)) &&
    (await store.holds(oldBytesPath("trash", a), a));
  return { root, store, ledger, plan, before, after, journal: vaultJournal(root, store, ledger) };
};

describe("vaultJournal.run", () => {
  it("does the ops, commits, then clears the journal and the ledger row", async () => {
    const s = await setup();
    await s.journal.run(s.plan, async () => void s.ledger.applied.add("p1"));
    expect(await s.after()).toBe(true);
    expect(await readJournal(s.root)).toBeUndefined();
    expect(s.ledger.applied.size).toBe(0);
  });

  it("rolls the files back when the commit fails", async () => {
    const s = await setup();
    await expect(
      s.journal.run(s.plan, async () => {
        throw new Error("sqlite said no");
      }),
    ).rejects.toThrow("sqlite said no");
    expect(await s.before()).toBe(true);
    expect(await readJournal(s.root)).toBeUndefined();
  });

  it("keeps the files when the commit landed but its reply was lost", async () => {
    const s = await setup();
    await s.journal.run(s.plan, async () => {
      s.ledger.applied.add("p1");
      throw new Error("lost reply");
    });
    expect(await s.after()).toBe(true);
  });
});

describe("vaultJournal.recover: a crash after each step", () => {
  it("finds nothing to do without a journal", async () => {
    const s = await setup();
    expect(await s.journal.recover()).toBe("none");
  });

  for (const done of [0, 1, 2, 3]) {
    it(`rolls back after ${done} of 3 ops when the rows never committed`, async () => {
      const s = await setup();
      await writeJournal(s.root, s.plan);
      for (const op of s.plan.ops.slice(0, done)) await applyOp(s.store, op);
      expect(await s.journal.recover()).toBe("rolled-back");
      expect(await s.before()).toBe(true);
      expect(await readJournal(s.root)).toBeUndefined();
    });

    it(`rolls forward after ${done} of 3 ops when the rows committed`, async () => {
      const s = await setup();
      await writeJournal(s.root, s.plan);
      for (const op of s.plan.ops.slice(0, done)) await applyOp(s.store, op);
      s.ledger.applied.add("p1");
      expect(await s.journal.recover()).toBe("rolled-forward");
      expect(await s.after()).toBe(true);
      expect(s.ledger.applied.size).toBe(0);
    });
  }

  it("rolls back a replace by putting the old bytes back from versions", async () => {
    const s = await setup();
    const a = await sha256Hex(bytes("a"));
    const n = await sha256Hex(bytes("new"));
    await s.store.write("tmp-upload", bytes("new"));
    const plan: Plan = {
      planId: "p2",
      ops: [
        { op: "copy", from: "documents/a.pdf", to: oldBytesPath("versions", a), sha256: a },
        { op: "copy", from: "tmp-upload", to: "documents/a.pdf", sha256: n, replaces: a },
      ],
    };
    await writeJournal(s.root, plan);
    for (const op of plan.ops) await applyOp(s.store, op);
    expect(await s.journal.recover()).toBe("rolled-back");
    expect(await s.store.holds("documents/a.pdf", a)).toBe(true);
  });

  it("a new run recovers the plan a crash left first", async () => {
    const s = await setup();
    await writeJournal(s.root, s.plan);
    await applyOp(s.store, s.plan.ops[0]!);
    await s.journal.run({ planId: "p3", ops: [] }, async () => {});
    expect(await s.before()).toBe(true);
  });

  it("never removes old bytes a rolled-back plan found already kept", async () => {
    const s = await setup();
    const a = await sha256Hex(bytes("a"));
    await s.store.write(oldBytesPath("trash", a), bytes("a")); // another document's soft delete
    await writeJournal(s.root, s.plan);
    await applyOp(s.store, s.plan.ops[0]!);
    expect(await s.journal.recover()).toBe("rolled-back");
    expect(await s.store.holds(oldBytesPath("trash", a), a)).toBe(true);
  });

  it("refuses a plan whose move lands on a taken path, before touching anything", async () => {
    const s = await setup();
    await s.store.write("documents/x/c.pdf", bytes("someone else"));
    await expect(s.journal.run(s.plan, async () => {})).rejects.toBeInstanceOf(VaultNameTakenError);
    expect(await readJournal(s.root)).toBeUndefined();
    expect(await s.store.holds("documents/a.pdf", await sha256Hex(bytes("a")))).toBe(true);
  });

  it("won't restore old bytes that don't match their sha", async () => {
    const s = await setup();
    const a = await sha256Hex(bytes("a"));
    await writeJournal(s.root, s.plan);
    for (const op of s.plan.ops.slice(0, 2)) await applyOp(s.store, op);
    await s.store.write(oldBytesPath("trash", a), bytes("damaged"));
    await expect(s.journal.recover()).rejects.toBeInstanceOf(VaultIntegrityError);
    expect(await readJournal(s.root)).toBeDefined(); // kept for the next try
  });

  it("reports the real error when the rollback fails too", async () => {
    const s = await setup();
    const a = await sha256Hex(bytes("a"));
    const err = s.journal.run(s.plan, async () => {
      await s.store.write(oldBytesPath("trash", a), bytes("damaged"));
      throw new Error("sqlite said no");
    });
    await expect(err).rejects.toThrow('Rolling back after "Error: sqlite said no" failed');
  });

  it("refuses a plan that removes a file before keeping its bytes", async () => {
    const s = await setup();
    const plan: Plan = { planId: "p4", ops: s.plan.ops.slice(1) }; // no copy to trash first
    await expect(s.journal.run(plan, async () => {})).rejects.toThrow("before keeping its bytes");
    expect(await s.before()).toBe(true);
    expect(await readJournal(s.root)).toBeUndefined();
  });

  it("refuses a replace that doesn't keep the bytes it overwrites", async () => {
    const s = await setup();
    const a = await sha256Hex(bytes("a"));
    const n = await sha256Hex(bytes("new"));
    await s.store.write("tmp-upload", bytes("new"));
    const plan: Plan = {
      planId: "p5",
      ops: [{ op: "copy", from: "tmp-upload", to: "documents/a.pdf", sha256: n, replaces: a }],
    };
    await expect(s.journal.run(plan, async () => {})).rejects.toThrow("before keeping its bytes");
    expect(await s.store.holds("documents/a.pdf", a)).toBe(true);
    expect(await readJournal(s.root)).toBeUndefined();
  });
});
