import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import {
  MAX_DOCUMENT_BYTES,
  VaultBusyError,
  VaultIntegrityError,
  VaultNameTakenError,
} from "@fiscode/core";
import { eq } from "drizzle-orm";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import { getDb } from "../client.ts";
import { document, history } from "../schema/index.ts";
import {
  __setVaultStoreForTests,
  memoryDir,
  oldBytesPath,
  sha256Hex,
  VAULT_LONG_LOCK,
  VAULT_LOCK,
  vaultStore,
  withVaultLock,
  type LockManagerLike,
  type VaultDirHandle,
  type VaultStore,
} from "../vault/index.ts";
import { __resetVaultMigrationStateForTests, setVaultMigrationState } from "../vault/state.ts";
import { documentLinkRepo, documentRepo, expenseRepo, folderRepo } from "./index.ts";
import {
  acknowledgeChanged,
  adoptMoved,
  applyRecordDates,
  importNewFiles,
  moveBack,
  readLastScanReport,
  scanReviewCount,
  scanVault,
  type ScanReport,
  type ScanResult,
} from "./vault-scan.ts";

// The reconcile scan (ADR 0001 § 6 table, § 11.4, § 11.9): outside changes to `documents/` are
// found by path and sha256 and reported. It records an outside edit and deletes crashed temp
// files on its own; everything else waits for the user.

let sqlite: Database.Database;
let root: VaultDirHandle;
let store: VaultStore;
beforeEach(() => {
  sqlite = setupTestDb();
  root = memoryDir();
  store = vaultStore(root);
  __setVaultStoreForTests(store, root);
});
afterEach(() => {
  __setVaultStoreForTests(undefined);
  __resetVaultMigrationStateForTests();
  teardownTestDb(sqlite);
});

const file = (name: string, text: string, type = "application/pdf") =>
  Object.assign(new Blob([text], { type }), { name });

const upload = async (name: string, text: string, folderId: string | null = null) =>
  documentRepo.upload(file(name, text), { folderId });

const rowOf = async (id: string) =>
  (await getDb().select().from(document).where(eq(document.id, id)))[0]!;

const done = (r: ScanResult): ScanReport => {
  if (r.status !== "done") throw new Error(`scan skipped: ${r.reason}`);
  return r;
};

/** Writes a file the way an outside program does: straight into the tree, no temp name. */
const outside = async (path: string, text: string) => {
  const parts = ["vault", ...path.split("/")];
  const name = parts.pop()!;
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(new Blob([text]));
  await w.close();
};

const expense = (date: string) =>
  expenseRepo.create({
    date,
    category: "equipment",
    description: "Demo monitor",
    amountCents: 129_99,
    clientId: null,
    reason: null,
    flagForSection179: false,
    startupExpense: false,
    placedInServiceDate: null,
    notes: null,
    deletedAt: null,
  } as never);

const expensesFolder = async () => {
  const defaults = await folderRepo.ensureYearDefaults(2026);
  return defaults.find((f) => f.defaultKey === "expenses")!;
};

