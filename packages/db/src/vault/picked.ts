import {
  OperationCancelledError,
  VaultIntegrityError,
  VaultNameTakenError,
  VaultPermissionError,
} from "@fiscode/core";
import { isNotFound, type VaultDirHandle } from "./dir.ts";
import { announceVaultChange, onVaultChange, withVaultLock } from "./lock.ts";
import { MANIFEST_FILE } from "./manifest.ts";
import { assertVaultWritable } from "./state.ts";
import {
  getVaultRoot,
  getVaultStore,
  oldBytesPath,
  opfsVaultStore,
  setActiveVaultStore,
  sha256Hex,
  VAULT_DIR,
  vaultStore,
  type VaultStore,
} from "./store.ts";

// The user-picked folder (ADR 0001 § 7, D1, D7, D10, § 11.1-2). Chromium desktop only. The folder
// is the vault: documents/, exports/, backups/, fiscode.json and _fiscode/ sit at its top. sqlite,
// the journal, the pre-migration blobs and a cache of recently read files stay in OPFS.

export type VaultPermission = "opfs" | "granted" | "prompt" | "denied";
type FolderPermission = Exclude<VaultPermission, "opfs">;

/** A directory handle from showDirectoryPicker: the vault's handle plus its permission calls. */
export type PickedDirHandle = VaultDirHandle & {
  readonly name: string;
  queryPermission(d: { mode: "readwrite" }): Promise<FolderPermission>;
  requestPermission(d: { mode: "readwrite" }): Promise<FolderPermission>;
};

/** Where the picked handle is kept across visits (IndexedDB in the app). */
export type HandleStore = {
  get(): Promise<PickedDirHandle | undefined>;
  set(handle: PickedDirHandle | undefined): Promise<void>;
};

/** The top-level entries that make the vault (§ 2). A switch copies these and nothing else. */
export const VAULT_ENTRIES = [MANIFEST_FILE, "documents", "exports", "backups", "_fiscode"];

/** OPFS: the D7 read cache, its recency index, and the switch journal. */
export const CACHE_DIR = "vault-cache";
const CACHE_INDEX = "vault-cache-index.json";
const SWITCH_JOURNAL = "vault-switch.json";
/** D7 keeps "recently viewed" files: at most this many, and at most this many bytes. */
export const CACHE_MAX_FILES = 200;
export const CACHE_MAX_BYTES = 200 * 1024 * 1024;

/** § 11.2: false in Firefox, Safari and every mobile browser. The picker option is then hidden. */
export const canPickFolder = (g: object = globalThis): boolean =>
  typeof (g as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

const isNotAllowed = (err: unknown) =>
  err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");

const readJson = async <T>(root: VaultDirHandle, name: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await (await (await root.getFileHandle(name)).getFile()).text()) as T;
  } catch (err) {
    if (isNotFound(err) || err instanceof SyntaxError) return undefined;
    throw err;
  }
};
const writeJson = async (root: VaultDirHandle, name: string, value: unknown) => {
  const w = await (await root.getFileHandle(name, { create: true })).createWritable();
  await w.write(new Blob([JSON.stringify(value)], { type: "application/json" }));
  await w.close();
};
const removeFile = (root: VaultDirHandle, name: string) =>
  root.removeEntry(name).catch((err: unknown) => {
    if (!isNotFound(err)) throw err;
  });

/**
 * The D7 cache: the last files read from the folder, by path, in OPFS. Reads fall back to it while
 * the permission has lapsed; a path not in it reads as undefined ("File not on this device").
 */
