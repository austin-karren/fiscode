import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  BackupFileCorruptError,
  BackupManifestError,
  BackupTooNewError,
  BackupUnexpectedFileError,
  VaultBusyError,
  VaultMigratingError,
} from "@fiscode/core";
import { exampleBundle } from "@fiscode/csv";
import {
  __setVaultStoreForTests,
  buildBundle,
  documentLinkRepo,
  documentRepo,
  folderRepo,
  getVaultStore,
  importBundle,
  memoryDir,
  vaultStore,
} from "@fiscode/db";
import {
  __resetVaultMigrationStateForTests,
  documentVaultPaths,
  setVaultMigrationState,
  VAULT_LOCK,
  type VaultDirHandle,
  type VaultStore,
} from "@fiscode/db/vault";
import { getDb } from "@fiscode/db/client";
import { document } from "@fiscode/db/schema";
import { setupTestDb, teardownTestDb } from "@fiscode/db/test";
import { eq } from "drizzle-orm";
import {
  createBackup,
  decryptBackup,
  exportVault,
  readBackup,
  restoreBackup,
  type ExportVaultProgress,
} from "./index.ts";
import { createBackupV1 } from "./test-format1.ts";

// ADR 0001 § 9: backup format 2 is the vault layout, restore is 1:1, format 1 still restores, and
// Export vault writes the same tree. Demo data only.

const CREATED = "2026-11-21T12:00:00.000Z";
const PASS = "throwaway-test-passphrase";
const WF = 10;

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = setupTestDb();
  __setVaultStoreForTests(vaultStore(memoryDir()));
});
afterEach(() => {
  __setVaultStoreForTests(undefined);
  __resetVaultMigrationStateForTests();
  teardownTestDb(sqlite);
});

const emptyProfile = () => {
  teardownTestDb(sqlite);
  sqlite = setupTestDb();
  __setVaultStoreForTests(vaultStore(memoryDir()));
};

const file = (name: string, text: string) =>
  Object.assign(new Blob([text], { type: "application/pdf" }), { name });

/** Demo data with documents: one replaced, one duplicate name, shared bytes, one deleted, a link. */
const seed = async () => {
  await importBundle(exampleBundle() as never, "import-restore");
  const year = await folderRepo.ensureYearDefaults(2026);
  const expenses = year.find((f) => f.defaultKey === "expenses")!;
  const receipt = await documentRepo.upload(file("Demo receipt.pdf", "receipt v1"), {
    folderId: expenses.id,
  });
  await documentRepo.replaceBytes(receipt.id, file("Demo receipt.pdf", "receipt v2"));
  await documentRepo.upload(file("Demo receipt.pdf", "another receipt"), { folderId: expenses.id });
  await documentRepo.upload(file("copy.pdf", "receipt v2"));
  const gone = await documentRepo.upload(file("Old scan.pdf", "old scan"));
  await documentRepo.softDelete(gone.id);
  const expense = (await buildBundle()).expenses[0]!;
  await documentLinkRepo.link(receipt.id, "expense", expense.id);
};

const sha = async (b: Blob) => {
  const d = await crypto.subtle.digest("SHA-256", await b.arrayBuffer());
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
};

/** Every `(path, sha256)` pair under documents/ and _fiscode/versions|trash, sorted. */
const treePairs = async (store: VaultStore = getVaultStore()): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await store.list(dir)) {
      const path = `${dir}/${e.name}`;
      if (e.kind === "directory") await walk(path);
      else out.push(`${path} ${await sha((await store.read(path))!)}`);
    }
  };
  for (const top of ["documents", "_fiscode/versions", "_fiscode/trash"]) await walk(top);
  return out.toSorted();
};

const backup = () => createBackup({ createdAt: CREATED, passphrase: PASS, scryptWorkFactor: WF });
const open = async (blob: Blob) => {
  const read = await readBackup(blob, { passphrase: PASS });
  if (!read.ok) throw new Error(read.headline);
  return read;
};
const zipOf = async (blob: Blob) =>
  unzipSync(await decryptBackup(new Uint8Array(await blob.arrayBuffer()), PASS));
