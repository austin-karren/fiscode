import { StorageQuotaError, VaultFileLockedError } from "@fiscode/core";
import { isNotFound, type VaultDirHandle, type VaultFileHandle } from "./dir.ts";

/** Lowercase hex sha256 of the bytes (Web Crypto; also in Node 20+). */
export const sha256Hex = async (bytes: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** Where old bytes are kept (ADR § 2). A sha is in only one of them. */
export type OldBytesFolder = "versions" | "trash";

export const oldBytesPath = (folder: OldBytesFolder, sha256: string) =>
  `_fiscode/${folder}/${sha256.slice(0, 2)}/${sha256}`;

/** The by-sha part of the store: what backup and restore read and write. */
export type ShaStore = Pick<VaultStore, "has" | "put" | "get">;

export type VaultEntry = { name: string; kind: "file" | "directory" };

/**
 * Document bytes (ADR § 7). Two parts while the vault is being built:
 * - by sha: `has`/`put`/`get` on the content-addressed blobs at `documents/blobs/<sha[0:2]>/<sha>`
 *   in the root, which is where every document's bytes are until PR 3's migration;
 * - by path: the readable tree under `vault/`. Paths are relative to it, `/`-separated.
 * Every path op is idempotent, so the journal (journal.ts) can repeat any of them after a crash.
 */
export type VaultStore = {
  has(sha256: string): Promise<boolean>;
  /** Writes the bytes unless a blob with that sha is already there (dedupe). */
  put(sha256: string, bytes: Blob): Promise<void>;
  /** The bytes, or undefined when this device doesn't have them (e.g. after a CSV-only restore). */
  get(sha256: string): Promise<Blob | undefined>;

  read(path: string): Promise<Blob | undefined>;
  /** True when `path` is a file whose bytes hash to `sha256`. */
  holds(path: string, sha256: string): Promise<boolean>;
  /** Writes to `.<name>.fiscode-tmp` beside it, then renames into place (ADR § 6 step 3). */
  write(path: string, bytes: Blob): Promise<void>;
  /** Done when `to` already holds `sha256`. */
  copy(from: string, to: string, sha256: string): Promise<void>;
  /** Done when `to` holds `sha256` and `from` is gone; finishes a half-done move. */
  move(from: string, to: string, sha256: string): Promise<void>;
  /** Done when `path` is gone. Removes directories left empty, up to the vault root. */
  remove(path: string): Promise<void>;
  /** The entries of a directory, sorted; empty when it doesn't exist. */
  list(dir: string): Promise<VaultEntry[]>;

  /** Old bytes: `_fiscode/versions/`, then `_fiscode/trash/` (ADR § 2). */
  resolveOldBytes(sha256: string): Promise<{ path: string; bytes: Blob } | undefined>;
  /**
   * The copy rule (ADR § 2): copy `from` into `_fiscode/<folder>/` only when neither folder holds
   * `sha256`. Returns the copy it made, or undefined when the bytes were already kept.
   */
  keepOldBytes(
    folder: OldBytesFolder,
    from: string,
    sha256: string,
  ): Promise<{ to: string } | undefined>;
};

export const VAULT_DIR = "vault";
export const TMP_SUFFIX = ".fiscode-tmp";

const isQuotaError = (err: unknown): boolean =>
  err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22);
const isLockedError = (err: unknown): boolean =>
  err instanceof DOMException &&
  (err.name === "NoModificationAllowedError" || err.name === "InvalidStateError");

const split = (path: string) => {
  const parts = path.split("/").filter((p) => p !== "");
  const name = parts.pop();
  if (!name) throw new Error(`Not a file path: "${path}"`);
  return { dirs: parts, name };
};