export const vaultCache = (root: VaultDirHandle) => {
  const files = vaultStore(root, {
    tree: (create) => root.getDirectoryHandle(CACHE_DIR, { create }),
  });
  type Entry = { path: string; size: number };
  // One index write at a time, so two reads can't lose each other's entry.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };
  const index = async () => (await readJson<Entry[]>(root, CACHE_INDEX)) ?? [];
  return {
    read: (path: string) => files.read(path),
    /** Most recent first; the oldest leave once there are too many or they are too big. */
    put: (path: string, bytes: Blob) =>
      serial(async () => {
        await files.write(path, bytes);
        const next = [
          { path, size: bytes.size },
          ...(await index()).filter((e) => e.path !== path),
        ];
        let total = 0;
        const keep: Entry[] = [];
        for (const e of next) {
          const fits = total + e.size <= CACHE_MAX_BYTES || keep.length === 0;
          if (keep.length < CACHE_MAX_FILES && fits) {
            keep.push(e);
            total += e.size;
          } else await files.remove(e.path);
        }
        await writeJson(root, CACHE_INDEX, keep);
      }),
    drop: (path: string) =>
      serial(async () => {
        await files.remove(path);
        await writeJson(
          root,
          CACHE_INDEX,
          (await index()).filter((e) => e.path !== path),
        );
      }),
    clear: () =>
      serial(async () => {
        await root.removeEntry(CACHE_DIR, { recursive: true }).catch((err: unknown) => {
          if (!isNotFound(err)) throw err;
        });
        await removeFile(root, CACHE_INDEX);
      }),
  };
};
export type VaultCache = ReturnType<typeof vaultCache>;

/**
 * The vault in a picked folder. Same contract as OPFS (writes go to a temp name, then rename, with
 * PR 2's fallback). By-sha blobs (pre-migration, D9) stay in OPFS. While the folder isn't granted,
 * every write throws VaultPermissionError (D10) and reads come from the cache (D7).
 */
export const pickedFolderStore = (
  folder: PickedDirHandle,
  opfs: VaultDirHandle,
  cache: VaultCache = vaultCache(opfs),
): VaultStore => {
  const inner = vaultStore(opfs, { tree: async () => folder });
  const granted = async () => (await folder.queryPermission({ mode: "readwrite" })) === "granted";
  /** A write: refused unless granted; a permission lost mid-way is the same error. */
  const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!(await granted())) throw new VaultPermissionError();
    try {
      return await fn();
    } catch (err) {
      if (isNotAllowed(err)) throw new VaultPermissionError();
      throw err;
    }
  };
  const cacheBestEffort = (p: Promise<unknown>) =>
    p.catch((err: unknown) => console.warn("vault cache", err));

  const store: VaultStore = {
    has: (sha) => inner.has(sha),
    get: (sha) => inner.get(sha),
    put: (sha, bytes) => guarded(() => inner.put(sha, bytes)),

    async read(path) {
      if (await granted()) {
        try {
          const bytes = await inner.read(path);
          if (bytes) await cacheBestEffort(cache.put(path, bytes));
          return bytes;
        } catch (err) {
          if (!isNotAllowed(err)) throw err;
        }
      }
      return cache.read(path);
    },
    // The folder only: a cached copy says nothing about what the folder holds, and a check
    // isn't a view, so it doesn't touch the cache.
    holds: (path, sha) => guarded(() => inner.holds(path, sha)),
    write: (path, bytes) =>
      guarded(async () => {
        await inner.write(path, bytes);
        await cacheBestEffort(cache.drop(path));
      }),
    copy: (from, to, sha) => guarded(() => inner.copy(from, to, sha)),
    move: (from, to, sha) =>
      guarded(async () => {
        await inner.move(from, to, sha);
        await cacheBestEffort(cache.drop(from));
      }),
    remove: (path) =>
      guarded(async () => {
        await inner.remove(path);
        await cacheBestEffort(cache.drop(path));
      }),
    // A listing from the cache would make every other file look missing to the scan.
    list: (dir, options) => guarded(() => inner.list(dir, options)),

    async resolveOldBytes(sha) {
      for (const path of [oldBytesPath("versions", sha), oldBytesPath("trash", sha)]) {
        const bytes = await store.read(path);
        if (bytes) return { path, bytes };
      }
      return undefined;
    },
    keepOldBytes: (folder, from, sha) => guarded(() => inner.keepOldBytes(folder, from, sha)),
  };
  return store;
};

// ---- The backend in use ----

const IDB_NAME = "fiscode-vault";
const IDB_STORE = "handles";
const IDB_KEY = "picked";