describe("scanVault: the § 6 table", () => {
  it("counts a row whose path holds its sha as ok, and reports nothing else", async () => {
    await upload("Demo receipt.pdf", "one");
    const r = done(await scanVault());
    expect(r.ok).toBe(1);
    expect([r.moved, r.missing, r.changed, r.unknown, r.conflicts, r.redated]).toEqual([
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(scanReviewCount(r)).toBe(0);
  });

  it("reports a file moved outside the app, with the folder adopting would give it", async () => {
    const folder = await expensesFolder();
    const d = await upload("Demo receipt.pdf", "one");
    const moved = "documents/2026/Expenses/Renamed outside.pdf";
    await store.move(d.vaultPath!, moved, d.sha256);
    const r = done(await scanVault());
    expect(r.moved).toEqual([
      {
        documentId: d.id,
        name: "Demo receipt.pdf",
        path: d.vaultPath,
        foundAt: moved,
        sha256: d.sha256,
        adoptFolderId: folder.id,
      },
    ]);
    expect(r.unknown).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("reports a row whose file is nowhere as missing", async () => {
    const d = await upload("Demo receipt.pdf", "one");
    await store.remove(d.vaultPath!);
    const r = done(await scanVault());
    expect(r.missing).toEqual([{ documentId: d.id, name: "Demo receipt.pdf", path: d.vaultPath }]);
  });

  it("records an outside edit as a new version, keeping the old bytes in versions/", async () => {
    const d = await upload("Demo receipt.pdf", "one");
    await outside(d.vaultPath!, "edited outside");
    const newSha = await sha256Hex(new Blob(["edited outside"]));
    const r = done(await scanVault());
    expect(r.changed).toEqual([
      {
        documentId: d.id,
        name: "Demo receipt.pdf",
        path: d.vaultPath,
        fromSha256: d.sha256,
        toSha256: newSha,
        oldBytesKept: true,
      },
    ]);
    const row = await rowOf(d.id);
    expect(row.sha256).toBe(newSha);
    expect(row.sizeBytes).toBe("edited outside".length);
    expect(await store.holds(oldBytesPath("versions", d.sha256), d.sha256)).toBe(true);
    const h = await getDb().select().from(history).where(eq(history.entityId, d.id));
    expect(h.map((x) => x.op)).toEqual(["insert", "update"]);
    // The next scan finds nothing to do.
    const again = done(await scanVault());
    expect(again.changed).toEqual([]);
    expect(again.ok).toBe(1);
    // History can still go back to the bytes from before the edit.
    const versions = await documentRepo.versions(d.id);
    expect(versions.map((v) => v.available)).toEqual([true, true]);
  });

  it("lists an allow-listed file with no row as new in its folder; ignores other files and _fiscode/", async () => {
    const folder = await expensesFolder();
    await upload("Demo receipt.pdf", "one", folder.id);
    await outside("documents/2026/Expenses/Invoice.pdf", "new");
    await outside("documents/2026/Expenses/Notes.docx", "doc");
    await outside("documents/2026/Expenses/.DS_Store", "x");
    await outside("documents/Thumbs.db", "x");
    await outside("documents/Unfiled/Scan.png", "png");
    await outside("_fiscode/versions/ab/Stray.pdf", "x");
    const r = done(await scanVault());
    expect(r.unknown).toEqual([
      {
        path: "documents/2026/Expenses/Invoice.pdf",
        name: "Invoice.pdf",
        mime: "application/pdf",
        sizeBytes: 3,
        folderId: folder.id,
      },
      {
        path: "documents/Unfiled/Scan.png",
        name: "Scan.png",
        mime: "image/png",
        sizeBytes: 3,
        folderId: null,
      },
    ]);
  });

  it("puts a new file in a folder made outside the app under its nearest known folder", async () => {
    const folder = await expensesFolder();
    await outside("documents/2026/Expenses/Made outside/Invoice.pdf", "new");
    const r = done(await scanVault());
    expect(r.unknown.map((u) => [u.path, u.folderId])).toEqual([
      ["documents/2026/Expenses/Made outside/Invoice.pdf", folder.id],
    ]);
  });

  it("deletes leftover temp files of a crashed write, anywhere in the vault", async () => {
    const d = await upload("Demo receipt.pdf", "one");
    const dir = d.vaultPath!.slice(0, d.vaultPath!.lastIndexOf("/"));
    await outside(`${dir}/.half.pdf.fiscode-tmp`, "half");
    await outside("_fiscode/.plan-0.fiscode-tmp", "staged");
    const r = done(await scanVault());
    expect(r.tmpRemoved.sort()).toEqual(
      [`${dir}/.half.pdf.fiscode-tmp`, "_fiscode/.plan-0.fiscode-tmp"].sort(),
    );
    expect(r.unknown).toEqual([]);
    expect(r.ok).toBe(1);
    expect(done(await scanVault()).tmpRemoved).toEqual([]);
  });

  it("lists sync conflict copies as conflicts, never as new files", async () => {
    const folder = await expensesFolder();
    const d = await upload("Invoice.pdf", "one", folder.id);
    const dir = d.vaultPath!.slice(0, d.vaultPath!.lastIndexOf("/"));
    const stem = d.vaultPath!.slice(dir.length + 1, -".pdf".length);
    await outside(`${dir}/${stem} (conflicted copy 2026-11-23 101500).pdf`, "nc");
    await outside(`${dir}/${stem} (1).pdf`, "drive");
    // A lone "(1)" with no row-backed original beside it is an ordinary new file.
    await outside(`${dir}/Lone (1).pdf`, "lone");
    // Nor is a "(1)" beside an original that has no row: both are new files.
    await outside(`${dir}/Paper.pdf`, "paper");
    await outside(`${dir}/Paper (1).pdf`, "paper 1");
    const r = done(await scanVault());
    expect(r.conflicts).toEqual([
      {
        path: `${dir}/${stem} (1).pdf`,
        originalPath: d.vaultPath,
        documentId: d.id,
        kind: "drive",
      },
      {
        path: `${dir}/${stem} (conflicted copy 2026-11-23 101500).pdf`,
        originalPath: d.vaultPath,
        documentId: d.id,
        kind: "nextcloud",
      },
    ]);
    expect(r.unknown.map((u) => u.path)).toEqual([
      `${dir}/Lone (1).pdf`,
      `${dir}/Paper (1).pdf`,
      `${dir}/Paper.pdf`,
    ]);
  });

  it("reports a date prefix that no longer matches its one linked record", async () => {
    const d = await upload("Demo receipt.pdf", "one");
    const e = await expense("2026-03-16");
    await documentLinkRepo.link(d.id, "expense", e.id);
    const linked = await rowOf(d.id);
    expect(linked.vaultPath).toContain("/2026-03-16 Demo receipt.pdf");
    await expenseRepo.update(e.id, { date: "2026-04-02" } as never);
    const r = done(await scanVault());
    expect(r.redated).toEqual([
      {
        documentId: d.id,
        name: "Demo receipt.pdf",
        path: linked.vaultPath,
        fileDate: "2026-03-16",
        expectedDate: "2026-04-02",
      },
    ]);
    expect(r.ok).toBe(1);
  });
});

describe("scan actions (D6: ask, with adopt all)", () => {
  it("adopt takes the new folder and name into sqlite", async () => {
    const folder = await expensesFolder();
    const d = await upload("Demo receipt.pdf", "one");
    const foundAt = "documents/2026/Expenses/2026-01-05 Renamed outside.pdf";
    await store.move(d.vaultPath!, foundAt, d.sha256);
    const r = done(await scanVault());
    await adoptMoved(r.moved);
    const row = await rowOf(d.id);
    expect(row.folderId).toBe(folder.id);
    expect(row.name).toBe("Renamed outside.pdf");
    expect(await store.holds(row.vaultPath!, d.sha256)).toBe(true);
    expect(done(await scanVault()).ok).toBe(1);
    // Adopting is an edit the user made: History has it.
    const h = await getDb().select().from(history).where(eq(history.entityId, d.id));
    expect(h.at(-1)!.op).toBe("update");
  });

  it("adopt all takes every moved file in one go", async () => {
    const a = await upload("A.pdf", "aaa");
    const b = await upload("B.pdf", "bbb");
    await store.move(a.vaultPath!, "documents/Unfiled/Sub/A2.pdf", a.sha256);
    await store.move(b.vaultPath!, "documents/Unfiled/B2.pdf", b.sha256);
    const r = done(await scanVault());
    expect(r.moved).toHaveLength(2);
    await adoptMoved(r.moved);
    const after = done(await scanVault());
    expect(after.ok).toBe(2);
    expect(after.moved).toEqual([]);
    expect((await rowOf(b.id)).name).toBe("B2.pdf");
  });

  it("move back puts the file at the row's path and leaves the row alone", async () => {
    const d = await upload("Demo receipt.pdf", "one");
    await store.move(d.vaultPath!, "documents/Unfiled/Elsewhere.pdf", d.sha256);
    const r = done(await scanVault());
    await moveBack(r.moved);
    expect(await store.holds(d.vaultPath!, d.sha256)).toBe(true);
    expect(await store.read("documents/Unfiled/Elsewhere.pdf")).toBeUndefined();
    expect(await rowOf(d.id)).toEqual(d);
  });

  it("an action on a report gone stale refuses and changes nothing", async () => {
    const d = await upload("Demo receipt.pdf", "one");
    await store.move(d.vaultPath!, "documents/Unfiled/Elsewhere.pdf", d.sha256);
    const r = done(await scanVault());
    await store.remove("documents/Unfiled/Elsewhere.pdf");
    await expect(adoptMoved(r.moved)).rejects.toBeInstanceOf(VaultIntegrityError);
    expect(await rowOf(d.id)).toEqual(d);
  });

  it("import makes a document of a new file in place, without a second copy", async () => {
    const folder = await expensesFolder();
    await outside("documents/2026/Expenses/Invoice.pdf", "new");
    const r = done(await scanVault());
    const [created] = await importNewFiles(r.unknown);
    expect(created!.folderId).toBe(folder.id);
    expect(created!.name).toBe("Invoice.pdf");
    expect(await store.holds(created!.vaultPath!, created!.sha256)).toBe(true);
    const after = done(await scanVault());
    expect(after.unknown).toEqual([]);
    expect(after.ok).toBe(1);
    expect(await store.list("documents/2026/Expenses")).toHaveLength(1);
  });

  it("apply record dates renames the file to its linked record's date", async () => {
    const d = await upload("Demo receipt.pdf", "one");
    const e = await expense("2026-03-16");
    await documentLinkRepo.link(d.id, "expense", e.id);
    await expenseRepo.update(e.id, { date: "2026-04-02" } as never);
    const r = done(await scanVault());
    await applyRecordDates(r.redated);
    const row = await rowOf(d.id);
    expect(row.vaultPath).toContain("/2026-04-02 Demo receipt.pdf");
    expect(await store.holds(row.vaultPath!, d.sha256)).toBe(true);
    expect(done(await scanVault()).redated).toEqual([]);
  });

  it("keeps the last report, and an action drops the items it handled", async () => {
    const a = await upload("A.pdf", "aaa");
    await store.move(a.vaultPath!, "documents/Unfiled/A2.pdf", a.sha256);
    await outside("documents/Unfiled/New.pdf", "new");
    const r = done(await scanVault());
    expect(scanReviewCount(r)).toBe(2);
    expect(await readLastScanReport()).toEqual(r);
    await adoptMoved(r.moved);
    const last = (await readLastScanReport())!;
    expect(last.moved).toEqual([]);
    expect(last.unknown).toHaveLength(1);
    expect(scanReviewCount(last)).toBe(1);
  });
});

describe("review r1", () => {
  it("import drops a date prefix from the name, so it isn't prefixed twice", async () => {
    await outside("documents/Unfiled/2024-01-01 Old scan.pdf", "old");
    const r = done(await scanVault());
    const [created] = await importNewFiles(r.unknown);
    expect(created!.name).toBe("Old scan.pdf");
    expect(created!.vaultPath).not.toContain("2024-01-01 2024-01-01");
  });

  it("import uses the folder the report showed while it is still live", async () => {
    const folder = await expensesFolder();
    await outside("documents/Unfiled/Invoice.pdf", "new");
    const r = done(await scanVault());
    const [created] = await importNewFiles([{ ...r.unknown[0]!, folderId: folder.id }]);
    expect(created!.folderId).toBe(folder.id);
  });

  it("move back refuses when something else is at the row's path now", async () => {
    const d = await upload("Demo receipt.pdf", "one");
    await store.move(d.vaultPath!, "documents/Unfiled/Elsewhere.pdf", d.sha256);
    const r = done(await scanVault());
    await outside(d.vaultPath!, "someone else's file");
    await expect(moveBack(r.moved)).rejects.toBeInstanceOf(VaultNameTakenError);
    expect(await store.read("documents/Unfiled/Elsewhere.pdf")).toBeDefined();
  });

  it("reports progress, and a cancel records nothing", async () => {
    const d = await upload("Demo receipt.pdf", "one");
    await outside(d.vaultPath!, "edited outside");
    const seen: number[] = [];
    const ac = new AbortController();
    await expect(
      scanVault({
        signal: ac.signal,
        onProgress: (p) => {
          seen.push(p.done);
          ac.abort();
        },
      }),
    ).rejects.toThrow();
    expect(seen).toEqual([1]);
    expect((await rowOf(d.id)).sha256).toBe(d.sha256);
    const totals: number[] = [];
    await scanVault({ onProgress: (p) => totals.push(p.total) });
    expect(totals.at(-1)).toBe(2);
  });

  it("a folder rename holds the long-op lock, so a focus scan skips it", async () => {
    const seen: string[] = [];
    const locks: LockManagerLike = {
      request: (name, _o, cb) => {
        seen.push(name);
        return cb({});
      },
    };
    // The real lock manager isn't in node; check the option changeTree passes instead.
    const f = await folderRepo.create({ name: "Walk", parentId: null });
    await withVaultLock(async () => {}, { locks, long: true });
    expect(seen).toEqual([VAULT_LOCK, VAULT_LONG_LOCK]);
    const g = globalThis as { navigator?: { locks?: LockManagerLike } };
    const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
    try {
      seen.length = 0;
      await folderRepo.rename(f.id, "Walk 2");
      expect(seen).toContain(VAULT_LONG_LOCK);
    } finally {
      if (had) Object.defineProperty(globalThis, "navigator", had);
      else delete g.navigator;
    }
  });
});

describe("scanVault: more than one tab (§ 11.9)", () => {
  /** One exclusive lock per name, as navigator.locks gives across tabs. */
  const fakeLocks = (): LockManagerLike => {
    const held = new Map<string, Promise<unknown>>();
    return {
      async request(name, options, callback) {
        while (held.has(name)) {
          if (options.ifAvailable) return callback(null);
          await held.get(name);
        }
        const p = callback({ name });
        held.set(
          name,
          p.catch(() => {}),
        );
        try {
          return await p;
        } finally {
          held.delete(name);
        }
      },
    };
  };

  const holdLock = (locks: LockManagerLike, long: boolean) => {
    let release!: () => void;
    const held = withVaultLock(() => new Promise<void>((r) => (release = r)), {
      locks,
      long,
    });
    return { release: () => release(), held };
  };

  it("the Check folder button throws VaultBusyError while another tab holds the vault", async () => {
    const locks = fakeLocks();
    const other = holdLock(locks, false);
    await expect(scanVault({ trigger: "check", locks })).rejects.toBeInstanceOf(VaultBusyError);
    other.release();
    await other.held;
  });

  it("a focus scan is skipped, not queued, while a long op runs", async () => {
    const locks = fakeLocks();
    const other = holdLock(locks, true);
    expect(await scanVault({ trigger: "focus", locks })).toEqual({
      status: "skipped",
      reason: "busy",
    });
    other.release();
    await other.held;
  });

  it("a boot scan waits for a short change in another tab", async () => {
    const locks = fakeLocks();
    const other = holdLock(locks, false);
    const scan = scanVault({ trigger: "boot", locks });
    other.release();
    await other.held;
    expect((await scan).status).toBe("done");
  });

  it("a focus scan takes the lock with ifAvailable: skipped, never queued, while any tab holds it", async () => {
    const locks = fakeLocks();
    const other = holdLock(locks, false);
    expect(await scanVault({ trigger: "focus", locks })).toEqual({
      status: "skipped",
      reason: "busy",
    });
    other.release();
    await other.held;
    expect((await scanVault({ trigger: "focus", locks })).status).toBe("done");
  });

  it("names the long-op lock apart from the vault lock", () => {
    expect(VAULT_LONG_LOCK).not.toBe(VAULT_LOCK);
  });

  it("is skipped while the migration hasn't finished", async () => {
    setVaultMigrationState({ phase: "migrating", done: 0, total: 3 });
    expect(await scanVault()).toEqual({
      status: "skipped",
      reason: "migrating",
    });
  });
});

describe("store.list for the scan", () => {
  it("shows temp files only when asked", async () => {
    await outside("documents/.x.pdf.fiscode-tmp", "half");
    expect(await store.list("documents")).toEqual([]);
    expect(await store.list("documents", { withTmp: true })).toEqual([
      { name: ".x.pdf.fiscode-tmp", kind: "file" },
    ]);
  });
});

describe("review r1 (d-data ruling)", () => {
  const siblings = async () => {
    const folder = await expensesFolder();
    const d = await upload("X.pdf", "old bytes", folder.id);
    const dir = d.vaultPath!.slice(0, d.vaultPath!.lastIndexOf("/"));
    const stem = d.vaultPath!.slice(dir.length + 1, -".pdf".length);
    return { d, dir, stem };
  };

  it("B1 Nextcloud: a conflict copy holding the row's sha is a conflict, the live file an outside edit", async () => {
    const { d, dir, stem } = await siblings();
    const copy = `${dir}/${stem} (conflicted copy 2026-11-23 101500).pdf`;
    await outside(copy, "old bytes");
    await outside(d.vaultPath!, "new bytes");
    const r = done(await scanVault());
    expect(r.moved).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.changed.map((c) => [c.documentId, c.path, c.oldBytesKept])).toEqual([
      [d.id, d.vaultPath, true],
    ]);
    expect(r.conflicts).toEqual([
      { path: copy, originalPath: d.vaultPath, documentId: d.id, kind: "nextcloud" },
    ]);
    expect((await documentRepo.versions(d.id)).length).toBe(2);
  });

  it("B1 Drive: a ' (1)' copy holding the row's sha is a conflict, the live file an outside edit", async () => {
    const { d, dir, stem } = await siblings();
    const copy = `${dir}/${stem} (1).pdf`;
    await outside(copy, "old bytes");
    await outside(d.vaultPath!, "new bytes");
    const r = done(await scanVault());
    expect(r.moved).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.changed.map((c) => c.documentId)).toEqual([d.id]);
    expect(r.conflicts).toEqual([
      { path: copy, originalPath: d.vaultPath, documentId: d.id, kind: "drive" },
    ]);
  });

  it("B1: a conflict copy is never a move target, even when the row's own file is gone", async () => {
    const { d, dir, stem } = await siblings();
    await outside(`${dir}/${stem} (conflicted copy 2026-11-23 101500).pdf`, "old bytes");
    await store.remove(d.vaultPath!);
    const r = done(await scanVault());
    expect(r.moved).toEqual([]);
    expect(r.missing.map((m) => m.documentId)).toEqual([d.id]);
    expect(r.conflicts.map((c) => c.kind)).toEqual(["nextcloud"]);
  });

  it("N1: the same sha at two paths is ambiguous, not a move, and neither is offered as new", async () => {
    const d = await upload("Twice.pdf", "twice");
    await store.remove(d.vaultPath!);
    await outside("documents/Copy one.pdf", "twice");
    await outside("documents/Copy two.pdf", "twice");
    const r = done(await scanVault());
    expect(r.moved).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.ambiguous).toEqual([
      {
        documentId: d.id,
        name: "Twice.pdf",
        path: d.vaultPath,
        sha256: d.sha256,
        foundAt: ["documents/Copy one.pdf", "documents/Copy two.pdf"],
      },
    ]);
    expect(scanReviewCount(r)).toBe(1);
  });

  it("N3: an outside edit over the size cap is reported, not ingested", async () => {
    const d = await upload("Big.pdf", "small");
    await outside(d.vaultPath!, "x".repeat(MAX_DOCUMENT_BYTES + 1));
    const r = done(await scanVault());
    expect(r.changed).toEqual([]);
    expect(r.tooLarge).toEqual([
      { documentId: d.id, name: "Big.pdf", path: d.vaultPath, sizeBytes: MAX_DOCUMENT_BYTES + 1 },
    ]);
    expect(r.unknown).toEqual([]);
    expect((await rowOf(d.id)).sha256).toBe(d.sha256);
  });

  describe("S1: focus hashes only what changed size or mtime", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-23T10:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    it("focus trusts an unchanged size and mtime; Check now hashes every byte", async () => {
      const d = await upload("Same size.pdf", "aaaa");
      expect(done(await scanVault({ trigger: "focus" })).ok).toBe(1);
      // Same size, same mtime (the clock is frozen): only a full hash can see this edit.
      await outside(d.vaultPath!, "bbbb");
      const focus = done(await scanVault({ trigger: "focus" }));
      expect(focus.changed).toEqual([]);
      expect(focus.ok).toBe(1);
      const check = done(await scanVault({ trigger: "check" }));
      expect(check.changed.map((c) => c.documentId)).toEqual([d.id]);
    });

    it("focus hashes a file whose mtime changed", async () => {
      const d = await upload("Moved on.pdf", "aaaa");
      done(await scanVault({ trigger: "focus" }));
      vi.setSystemTime(new Date("2026-11-23T10:05:00Z"));
      await outside(d.vaultPath!, "bbbb");
      const focus = done(await scanVault({ trigger: "focus" }));
      expect(focus.changed.map((c) => c.documentId)).toEqual([d.id]);
    });

    it("keeps the cache in OPFS beside the journal, outside the vault", async () => {
      await upload("Cached.pdf", "aaaa");
      done(await scanVault({ trigger: "focus" }));
      const f = await (await root.getFileHandle("vault-scan-cache.json")).getFile();
      expect(Object.keys(JSON.parse(await f.text()) as object)).toHaveLength(1);
      expect((await store.list("")).map((e) => e.name)).not.toContain("vault-scan-cache.json");
    });
  });
});

