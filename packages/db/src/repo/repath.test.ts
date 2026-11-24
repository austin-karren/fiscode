import { todayIso } from "@fiscode/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { setupTestDb, teardownTestDb } from "../test/setup-db.ts";
import {
  __resetVaultMigrationStateForTests,
  __setVaultStoreForTests,
  memoryDir,
  readJournal,
  vaultStore,
  type VaultDirHandle,
  type VaultStore,
} from "../vault/index.ts";
import {
  buildBundle,
  documentRepo,
  repathDocuments,
  REPATH_DONE_KEY,
  type TreeProgress,
} from "./index.ts";
import { importBundle } from "./import.ts";

// The one-time re-path job: files named "<date> <date> ..." by the old rule lose the second date.

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

const file = (name: string, text: string) =>
  Object.assign(new Blob([text], { type: "application/pdf" }), { name });
// The local day, as the D2 added-date prefix uses.
const today = () => todayIso();

const tree = async (dir = ""): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await store.list(dir)) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.kind === "directory") out.push(...(await tree(path)));
    else if (path !== "fiscode.json") out.push(path);
  }
  return out.sort();
};

/** Put a document where the old rule put it: "<added> <title's date> ...". */
const oldPlace = async (id: string) => {
  const d = (await documentRepo.get(id))!;
  const old = d.vaultPath!.replace("documents/Unfiled/", `documents/Unfiled/${today()} `);
  await store.write(old, (await store.read(d.vaultPath!))!);
  await store.remove(d.vaultPath!);
  sqlite.prepare("UPDATE document SET vault_path = ? WHERE id = ?").run(old, id);
  return old;
};

const doneFlag = () =>
  (
    sqlite.prepare("SELECT value FROM meta WHERE key = ?").get(REPATH_DONE_KEY) as
      | { value: string }
      | undefined
  )?.value;

const setUp = async () => {
  const a = await documentRepo.upload(file("2026-08-12 Demo bill.pdf", "a"));
  const b = await documentRepo.upload(file("2026-09-01 Demo lease.pdf", "b"));
  const c = await documentRepo.upload(file("Demo receipt.pdf", "c"));
  await oldPlace(a.id);
  await oldPlace(b.id);
  return { a, b, c };
};

describe("repathDocuments", () => {
  it("moves each double-dated file once, reports progress, and marks itself done", async () => {
    const { a, b, c } = await setUp();
    const seen: TreeProgress[] = [];
    const moved = await repathDocuments({ onProgress: (p) => seen.push(p) });
    expect(moved).toBe(2);
    expect(await tree()).toEqual(
      [
        "documents/Unfiled/2026-08-12 Demo bill.pdf",
        "documents/Unfiled/2026-09-01 Demo lease.pdf",
        c.vaultPath!,
      ].sort(),
    );
    expect((await documentRepo.get(a.id))!.vaultPath).toBe(
      "documents/Unfiled/2026-08-12 Demo bill.pdf",
    );
    expect((await documentRepo.get(b.id))!.sha256).toBe(b.sha256);
    expect(seen.at(0)).toEqual({ phase: "repathing", done: 0, total: 3 });
    expect(seen.at(-1)).toEqual({ phase: "done", done: 3, total: 3 });
    expect(doneFlag()).toBe("done");
  });

  it("is idempotent: a second run moves nothing", async () => {
    await setUp();
    await repathDocuments();
    const after = await tree();
    expect(await repathDocuments()).toBe(0);
    expect(await tree()).toEqual(after);
  });

  it("a crash midway: what moved stays moved, and the next run finishes the rest", async () => {
    const { a, b } = await setUp();
    // The second document's commit fails, as a crash before its commit would.
    sqlite.exec(`CREATE TRIGGER no_repath BEFORE UPDATE OF vault_path ON document
      WHEN NEW.id = '${b.id}' BEGIN SELECT RAISE(ABORT, 'crash'); END`);
    await expect(repathDocuments()).rejects.toThrow(/crash/);
    expect(doneFlag()).toBeUndefined();
    expect(await readJournal(root)).toBeUndefined();
    expect((await documentRepo.get(a.id))!.vaultPath).toBe(
      "documents/Unfiled/2026-08-12 Demo bill.pdf",
    );
    // b's file and row are still where they were: no orphan, no duplicate.
    const bRow = (await documentRepo.get(b.id))!;
    expect(await tree()).toContain(bRow.vaultPath);
    expect(await tree()).toHaveLength(3);
    sqlite.exec("DROP TRIGGER no_repath");
    expect(await repathDocuments()).toBe(1);
    expect((await documentRepo.get(b.id))!.vaultPath).toBe(
      "documents/Unfiled/2026-09-01 Demo lease.pdf",
    );
    expect(doneFlag()).toBe("done");
  });

  it("a cancel stops between files and leaves the job to resume", async () => {
    await setUp();
    const ctl = new AbortController();
    ctl.abort();
    expect(await repathDocuments({ signal: ctl.signal })).toBe(0);
    expect(doneFlag()).toBeUndefined();
    expect(await repathDocuments()).toBe(2);
  });
});