// The IndexedDB calls used here; this package's TS libs have no DOM types (see dir.ts).
type Req<T = unknown> = {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};
type ObjStore = { get(k: string): Req; put(v: unknown, k: string): Req; delete(k: string): Req };
type Db = {
  createObjectStore(name: string): unknown;
  transaction(
    name: string,
    mode: "readonly" | "readwrite",
  ): { objectStore(name: string): ObjStore };
  close(): void;
};
type OpenReq = Req<Db> & { onupgradeneeded: (() => void) | null };
const idb = () =>
  (globalThis as unknown as { indexedDB: { open(n: string, v: number): OpenReq } }).indexedDB;

/** The picked handle in IndexedDB (a FileSystemDirectoryHandle is structured-cloneable). */
export const indexedDbHandleStore = (): HandleStore => {
  const open = () =>
    new Promise<Db>((resolve, reject) => {
      const req = idb().open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async <T>(mode: "readonly" | "readwrite", fn: (s: ObjStore) => Req) => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: () => run<PickedDirHandle | undefined>("readonly", (s) => s.get(IDB_KEY)),
    set: async (handle) => {
      await run("readwrite", (s) => (handle ? s.put(handle, IDB_KEY) : s.delete(IDB_KEY)));
    },
  };
};

let handles: HandleStore | undefined;
let picked: PickedDirHandle | undefined;
const handleStore = () => (handles ??= indexedDbHandleStore());

/**
 * App start (before the first render): use the picked folder when one is kept, else OPFS. Never
 * throws; a store that can't be read leaves OPFS, which still holds the cache.
 */
let following = false;
export const initVaultBackend = async (): Promise<void> => {
  // Another tab's switch changes the kept handle: pick the backend up again (§ 11.9).
  if (!following) {
    following = true;
    onVaultChange(() => void initVaultBackend());
  }
  try {
    picked = canPickFolder() || handles ? await handleStore().get() : undefined;
  } catch (err) {
    console.error("vault backend", err);
    picked = undefined;
  }
  setActiveVaultStore(picked ? pickedFolderStore(picked, getVaultRoot()) : undefined);
};

/** § 11.1: "opfs" without a picked folder, else the folder's readwrite permission. */
export const vaultPermissionState = async (): Promise<VaultPermission> =>
  picked ? picked.queryPermission({ mode: "readwrite" }) : "opfs";

/** § 11.1: asks for readwrite. Must run in a click handler (a user gesture). */
export const requestVaultPermission = async (): Promise<VaultPermission> => {
  if (!picked) return "opfs";
  const state = await picked.requestPermission({ mode: "readwrite" });
  if (state === "granted") announceVaultChange();
  return state;
};

/** The picked folder's name, for settings ("Your vault is in Fiscode"). */
export const pickedFolderName = (): string | undefined => picked?.name;

// ---- Switching ----

export type SwitchProgress = { phase: "copying"; done: number; total: number };
export type SwitchOptions = { onProgress?: (p: SwitchProgress) => void; signal?: AbortSignal };
type SwitchJournal = { to: "folder" | "opfs"; done: string[] };

const listFiles = async (store: VaultStore): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await store.list(dir)) {
      const path = dir ? `${dir}/${e.name}` : e.name;
      if (e.kind === "directory") await walk(path);
      else out.push(path);
    }
  };
  for (const e of await store.list("")) {
    if (!VAULT_ENTRIES.includes(e.name)) continue;
    if (e.kind === "directory") await walk(e.name);
    else out.push(e.name);
  }
  return out;
};

/**
 * Copies every vault file from `from` to `to`, verifying each sha on the copy. Journaled in OPFS
 * (`vault-switch.json`), so a cancel or crash resumes past what is already verified. The source
 * is left complete. A file at a target path with other bytes is the user's: VaultNameTakenError,
 * unless `overwrite` (OPFS, where only fiscode writes) or it is the manifest.
 */