/** The vault over a directory handle: OPFS's root in the app, a fake in tests. */
export const vaultStore = (root: VaultDirHandle): VaultStore => {
  const walk = async (from: VaultDirHandle, dirs: string[], create: boolean) => {
    let dir = from;
    for (const d of dirs) dir = await dir.getDirectoryHandle(d, { create });
    return dir;
  };
  const vaultDir = (create: boolean) => root.getDirectoryHandle(VAULT_DIR, { create });
  const fileAt = async (path: string): Promise<VaultFileHandle | undefined> => {
    const { dirs, name } = split(path);
    try {
      return await (await walk(await vaultDir(false), dirs, false)).getFileHandle(name);
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  };

  const writeFile = async (dir: VaultDirHandle, name: string, bytes: Blob, label: string) => {
    try {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return handle;
    } catch (err) {
      if (isQuotaError(err)) throw new StorageQuotaError();
      if (isLockedError(err)) throw new VaultFileLockedError(label);
      throw err;
    }
  };

  const blobDir = async (sha: string, create: boolean) =>
    walk(root, ["documents", "blobs", sha.slice(0, 2)], create);
  const blobHandle = async (sha: string) => {
    try {
      return await (await blobDir(sha, false)).getFileHandle(sha);
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  };

  const store: VaultStore = {
    async has(sha) {
      return (await blobHandle(sha)) !== undefined;
    },
    async put(sha, bytes) {
      if (await store.has(sha)) return;
      await writeFile(await blobDir(sha, true), sha, bytes, sha);
    },
    async get(sha) {
      const handle = await blobHandle(sha);
      return handle ? handle.getFile() : undefined;
    },

    async read(path) {
      const handle = await fileAt(path);
      return handle ? handle.getFile() : undefined;
    },
    async holds(path, sha) {
      const bytes = await store.read(path);
      return bytes !== undefined && (await sha256Hex(bytes)) === sha;
    },
    async write(path, bytes) {
      const { dirs, name } = split(path);
      const dir = await walk(await vaultDir(true), dirs, true);
      const tmpName = `.${name}${TMP_SUFFIX}`;
      const tmp = await writeFile(dir, tmpName, bytes, path);
      // One rename that replaces any file at `name`, so the final name never lacks a file.
      await tmp.move(name);
    },
    async copy(from, to, sha) {
      if (await store.holds(to, sha)) return;
      const bytes = await store.read(from);
      if (!bytes) throw new DOMException(`${from} not found`, "NotFoundError");
      await store.write(to, bytes);
    },
    async move(from, to, sha) {
      if (!(await store.holds(to, sha))) await store.copy(from, to, sha);
      await store.remove(from);
    },
    async remove(path) {
      const { dirs, name } = split(path);
      let dir: VaultDirHandle;
      const chain: VaultDirHandle[] = [];
      try {
        dir = await vaultDir(false);
        chain.push(dir);
        for (const d of dirs) {
          dir = await dir.getDirectoryHandle(d);
          chain.push(dir);
        }
      } catch (err) {
        if (isNotFound(err)) return;
        throw err;
      }
      await removeIn(dir, name);
      // Prune directories this left empty, deepest first; never the vault root itself.
      for (let i = dirs.length - 1; i >= 0; i--) {
        if (!(await isEmpty(chain[i + 1]!))) break;
        await removeIn(chain[i]!, dirs[i]!);
      }
    },
    async list(path) {
      let dir: VaultDirHandle;
      try {
        dir = await walk(
          await vaultDir(false),
          path.split("/").filter((p) => p !== ""),
          false,
        );
      } catch (err) {
        if (isNotFound(err)) return [];
        throw err;
      }
      const out: VaultEntry[] = [];
      for await (const [name, handle] of dir.entries()) out.push({ name, kind: handle.kind });
      return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },

    async resolveOldBytes(sha) {
      for (const folder of ["versions", "trash"] as const) {
        const path = oldBytesPath(folder, sha);
        const bytes = await store.read(path);
        if (bytes) return { path, bytes };
      }
      return undefined;
    },
    async keepOldBytes(folder, from, sha) {
      if (await store.resolveOldBytes(sha)) return undefined;
      const to = oldBytesPath(folder, sha);
      await store.copy(from, to, sha);
      return { to };
    },
  };
  return store;
};

const removeIn = async (dir: VaultDirHandle, name: string) => {
  try {
    await dir.removeEntry(name);
  } catch (err) {
    if (isNotFound(err)) return;
    if (isLockedError(err)) throw new VaultFileLockedError(name);
    throw err;
  }
};

const isEmpty = async (dir: VaultDirHandle) => {
  for await (const _ of dir.entries()) return false;
  return true;
};

/** OPFS: the browser's origin-private file system. */
export const opfsRoot = (): Promise<VaultDirHandle> => {
  const storage = (
    navigator as unknown as {
      storage: { getDirectory(): Promise<VaultDirHandle>; persist?(): Promise<boolean> };
    }
  ).storage;
  // ADR § 7: ask once that the browser not evict the vault. Refusal changes nothing here.
  void storage.persist?.().catch(() => false);
  return storage.getDirectory();
};

/** A handle that resolves on first use, so creating the store doesn't touch OPFS. */
export const lazyDir = (open: () => Promise<VaultDirHandle>): VaultDirHandle => {
  let p: Promise<VaultDirHandle> | undefined;
  const get = () => (p ??= open());
  return {
    kind: "directory",
    getDirectoryHandle: async (n, o) => (await get()).getDirectoryHandle(n, o),
    getFileHandle: async (n, o) => (await get()).getFileHandle(n, o),
    removeEntry: async (n, o) => (await get()).removeEntry(n, o),
    async *entries() {
      yield* (await get()).entries();
    },
  };
};

let _store: VaultStore | undefined;

/** The store in use: OPFS unless a test set another. */
export const getVaultStore = (): VaultStore => (_store ??= vaultStore(lazyDir(opfsRoot)));

/** For tests and the headless backup: use `store` (pass undefined to go back to OPFS). */
export const __setVaultStoreForTests = (store: VaultStore | undefined) => {
  _store = store;
};