describe("names made by the old UTC-day rule", () => {
  const tz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "America/Los_Angeles";
    vi.useFakeTimers({ toFake: ["Date"] });
    // 23:30 local on 2026-08-12 is 06:30 UTC on 2026-08-13.
    vi.setSystemTime(new Date(2026, 7, 12, 23, 30));
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = tz;
  });

  /** Put a document at `name` in Unfiled, as an older build named it. */
  const placeAt = async (id: string, name: string) => {
    const d = (await documentRepo.get(id))!;
    const at = `documents/Unfiled/${name}`;
    await store.write(at, (await store.read(d.vaultPath!))!);
    await store.remove(d.vaultPath!);
    sqlite.prepare("UPDATE document SET vault_path = ? WHERE id = ?").run(at, id);
  };

  it("moves an app-added UTC-day prefix to the local day, and keeps the rest", async () => {
    const utc = await documentRepo.upload(file("Demo receipt.pdf", "u"));
    const own = await documentRepo.upload(file("Demo lease.pdf", "o"));
    const titled = await documentRepo.upload(file("2026-08-13 Demo bill.pdf", "t"));
    expect(utc.addedAt.slice(0, 10)).toBe("2026-08-13");
    expect(utc.vaultPath).toBe("documents/Unfiled/2026-08-12 Demo receipt.pdf");
    await placeAt(utc.id, "2026-08-13 Demo receipt.pdf");
    // A date the user gave the file by hand is not the app's UTC day: it stays.
    await placeAt(own.id, "2026-07-01 Demo lease.pdf");
    expect(titled.vaultPath).toBe("documents/Unfiled/2026-08-13 Demo bill.pdf");

    expect(await repathDocuments()).toBe(1);
    expect((await documentRepo.get(utc.id))!.vaultPath).toBe(
      "documents/Unfiled/2026-08-12 Demo receipt.pdf",
    );
    expect((await documentRepo.get(own.id))!.vaultPath).toBe(
      "documents/Unfiled/2026-07-01 Demo lease.pdf",
    );
    expect((await documentRepo.get(titled.id))!.vaultPath).toBe(
      "documents/Unfiled/2026-08-13 Demo bill.pdf",
    );
    expect(await store.read("documents/Unfiled/2026-08-13 Demo receipt.pdf")).toBeUndefined();
  });

  it("runs again where the v1 flag was set", async () => {
    sqlite
      .prepare("INSERT INTO meta (key, value) VALUES ('vault_repath_dated_titles', 'done')")
      .run();
    const utc = await documentRepo.upload(file("Demo receipt.pdf", "u"));
    await placeAt(utc.id, "2026-08-13 Demo receipt.pdf");
    expect(await repathDocuments()).toBe(1);
    expect(doneFlag()).toBe("done");
  });
});

describe("bare-year titles (re-path v3)", () => {
  it("uses its own done flag", () => {
    expect(REPATH_DONE_KEY).toBe("vault_repath_v3");
  });

  it("drops the app-added prefix from a bare-year title, where the v2 flag was set", async () => {
    sqlite.prepare("INSERT INTO meta (key, value) VALUES ('vault_repath_v2', 'done')").run();
    const w2 = await documentRepo.upload(file("2025 W-2 Demo employer.pdf", "w"));
    expect(w2.vaultPath).toBe("documents/Unfiled/2025 W-2 Demo employer.pdf");
    const plain = await documentRepo.upload(file("Demo receipt.pdf", "p"));
    const plainPath = plain.vaultPath!;
    const old = await oldPlace(w2.id);
    expect(old).toBe(`documents/Unfiled/${today()} 2025 W-2 Demo employer.pdf`);

    expect(await repathDocuments()).toBe(1);
    const after = (await documentRepo.get(w2.id))!;
    expect(after.vaultPath).toBe("documents/Unfiled/2025 W-2 Demo employer.pdf");
    expect(after.name).toBe("2025 W-2 Demo employer.pdf");
    expect((await documentRepo.get(plain.id))!.vaultPath).toBe(plainPath);
    expect(await store.read(old)).toBeUndefined();
    expect(doneFlag()).toBe("done");
    expect(await repathDocuments()).toBe(0);
  });
});

describe("a restore of an older backup", () => {
  it("clears the flag, so the re-path runs again and no double dates come back", async () => {
    const { a } = await setUp();
    const old = (await documentRepo.get(a.id))!.vaultPath!;
    const backup = await buildBundle({ includeDeleted: true });
    await repathDocuments();
    expect(doneFlag()).toBe("done");
    const fixed = (await documentRepo.get(a.id))!.vaultPath!;
    // The backup's rows carry the old paths; its files come back there too.
    // An export leaves vault_path out (the restore re-places those rows); an older bundle that
    // carries one is the case to cover.
    const withPaths = {
      ...backup,
      documents: backup.documents.map((d) => (d.id === a.id ? { ...d, vaultPath: old } : d)),
    };
    await importBundle(withPaths, "backup-restore");
    await store.write(old, (await store.read(fixed))!);
    await store.remove(fixed);
    expect(doneFlag()).toBeUndefined();
    expect((await documentRepo.get(a.id))!.vaultPath).toBe(old);
    await repathDocuments();
    expect((await documentRepo.get(a.id))!.vaultPath).toBe(fixed);
    expect((await tree()).some((p) => /\/\d{4}-\d{2}-\d{2} \d{4}-\d{2}-\d{2}[ .]/.test(p))).toBe(
      false,
    );
    expect(doneFlag()).toBe("done");
  });
});