const copyTree = async (
  from: VaultStore,
  to: VaultStore,
  direction: SwitchJournal["to"],
  overwrite: boolean,
  { onProgress, signal }: SwitchOptions,
) => {
  const root = getVaultRoot();
  const prev = await readJson<SwitchJournal>(root, SWITCH_JOURNAL);
  const journal: SwitchJournal = { to: direction, done: prev?.to === direction ? prev.done : [] };
  const done = new Set(journal.done);
  const files = await listFiles(from);
  onProgress?.({ phase: "copying", done: 0, total: files.length });
  let n = 0;
  for (const path of files) {
    if (signal?.aborted) throw new OperationCancelledError();
    // Every path is checked on the target, journaled or not: a resume may target another
    // folder, or the source may have changed since. The journal only saves the copies.
    {
      const bytes = await from.read(path);
      if (!bytes) throw new VaultIntegrityError(path);
      const sha = await sha256Hex(bytes);
      if (!(await to.holds(path, sha))) {
        // fiscode.json is rebuilt from sqlite, so a folder used before just gets the new one.
        const owned = overwrite || path === MANIFEST_FILE;
        if (!owned && (await to.read(path)) !== undefined) throw new VaultNameTakenError(path);
        await to.write(path, bytes);
        if (!(await to.holds(path, sha))) throw new VaultIntegrityError(path);
      }
      if (!done.has(path)) {
        journal.done.push(path);
        await writeJson(root, SWITCH_JOURNAL, journal);
      }
    }
    onProgress?.({ phase: "copying", done: ++n, total: files.length });
  }
};

/** A switch that stopped part way: which way, and how many files are already verified. */
export const pendingVaultSwitch = async () =>
  readJson<SwitchJournal>(getVaultRoot(), SWITCH_JOURNAL).then((j) =>
    j ? { to: j.to, done: j.done.length } : undefined,
  );

/**
 * OPFS → the picked folder (§ 7). Copies the tree, verifies every sha, then flips: the handle is
 * kept, the picked store is in use, and OPFS's `vault/` is removed (D7: it keeps only the cache).
 * Cancel stops between files; OPFS is still the complete vault and a new call resumes. Runs
 * under the vault lock as a long op. The folder must be granted (the picker grants it).
 */
export const switchVaultToFolder = async (
  folder: PickedDirHandle,
  options: SwitchOptions = {},
): Promise<void> =>
  withVaultLock(
    async () => {
      assertVaultWritable();
      if (picked) throw new Error("The vault is already in a picked folder.");
      const root = getVaultRoot();
      const target = pickedFolderStore(folder, root);
      if ((await folder.queryPermission({ mode: "readwrite" })) !== "granted") {
        throw new VaultPermissionError();
      }
      await copyTree(getVaultStore(), target, "folder", false, options);
      await handleStore().set(folder);
      picked = folder;
      setActiveVaultStore(target);
      await removeFile(root, SWITCH_JOURNAL);
      await root.removeEntry(VAULT_DIR, { recursive: true }).catch((err: unknown) => {
        if (!isNotFound(err)) console.warn("vault switch cleanup", err);
      });
      announceVaultChange();
    },
    { long: true },
  );

/**
 * The picked folder → OPFS. Copies the vault's entries back, verifies, then forgets the folder.
 * The folder's files stay where they are: fiscode never deletes them. Needs the permission.
 */
export const switchVaultToOpfs = async (options: SwitchOptions = {}): Promise<void> =>
  withVaultLock(
    async () => {
      assertVaultWritable();
      if (!picked) return;
      if ((await picked.queryPermission({ mode: "readwrite" })) !== "granted") {
        throw new VaultPermissionError();
      }
      const root = getVaultRoot();
      await copyTree(getVaultStore(), opfsVaultStore(), "opfs", true, options);
      await handleStore().set(undefined);
      picked = undefined;
      setActiveVaultStore(undefined);
      await removeFile(root, SWITCH_JOURNAL);
      await vaultCache(root)
        .clear()
        .catch((err: unknown) => console.warn("vault cache", err));
      announceVaultChange();
    },
    { long: true },
  );

/** Tests: a handle store in memory, and forget the backend. */
export const __setVaultBackendForTests = (store: HandleStore | undefined) => {
  handles = store;
  picked = undefined;
  setActiveVaultStore(undefined);
};
