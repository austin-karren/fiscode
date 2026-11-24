import { OperationCancelledError, VaultNameTakenError, VaultPermissionError } from "@fiscode/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryDir, type VaultDirHandle } from "./dir.ts";
import {
  __setVaultBackendForTests,
  canPickFolder,
  CACHE_MAX_FILES,
  initVaultBackend,
  pendingVaultSwitch,
  pickedFolderStore,
  requestVaultPermission,
  switchVaultToFolder,
  switchVaultToOpfs,
  vaultCache,
  vaultPermissionState,
  type HandleStore,
  type PickedDirHandle,
} from "./picked.ts";
import { __resetVaultMigrationStateForTests } from "./state.ts";
import {
  __setVaultStoreForTests,
  getVaultStore,
  oldBytesPath,
  sha256Hex,
  vaultStore,
} from "./store.ts";

const bytes = (s: string) => new Blob([s]);
const text = async (b: Blob | undefined) => (b ? b.text() : undefined);

/** A picked folder: memoryDir whose top-level calls throw NotAllowedError unless granted. */
const fakeFolder = (
  state: { permission: "granted" | "prompt" | "denied" } = { permission: "granted" },
) => {
  const dir = memoryDir();
  const gate =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A) => {
      if (state.permission !== "granted") throw new DOMException("no", "NotAllowedError");
      return fn(...a);
    };
  const folder: PickedDirHandle = {
    kind: "directory",
    name: "Fiscode",
    getDirectoryHandle: gate((n, o) => dir.getDirectoryHandle(n, o)),
    getFileHandle: gate((n, o) => dir.getFileHandle(n, o)),
    removeEntry: gate((n, o) => dir.removeEntry(n, o)),
    entries: () => dir.entries(),
    queryPermission: async () => state.permission,
    requestPermission: async () => {
      if (state.permission === "prompt") state.permission = "granted";
      return state.permission;
    },
  };
  return { folder, dir, state };
};
const memoryHandles = (): HandleStore & { value?: PickedDirHandle } => {
  const h: HandleStore & { value?: PickedDirHandle } = {
    get: async () => h.value,
    set: async (v) => {
      h.value = v;
    },
  };
  return h;
};
const has = async (dir: VaultDirHandle, path: string) => {
  const parts = path.split("/");
  const name = parts.pop()!;
  try {
    let d = dir;
    for (const p of parts) d = await d.getDirectoryHandle(p);
    await d.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
};

let opfs: VaultDirHandle;
let handles: ReturnType<typeof memoryHandles>;
beforeEach(() => {
  opfs = memoryDir();
  __setVaultStoreForTests(vaultStore(opfs), opfs);
  handles = memoryHandles();
  __setVaultBackendForTests(handles);
  __resetVaultMigrationStateForTests();
});
afterEach(() => {
  __setVaultBackendForTests(undefined);
  __setVaultStoreForTests(undefined);
});

describe("pickedFolderStore", () => {
  it("is the vault at the folder's top, written via a temp name, with blobs left in OPFS", async () => {
    const { folder, dir } = fakeFolder();
    const store = pickedFolderStore(folder, opfs);
    await store.write("documents/2026/Expenses/a.pdf", bytes("one"));
    await store.write("documents/2026/Expenses/a.pdf", bytes("two"));
    expect(await text(await store.read("documents/2026/Expenses/a.pdf"))).toBe("two");
    expect(await store.list("documents/2026/Expenses", { withTmp: true })).toEqual([
      { name: "a.pdf", kind: "file" },
    ]);
    expect(await has(dir, "documents/2026/Expenses/a.pdf")).toBe(true);
    expect(await has(opfs, "vault/documents/2026/Expenses/a.pdf")).toBe(false);
    const sha = await sha256Hex(bytes("b"));
    await store.put(sha, bytes("b"));
    expect(await has(opfs, `documents/blobs/${sha.slice(0, 2)}/${sha}`)).toBe(true);
  });

  it("blocks every write with VaultPermissionError while the folder isn't granted (D10)", async () => {
    const { folder, state } = fakeFolder();
    const store = pickedFolderStore(folder, opfs);
    const sha = await sha256Hex(bytes("x"));
    await store.write("documents/x.pdf", bytes("x"));
    state.permission = "prompt";
    await expect(store.write("documents/y.pdf", bytes("y"))).rejects.toBeInstanceOf(
      VaultPermissionError,
    );
    await expect(store.move("documents/x.pdf", "documents/z.pdf", sha)).rejects.toBeInstanceOf(
      VaultPermissionError,
    );
    await expect(store.remove("documents/x.pdf")).rejects.toBeInstanceOf(VaultPermissionError);
    await expect(store.copy("documents/x.pdf", "b.pdf", sha)).rejects.toBeInstanceOf(
      VaultPermissionError,
    );
    await expect(store.keepOldBytes("trash", "documents/x.pdf", sha)).rejects.toBeInstanceOf(
      VaultPermissionError,
    );
    await expect(store.put(sha, bytes("x"))).rejects.toBeInstanceOf(VaultPermissionError);
    // The scan must not take an empty listing for "everything is missing".
    await expect(store.list("documents")).rejects.toBeInstanceOf(VaultPermissionError);
  });

  it("turns a permission lost mid-call into VaultPermissionError", async () => {
    const { folder, state } = fakeFolder();
    const lying = { ...folder, queryPermission: async () => "granted" as const };
    state.permission = "denied";
    await expect(
      pickedFolderStore(lying, opfs).write("documents/a.pdf", bytes("a")),
    ).rejects.toBeInstanceOf(VaultPermissionError);
  });

  it("reads recently read files from the OPFS cache while the permission has lapsed (D7)", async () => {
    const { folder, state } = fakeFolder();
    const store = pickedFolderStore(folder, opfs);
    await store.write("documents/seen.pdf", bytes("seen"));
    await store.write("documents/unseen.pdf", bytes("unseen"));
    const sha = await sha256Hex(bytes("old"));
    await store.write(oldBytesPath("trash", sha), bytes("old"));
    expect(await text(await store.read("documents/seen.pdf"))).toBe("seen");
    expect(await store.resolveOldBytes(sha)).toBeDefined();
    state.permission = "prompt";
    expect(await text(await store.read("documents/seen.pdf"))).toBe("seen");
    expect(await store.read("documents/unseen.pdf")).toBeUndefined();
    expect(await store.holds("documents/seen.pdf", await sha256Hex(bytes("seen")))).toBe(true);
    expect((await store.resolveOldBytes(sha))?.path).toBe(oldBytesPath("trash", sha));
  });

  it("drops a cached path when it is rewritten, moved or removed", async () => {
    const { folder, state } = fakeFolder();
    const store = pickedFolderStore(folder, opfs);
    await store.write("documents/a.pdf", bytes("a"));
    await store.read("documents/a.pdf");
    await store.move("documents/a.pdf", "documents/b.pdf", await sha256Hex(bytes("a")));
    state.permission = "prompt";
    expect(await store.read("documents/a.pdf")).toBeUndefined();
  });
});

describe("vaultCache", () => {
  it("keeps only the most recent files", async () => {
    const cache = vaultCache(opfs);
    for (let i = 0; i <= CACHE_MAX_FILES; i++) await cache.put(`documents/${i}.pdf`, bytes(`${i}`));
    expect(await cache.read("documents/0.pdf")).toBeUndefined();
    expect(await text(await cache.read(`documents/${CACHE_MAX_FILES}.pdf`))).toBe(
      `${CACHE_MAX_FILES}`,
    );
    expect(await text(await cache.read("documents/1.pdf"))).toBe("1");
  });
});

describe("permission state (§ 11.1) and feature detection (§ 11.2)", () => {
  it("is opfs without a picked folder", async () => {
    await initVaultBackend();
    expect(await vaultPermissionState()).toBe("opfs");
    expect(await requestVaultPermission()).toBe("opfs");
  });

  it("restores the kept handle on start and reports and requests its permission", async () => {
    const { folder, state } = fakeFolder({ permission: "prompt" });
    handles.value = folder;
    await initVaultBackend();
    expect(await vaultPermissionState()).toBe("prompt");
    await expect(getVaultStore().write("documents/a.pdf", bytes("a"))).rejects.toBeInstanceOf(
      VaultPermissionError,
    );
    expect(await requestVaultPermission()).toBe("granted");
    expect(state.permission).toBe("granted");
    await getVaultStore().write("documents/a.pdf", bytes("a"));
  });

  it("detects showDirectoryPicker", () => {
    expect(canPickFolder({})).toBe(false);
    expect(canPickFolder({ showDirectoryPicker: () => {} })).toBe(true);
  });
});

describe("switching", () => {
  const seed = async () => {
    const store = getVaultStore();
    await store.write("fiscode.json", bytes("{}"));
    await store.write("documents/2026/Expenses/a.pdf", bytes("a"));
    await store.write("exports/x.csv", bytes("csv"));
    await store.write("_fiscode/trash/ab/abc", bytes("old"));
  };

  it("copies OPFS to the folder, verifies, flips, and back again", async () => {
    await seed();
    const { folder, dir } = fakeFolder();
    await dir.getFileHandle("notes.txt", { create: true });
    const progress: number[] = [];
    await switchVaultToFolder(folder, { onProgress: (p) => progress.push(p.done) });
    expect(progress.at(-1)).toBe(4);
    expect(handles.value).toBe(folder);
    expect(await vaultPermissionState()).toBe("granted");
    expect(await has(dir, "documents/2026/Expenses/a.pdf")).toBe(true);
    expect(await has(opfs, "vault/fiscode.json")).toBe(false);
    expect(await text(await getVaultStore().read("exports/x.csv"))).toBe("csv");

    await getVaultStore().write("documents/new.pdf", bytes("new"));
    await switchVaultToOpfs();
    expect(handles.value).toBeUndefined();
    expect(await vaultPermissionState()).toBe("opfs");
    expect(await has(opfs, "vault/documents/new.pdf")).toBe(true);
    expect(await has(opfs, "vault/notes.txt")).toBe(false);
    // The folder keeps its files: fiscode never deletes from it.
    expect(await has(dir, "documents/new.pdf")).toBe(true);
  });

  it("cancels between files, leaves OPFS complete, and resumes", async () => {
    await seed();
    const { folder } = fakeFolder();
    const ac = new AbortController();
    await expect(
      switchVaultToFolder(folder, {
        signal: ac.signal,
        onProgress: (p) => p.done === 2 && ac.abort(),
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(await pendingVaultSwitch()).toEqual({ to: "folder", done: 2 });
    expect(handles.value).toBeUndefined();
    expect(await text(await getVaultStore().read("exports/x.csv"))).toBe("csv");
    await switchVaultToFolder(folder);
    expect(await pendingVaultSwitch()).toBeUndefined();
    expect(handles.value).toBe(folder);
  });

  it("refuses to overwrite a different file already in the folder", async () => {
    await seed();
    const { folder } = fakeFolder();
    await pickedFolderStore(folder, opfs).write("exports/x.csv", bytes("theirs"));
    await expect(switchVaultToFolder(folder)).rejects.toBeInstanceOf(VaultNameTakenError);
    expect(handles.value).toBeUndefined();
    expect(await has(opfs, "vault/fiscode.json")).toBe(true);
  });

  it("switches back into a folder used before, rewriting only its fiscode.json", async () => {
    await seed();
    const { folder } = fakeFolder();
    await switchVaultToFolder(folder);
    await switchVaultToOpfs();
    await getVaultStore().write("fiscode.json", bytes('{"v":2}'));
    await switchVaultToFolder(folder);
    expect(await text(await getVaultStore().read("fiscode.json"))).toBe('{"v":2}');
  });

  it("needs the folder granted", async () => {
    await seed();
    const { folder } = fakeFolder({ permission: "prompt" });
    await expect(switchVaultToFolder(folder)).rejects.toBeInstanceOf(VaultPermissionError);
  });
});
