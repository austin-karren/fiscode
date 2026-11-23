// The few File System Access handle methods the vault uses. OPFS gives these in every engine; a
// user-picked folder (PR 7) gives the same shape. This package's TS libs don't include the DOM
// file system types, so they are declared here; the browser provides them at run time.

export type VaultWritable = { write(data: Blob): Promise<void>; close(): Promise<void> };

export type VaultFileHandle = {
  readonly kind: "file";
  getFile(): Promise<Blob>;
  createWritable(): Promise<VaultWritable>;
  /** Rename within the same directory, replacing a file already at `newName`. */
  move(newName: string): Promise<void>;
};

export type VaultDirHandle = {
  readonly kind: "directory";
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<VaultDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<VaultFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, VaultFileHandle | VaultDirHandle]>;
};

export const isNotFound = (err: unknown): boolean =>
  err instanceof DOMException && err.name === "NotFoundError";

/** A file where a folder was expected, or the other way round. */
export const isTypeMismatch = (err: unknown): boolean =>
  err instanceof DOMException && err.name === "TypeMismatchError";

const notFound = (name: string) => new DOMException(`${name} not found`, "NotFoundError");

/**
 * An in-memory directory with OPFS semantics: a writable commits only on close(), a missing
 * entry throws NotFoundError. For tests, and for tests in other packages.
 */
export const memoryDir = (): VaultDirHandle => {
  const files = new Map<string, Blob>();
  const dirs = new Map<string, VaultDirHandle>();
  const fileHandle = (name: string): VaultFileHandle => ({
    kind: "file",
    async getFile() {
      const blob = files.get(name);
      if (!blob) throw notFound(name);
      return blob;
    },
    async createWritable() {
      const parts: Blob[] = [];
      return {
        async write(data) {
          parts.push(data);
        },
        async close() {
          files.set(name, new Blob(parts));
        },
      };
    },
    async move(newName) {
      const blob = files.get(name);
      if (!blob) throw notFound(name);
      files.delete(name);
      files.set(newName, blob);
    },
  });
  const self: VaultDirHandle = {
    kind: "directory",
    async getDirectoryHandle(name, options) {
      const existing = dirs.get(name);
      if (existing) return existing;
      if (files.has(name)) throw new DOMException(name, "TypeMismatchError");
      if (!options?.create) throw notFound(name);
      const created = memoryDir();
      dirs.set(name, created);
      return created;
    },
    async getFileHandle(name, options) {
      if (dirs.has(name)) throw new DOMException(name, "TypeMismatchError");
      if (!files.has(name)) {
        if (!options?.create) throw notFound(name);
        files.set(name, new Blob([]));
      }
      return fileHandle(name);
    },
    async removeEntry(name, options) {
      if (files.delete(name)) return;
      const dir = dirs.get(name);
      if (!dir) throw notFound(name);
      if (!options?.recursive) {
        for await (const _ of dir.entries()) {
          throw new DOMException(`${name} is not empty`, "InvalidModificationError");
        }
      }
      dirs.delete(name);
    },
    async *entries() {
      for (const name of [...dirs.keys()].sort()) yield [name, dirs.get(name)!];
      for (const name of [...files.keys()].sort()) yield [name, fileHandle(name)];
    },
  };
  return self;
};