const rezip = (entries: Record<string, Uint8Array>) =>
  new Blob([zipSync(entries) as unknown as ArrayBuffer]);

describe("restore is 1:1 (ADR § 9)", () => {
  it("into an empty store: the same (path, sha256) pairs, the same vault_paths, a byte-identical backup", async () => {
    await seed();
    const pairs = await treePairs();
    // Live documents' paths. A soft-deleted row keeps its last path in sqlite only (a hint for
    // undelete); fiscode.json lists the files that are there, so a restore doesn't bring it.
    const livePaths = async () => {
      const live = new Set((await documentRepo.list()).map((d) => d.id));
      return new Map([...(await documentVaultPaths())].filter(([id]) => live.has(id)));
    };
    const paths = await livePaths();
    expect(paths.size).toBe(3);
    expect(pairs.some((p) => p.startsWith("_fiscode/versions/"))).toBe(true);
    expect(pairs.some((p) => p.startsWith("_fiscode/trash/"))).toBe(true);
    const first = await backup();

    emptyProfile();
    expect(await treePairs()).toEqual([]);
    await restoreBackup(await open(first.blob));

    expect(await treePairs()).toEqual(pairs);
    expect(await livePaths()).toEqual(paths);
    const second = await backup();
    expect(await zipOf(second.blob)).toEqual(await zipOf(first.blob));
  });

  it("over existing data: the tree becomes the backup's; this device's files are kept in trash, not lost", async () => {
    await seed();
    const pairs = await treePairs();
    const first = await backup();

    emptyProfile();
    await importBundle(exampleBundle() as never, "import-restore");
    const mine = await documentRepo.upload(file("Mine.pdf", "only on this device"));
    const mineSha = mine.sha256;
    await restoreBackup(await open(first.blob));

    const after = await treePairs();
    const live = after.filter((p) => p.startsWith("documents/"));
    expect(live).toEqual(pairs.filter((p) => p.startsWith("documents/")));
    expect(after.some((p) => p.includes(`_fiscode/trash/${mineSha.slice(0, 2)}/${mineSha}`))).toBe(
      true,
    );
    expect((await documentRepo.list()).map((d) => d.name).toSorted()).toEqual([
      "Demo receipt.pdf",
      "Demo receipt.pdf",
      "copy.pdf",
    ]);
  });

  it("a file already at a backup path with other bytes is kept in trash, then replaced", async () => {
    await seed();
    const first = await backup();
    const [id, target] = [...(await documentVaultPaths())][0]!;
    const want = (await buildBundle()).documents.find((d) => d.id === id)!.sha256;

    emptyProfile();
    await getVaultStore().write(target, new Blob(["something else"]));
    const otherSha = await sha(new Blob(["something else"]));
    await restoreBackup(await open(first.blob));
    expect(await getVaultStore().holds(target, want)).toBe(true);
    expect((await getVaultStore().resolveOldBytes(otherSha))?.path).toMatch(/^_fiscode\/trash\//);
  });

  it("a live document without a vault_path is backed up under _fiscode/ and readable after restore", async () => {
    await seed();
    const [doc] = await documentRepo.list();
    await getDb().update(document).set({ vaultPath: null }).where(eq(document.id, doc!.id));
    const first = await backup();
    const vault = JSON.parse(strFromU8((await zipOf(first.blob))["fiscode.json"]!));
    expect(vault.documents[doc!.id]).toBeUndefined();
    expect(vault.blobs[doc!.sha256]).toBeDefined();

    emptyProfile();
    await restoreBackup(await open(first.blob));
    expect((await documentRepo.readBytes(doc!.id)).size).toBe(doc!.sizeBytes);
  });
});

describe("format 1 still restores", () => {
  it("rows exact, every live document placed in the tree, older versions available", async () => {
    await seed();
    const before = await buildBundle({ includeDeleted: true, includeHistory: true });
    const v1 = await createBackupV1({ createdAt: CREATED, passphrase: PASS, scryptWorkFactor: WF });
    expect(Object.keys(unzipSync(v1.zip))[0]).toBe("manifest.json");

    emptyProfile();
    const read = await open(v1.blob);
    expect(read.manifest.formatVersion).toBe(1);
    expect(read.vault).toBeUndefined();
    await restoreBackup(read);

    const after = await buildBundle({ includeDeleted: true, includeHistory: true });
    expect(after.documents.toSorted((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
      before.documents.toSorted((a, b) => (a.id < b.id ? -1 : 1)),
    );
    const paths = await documentVaultPaths();
    for (const d of after.documents.filter((x) => x.deletedAt === null)) {
      expect(await getVaultStore().holds(paths.get(d.id)!, d.sha256)).toBe(true);
    }
    const receipt = after.documents.find((d) => d.name === "Demo receipt.pdf" && d.folderId)!;
    expect((await documentRepo.versions(receipt.id)).every((v) => v.available)).toBe(true);
    // And it backs up again as format 2.
    const again = await open((await backup()).blob);
    expect(again.manifest.formatVersion).toBe(2);
  });
});

describe("format 2 refusals (nothing written)", () => {
  type Vault = {
    documents: Record<string, { path: string; sha256: string; sizeBytes: number }>;
    blobs: Record<string, { path: string; sizeBytes: number }>;
    formatVersion: number;
  } & Record<string, unknown>;
  const good = async () => {
    await seed();
    const entries = await zipOf((await backup()).blob);
    const vault = JSON.parse(strFromU8(entries["fiscode.json"]!)) as Vault;
    return { entries, vault };
  };
  const withVault = (entries: Record<string, Uint8Array>, v: unknown) =>
    rezip({ ...entries, "fiscode.json": strToU8(JSON.stringify(v)) });

  it("a newer format", async () => {
    const { entries, vault } = await good();
    await expect(open(withVault(entries, { ...vault, formatVersion: 3 }))).rejects.toBeInstanceOf(
      BackupTooNewError,
    );
  });

  it("a document path that leaves documents/ (or the vault)", async () => {
    const { entries, vault } = await good();
    const [id, d] = Object.entries(vault.documents)[0]!;
    for (const path of ["../escape.pdf", "documents/../../x.pdf", "_fiscode/x.pdf", "/abs.pdf"]) {
      const v = { ...vault, documents: { ...vault.documents, [id]: { ...d, path } } };
      await expect(open(withVault({ ...entries, [path]: entries[d.path]! }, v))).rejects.toThrow(
        BackupManifestError,
      );
    }
  });

  it("old bytes anywhere but _fiscode/versions|trash/<ab>/<sha>", async () => {
    const { entries, vault } = await good();
    const [s, b] = Object.entries(vault.blobs)[0]!;
    const v = { ...vault, blobs: { ...vault.blobs, [s]: { ...b, path: `documents/${s}` } } };
    await expect(
      open(withVault({ ...entries, [`documents/${s}`]: entries[b.path]! }, v)),
    ).rejects.toThrow(/wrong place/);
  });

  it("a placed file for a document the data doesn't have", async () => {
    const { entries, vault } = await good();
    const d = Object.values(vault.documents)[0]!;
    const v = { ...vault, documents: { ...vault.documents, "not-a-document": d } };
    // The same path twice is refused first; a fresh path is refused for the unknown id.
    const path = d.path.replace(/\.pdf$/, " (9).pdf");
    const v2 = {
      ...v,
      documents: { ...vault.documents, "not-a-document": { ...d, path } },
      counts: { ...(vault.counts as object), blobs: (vault.counts as { blobs: number }).blobs + 1 },
    };
    await expect(open(withVault(entries, v))).rejects.toThrow(/twice/);
    await expect(open(withVault({ ...entries, [path]: entries[d.path]! }, v2))).rejects.toThrow(
      /doesn't have/,
    );
  });

  it("a damaged file is named; an unlisted file is refused by name; no manifest at all", async () => {
    const { entries, vault } = await good();
    const d = Object.values(vault.documents)[0]!;
    await expect(open(rezip({ ...entries, [d.path]: strToU8("tampered") }))).rejects.toThrow(
      BackupFileCorruptError,
    );
    await expect(open(rezip({ ...entries, "documents/sneaky.pdf": strToU8("x") }))).rejects.toThrow(
      BackupUnexpectedFileError,
    );
    const { ["fiscode.json"]: _gone, ...rest } = entries;
    await expect(open(rezip(rest))).rejects.toThrow(BackupManifestError);
  });
});

describe("D8: the latest CSV in exports/ on every backup", () => {
  it("createBackup writes the backup's CSV into the vault's exports/", async () => {
    await seed();
    const { blob, manifest } = await backup();
    const csv = await getVaultStore().read(manifest.csv.path);
    expect(manifest.csv.path).toBe("exports/fiscode-full-backup-2026-11-21.csv");
    expect(new Uint8Array(await csv!.arrayBuffer())).toEqual(
      (await zipOf(blob))[manifest.csv.path],
    );
  });
});

describe("Export vault", () => {
  it("as a zip: the backup's contents, unencrypted, and it restores 1:1", async () => {
    await seed();
    const pairs = await treePairs();
    const progress: ExportVaultProgress[] = [];
    const out = await exportVault({ createdAt: CREATED, onProgress: (p) => progress.push(p) });
    if (out.kind !== "zip") throw new Error("expected a zip");
    expect(out.fileName).toBe("fiscode-vault-2026-11-21.zip");
    expect(unzipSync(new Uint8Array(await out.blob.arrayBuffer()))).toEqual(
      await zipOf((await backup()).blob),
    );
    // Phases in order, each counting up to its total.
    expect([...new Set(progress.map((p) => p.phase))]).toEqual([
      "reading",
      "collecting",
      "zipping",
    ]);
    for (const p of progress) expect(p.done).toBeLessThanOrEqual(p.total);
    expect(progress.at(-1)).toEqual({ phase: "zipping", done: 1, total: 1 });

    emptyProfile();
    await restoreBackup(await open(out.blob));
    expect(await treePairs()).toEqual(pairs);
  });

  it("into a folder: the tree, fiscode.json written last; a cancel leaves no fiscode.json", async () => {
    await seed();
    const dir = memoryDir();
    const order: string[] = [];
    const out = await exportVault({
      target: { kind: "folder", dir },
      createdAt: CREATED,
      onProgress: (p) => {
        if (p.phase === "writing") order.push(`${p.done}/${p.total}`);
      },
    });
    expect(out.kind).toBe("folder");
    const picked = vaultStore(wrapAsRoot(dir));
    expect(await treePairs(picked)).toEqual(await treePairs());
    expect(await picked.read("fiscode.json")).toBeDefined();
    expect(await picked.read("exports/fiscode-full-backup-2026-11-21.csv")).toBeDefined();
    const files = out.kind === "folder" ? out.files : 0;
    expect(order.at(-1)).toBe(`${files}/${files}`);

    const cancelled = memoryDir();
    const ac = new AbortController();
    let writes = 0;
    const run = exportVault({
      target: { kind: "folder", dir: cancelled },
      createdAt: CREATED,
      signal: ac.signal,
      onProgress: (p) => {
        if (p.phase === "writing" && ++writes === 2) ac.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(await vaultStore(wrapAsRoot(cancelled)).read("fiscode.json")).toBeUndefined();
  });

  it("busy in another tab: VaultBusyError; during the migration: VaultMigratingError", async () => {
    await seed();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holding = navigator.locks.request(VAULT_LOCK, () => held);
    await expect(exportVault()).rejects.toBeInstanceOf(VaultBusyError);
    release();
    await holding;

    setVaultMigrationState({ phase: "migrating", done: 0, total: 3 });
    await expect(exportVault()).rejects.toBeInstanceOf(VaultMigratingError);
  });
});

/** vaultStore reads under `<root>/vault/`; a picked folder is the vault itself. */
const wrapAsRoot = (dir: VaultDirHandle): VaultDirHandle => ({
  kind: "directory",
  getDirectoryHandle: async (name, o) => (name === "vault" ? dir : dir.getDirectoryHandle(name, o)),
  getFileHandle: (n, o) => dir.getFileHandle(n, o),
  removeEntry: (n, o) => dir.removeEntry(n, o),
  entries: () => dir.entries(),
});
