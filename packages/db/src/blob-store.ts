import { StorageQuotaError } from "@fiscode/core";

/**
 * Where document bytes live: content-addressed by sha256, never in SQLite or the CSV.
 * In the app this is OPFS at `documents/blobs/<sha[0:2]>/<sha256>` (no extension). Blobs are
 * never deleted by app actions: soft delete, replace and unlink leave them, so reverting a
 * document's row brings its old bytes back (contract: drafts/contract-documents.md).
 */
export type BlobStore = {
  has(sha256: string): Promise<boolean>;
  /** Writes the bytes unless a blob with that sha is already there (dedupe). */
  put(sha256: string, bytes: Blob): Promise<void>;
  /** The bytes, or undefined when this device doesn't have them (e.g. after a CSV-only restore). */
  get(sha256: string): Promise<Blob | undefined>;
};

/** Lowercase hex sha256 of the bytes (Web Crypto; also in Node 20+). */
export const sha256Hex = async (bytes: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const isQuotaError = (err: unknown): boolean =>
  err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22);

// The few OPFS handle methods used here. This package's TS libs don't include the DOM file
// system types; the browser provides them at run time.
type OpfsWritable = { write(data: Blob): Promise<void>; close(): Promise<void> };
type OpfsFile = { getFile(): Promise<Blob>; createWritable(): Promise<OpfsWritable> };
type OpfsDirectory = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFile>;
};

/** The OPFS store the app uses. */
export const opfsBlobStore = (): BlobStore => {
  const dir = async (sha: string, create: boolean) => {
    // OPFS: the browser's origin-private file system.
    const storage = (
      navigator as unknown as { storage: { getDirectory(): Promise<OpfsDirectory> } }
    ).storage;
    const root = await storage.getDirectory();
    const documents = await root.getDirectoryHandle("documents", { create });
    const blobs = await documents.getDirectoryHandle("blobs", { create });
    return blobs.getDirectoryHandle(sha.slice(0, 2), { create });
  };
  const fileHandle = async (sha: string) => {
    try {
      return await (await dir(sha, false)).getFileHandle(sha);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") return undefined;
      throw err;
    }
  };
  return {
    async has(sha) {
      return (await fileHandle(sha)) !== undefined;
    },
    async put(sha, bytes) {
      if (await this.has(sha)) return;
      try {
        const handle = await (await dir(sha, true)).getFileHandle(sha, { create: true });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
      } catch (err) {
        if (isQuotaError(err)) throw new StorageQuotaError();
        throw err;
      }
    },
    async get(sha) {
      const handle = await fileHandle(sha);
      return handle ? handle.getFile() : undefined;
    },
  };
};

/** An in-memory store, for tests. */
export const memoryBlobStore = (): BlobStore & { size(): number } => {
  const blobs = new Map<string, Blob>();
  return {
    async has(sha) {
      return blobs.has(sha);
    },
    async put(sha, bytes) {
      if (!blobs.has(sha)) blobs.set(sha, bytes);
    },
    async get(sha) {
      return blobs.get(sha);
    },
    size: () => blobs.size,
  };
};

let _store: BlobStore | undefined;

/** The store in use: OPFS unless a test set another. */
export const getBlobStore = (): BlobStore => (_store ??= opfsBlobStore());

/** For tests: use `store` (pass undefined to go back to OPFS). */
export const __setBlobStoreForTests = (store: BlobStore | undefined) => {
  _store = store;
};