describe("review r2 (d-data ruling): S2 swaps are moves, never edits", () => {
  const noEditsRecorded = async (ids: string[], shas: string[]) => {
    for (const [i, id] of ids.entries()) expect((await rowOf(id)).sha256).toBe(shas[i]);
  };

  it("a 2-way swap of names is two moves, offered for adopt all, and nothing is relinked", async () => {
    const a = await upload("A.pdf", "aaa");
    const b = await upload("B.pdf", "bbb");
    await outside(a.vaultPath!, "bbb");
    await outside(b.vaultPath!, "aaa");
    const r = done(await scanVault());
    expect(r.changed).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.moved.map((m) => [m.documentId, m.foundAt, m.swapped]).sort()).toEqual(
      [
        [a.id, b.vaultPath, true],
        [b.id, a.vaultPath, true],
      ].sort(),
    );
    expect(scanReviewCount(r)).toBe(2);
    await noEditsRecorded([a.id, b.id], [a.sha256, b.sha256]);
    // Adopt all: each document takes the name of the place its bytes are now.
    await adoptMoved(r.moved);
    expect((await rowOf(a.id)).name).toBe("B.pdf");
    expect((await rowOf(b.id)).name).toBe("A.pdf");
    const after = done(await scanVault());
    expect(after.ok).toBe(2);
    expect(scanReviewCount(after)).toBe(0);
  });

  it("a 3-way rotation is three moves", async () => {
    const a = await upload("A.pdf", "aaa");
    const b = await upload("B.pdf", "bbb");
    const c = await upload("C.pdf", "ccc");
    await outside(a.vaultPath!, "ccc");
    await outside(b.vaultPath!, "aaa");
    await outside(c.vaultPath!, "bbb");
    const r = done(await scanVault());
    expect(r.changed).toEqual([]);
    expect(r.moved.map((m) => [m.documentId, m.foundAt]).sort()).toEqual(
      [
        [a.id, b.vaultPath],
        [b.id, c.vaultPath],
        [c.id, a.vaultPath],
      ].sort(),
    );
    expect(scanReviewCount(r)).toBe(3);
    await noEditsRecorded([a.id, b.id, c.id], [a.sha256, b.sha256, c.sha256]);
    await adoptMoved(r.moved);
    expect(done(await scanVault()).ok).toBe(3);
  });

  it("a swap plus a real edit: the pair is moved, the edit recorded, and all three counted", async () => {
    const a = await upload("A.pdf", "aaa");
    const b = await upload("B.pdf", "bbb");
    const c = await upload("C.pdf", "ccc");
    await outside(a.vaultPath!, "bbb");
    await outside(b.vaultPath!, "aaa");
    await outside(c.vaultPath!, "ccc edited");
    const r = done(await scanVault());
    expect(r.moved.map((m) => m.documentId).sort()).toEqual([a.id, b.id].sort());
    expect(r.changed.map((x) => x.documentId)).toEqual([c.id]);
    expect(scanReviewCount(r)).toBe(3);
    await noEditsRecorded([a.id, b.id], [a.sha256, b.sha256]);
    // Dismissing the edit clears it from the badge; it stays recorded.
    await acknowledgeChanged(r.changed);
    const last = (await readLastScanReport())!;
    expect(last.changed).toEqual([]);
    expect(scanReviewCount(last)).toBe(2);
    expect((await rowOf(c.id)).sha256).toBe(await sha256Hex(new Blob(["ccc edited"])));
  });

  it("a swap then an edit of one swapped file: one move, one missing, the edited file new", async () => {
    const a = await upload("A.pdf", "aaa");
    const b = await upload("B.pdf", "bbb");
    await outside(a.vaultPath!, "bbb");
    await outside(b.vaultPath!, "aaa edited");
    const r = done(await scanVault());
    expect(r.changed).toEqual([]);
    expect(r.moved.map((m) => [m.documentId, m.foundAt])).toEqual([[b.id, a.vaultPath]]);
    expect(r.missing.map((m) => m.documentId)).toEqual([a.id]);
    expect(r.unknown.map((u) => u.path)).toEqual([b.vaultPath]);
    await noEditsRecorded([a.id, b.id], [a.sha256, b.sha256]);
  });

  it("move back refuses a swap while the other file is at the row's path", async () => {
    const a = await upload("A.pdf", "aaa");
    const b = await upload("B.pdf", "bbb");
    await outside(a.vaultPath!, "bbb");
    await outside(b.vaultPath!, "aaa");
    const r = done(await scanVault());
    await expect(moveBack(r.moved.slice(0, 1))).rejects.toBeInstanceOf(VaultNameTakenError);
  });
});
