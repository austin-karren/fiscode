import {
  OperationCancelledError,
  VaultAlreadyPickedError,
  VaultNameTakenError,
  VaultPermissionError,
} from "@fiscode/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDir, type VaultDirHandle } from "./dir.ts";
import {
  __setVaultBackendForTests,
  canPickFolder,
  CACHE_MAX_BYTES,
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
  // Chromium: the File System Access API exists, so boot reads the kept handle.
  vi.stubGlobal("showDirectoryPicker", () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
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
    await expect(
      store.holds("documents/seen.pdf", await sha256Hex(bytes("seen"))),
    ).rejects.toBeInstanceOf(VaultPermissionError);
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

  it("drops a cached path when a copy overwrites it (S5)", async () => {
    const { folder, state } = fakeFolder();
    const store = pickedFolderStore(folder, opfs);
    await store.write("documents/a.pdf", bytes("a"));
    await store.write("documents/b.pdf", bytes("b-old"));
    await store.read("documents/b.pdf");
    await store.remove("documents/b.pdf");
    await store.write("documents/b.pdf", bytes("b-old"));
    await store.read("documents/b.pdf");
    await store.copy("documents/a.pdf", "documents/c.pdf", await sha256Hex(bytes("a")));
    await store.read("documents/c.pdf");
    await store.copy("documents/b.pdf", "documents/c.pdf", await sha256Hex(bytes("b-old")));
    state.permission = "prompt";
    expect(await store.read("documents/c.pdf")).toBeUndefined();
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

  it("an oversized file alone doesn't push out the files after it that fit", async () => {
    const cache = vaultCache(opfs);
    await cache.put("documents/small.pdf", bytes("s"));
    await cache.put("documents/huge.pdf", new Blob([new Uint8Array(CACHE_MAX_BYTES)]));
    await cache.put("documents/new.pdf", bytes("n"));
    expect(await text(await cache.read("documents/new.pdf"))).toBe("n");
    expect(await cache.read("documents/huge.pdf")).toBeUndefined();
    await cache.put("documents/newer.pdf", bytes("m"));
    expect(await text(await cache.read("documents/new.pdf"))).toBe("n");
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

  it("hides the option on mobile even when showDirectoryPicker exists", () => {
    const pick = () => {};
    const media = (coarse: boolean, fine: boolean) => (q: string) => ({
      matches: q.includes("any-pointer: fine") ? fine : coarse,
    });
    expect(
      canPickFolder({ showDirectoryPicker: pick, navigator: { userAgentData: { mobile: true } } }),
    ).toBe(false);
    expect(
      canPickFolder({ showDirectoryPicker: pick, navigator: { userAgentData: { mobile: false } } }),
    ).toBe(true);
    expect(
      canPickFolder({
        showDirectoryPicker: pick,
        navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile" },
      }),
    ).toBe(false);
    expect(canPickFolder({ showDirectoryPicker: pick, matchMedia: media(true, false) })).toBe(
      false,
    );
    expect(canPickFolder({ showDirectoryPicker: pick, matchMedia: media(false, true) })).toBe(true);
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

  it("a resume into another folder still copies the files the journal counted", async () => {
    await seed();
    const ac = new AbortController();
    await expect(
      switchVaultToFolder(fakeFolder().folder, {
        signal: ac.signal,
        onProgress: (p) => p.done === 2 && ac.abort(),
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    const { folder, dir } = fakeFolder();
    await switchVaultToFolder(folder);
    for (const p of ["fiscode.json", "documents/2026/Expenses/a.pdf", "exports/x.csv"]) {
      expect(await has(dir, p)).toBe(true);
    }
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

  const manifest = (v: number) =>
    bytes(JSON.stringify({ format: "fiscode-vault", formatVersion: 1, v }));

  it("switches back into a folder used before where documents changed (B2)", async () => {
    await seed();
    await getVaultStore().write("fiscode.json", manifest(1));
    await getVaultStore().write("documents/2026/Expenses/same.pdf", bytes("same"));
    const { folder, dir } = fakeFolder();
    await switchVaultToFolder(folder);
    await switchVaultToOpfs();
    // Changed in OPFS since, plus a stray the user dropped into the folder meanwhile.
    await getVaultStore().write("documents/2026/Expenses/a.pdf", bytes("a2"));
    await getVaultStore().write("fiscode.json", manifest(2));
    await dir
      .getDirectoryHandle("documents", { create: true })
      .then((d) => d.getFileHandle("stray.pdf", { create: true }));
    await switchVaultToFolder(folder);
    const store = getVaultStore();
    expect(await text(await store.read("documents/2026/Expenses/a.pdf"))).toBe("a2");
    expect(await text(await store.read("documents/2026/Expenses/same.pdf"))).toBe("same");
    // The replaced bytes were kept first, under the copy rule.
    const old = await store.resolveOldBytes(await sha256Hex(bytes("a")));
    expect(await text(old?.bytes)).toBe("a");
    expect(old?.path.startsWith("_fiscode/versions/")).toBe(true);
    // The stray is untouched; the scan lists it as "New in folder".
    expect(await has(dir, "documents/stray.pdf")).toBe(true);
    expect(await pendingVaultSwitch()).toBeUndefined();
  });

  it("a switch back reads the folder, not stale cache bytes (S3)", async () => {
    await seed();
    const { folder, dir, state } = fakeFolder();
    await switchVaultToFolder(folder);
    await getVaultStore().read("exports/x.csv"); // cached as "csv"
    // Edited outside fiscode, then the permission lapses.
    const f = await (await dir.getDirectoryHandle("exports")).getFileHandle("x.csv");
    const w = await f.createWritable();
    await w.write(bytes("csv-new"));
    await w.close();
    let calls = 0;
    const lapsing = {
      ...folder,
      queryPermission: async () => (calls++ < 2 ? "granted" : state.permission),
    } as PickedDirHandle;
    handles.value = lapsing;
    await initVaultBackend();
    state.permission = "prompt";
    await expect(switchVaultToOpfs()).rejects.toBeInstanceOf(VaultPermissionError);
    expect(handles.value).toBe(lapsing);
    state.permission = "granted";
    await switchVaultToOpfs();
    expect(await text(await getVaultStore().read("exports/x.csv"))).toBe("csv-new");
  });

  it("on boot, a journal left by a crash after the flip is rolled forward (S4)", async () => {
    await seed();
    const { folder } = fakeFolder();
    await switchVaultToFolder(folder);
    // Simulate the crash window: journal still there, OPFS vault/ not yet removed.
    const j = await opfs.getFileHandle("vault-switch.json", { create: true });
    const w = await j.createWritable();
    await w.write(bytes(JSON.stringify({ to: "folder", done: ["fiscode.json"] })));
    await w.close();
    await (
      await opfs.getDirectoryHandle("vault", { create: true })
    ).getFileHandle("orphan.pdf", {
      create: true,
    });
    await initVaultBackend();
    expect(await pendingVaultSwitch()).toBeUndefined();
    expect(await has(opfs, "vault/orphan.pdf")).toBe(false);
    await expect(switchVaultToFolder(folder)).rejects.toBeInstanceOf(VaultAlreadyPickedError);
  });

  it("on boot, a journal for a pending switch the other way stays", async () => {
    await seed();
    const ac = new AbortController();
    await expect(
      switchVaultToFolder(fakeFolder().folder, {
        signal: ac.signal,
        onProgress: (p) => p.done === 1 && ac.abort(),
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    await initVaultBackend();
    expect(await pendingVaultSwitch()).toEqual({ to: "folder", done: 1 });
  });

  it("on boot, touch and mobile signals still use the kept folder and keep a pending switch (N1)", async () => {
    await seed();
    const { folder } = fakeFolder();
    await switchVaultToFolder(folder);
    const ac = new AbortController();
    await expect(
      switchVaultToOpfs({ signal: ac.signal, onProgress: (p) => p.done === 1 && ac.abort() }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    vi.stubGlobal("navigator", { userAgentData: { mobile: true }, userAgent: "Mobile" });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(pointer: coarse)" }));
    expect(canPickFolder()).toBe(false);
    await initVaultBackend();
    expect(await vaultPermissionState()).toBe("granted");
    expect(await text(await getVaultStore().read("exports/x.csv"))).toBe("csv");
    expect(await pendingVaultSwitch()).toEqual({ to: "opfs", done: 1 });
    await switchVaultToOpfs();
    expect(await pendingVaultSwitch()).toBeUndefined();
    expect(await vaultPermissionState()).toBe("opfs");
    expect(await text(await getVaultStore().read("documents/2026/Expenses/a.pdf"))).toBe("a");
  });

  it("on boot, an unreadable handle store leaves a pending switch alone (N1)", async () => {
    await seed();
    const { folder } = fakeFolder();
    await switchVaultToFolder(folder);
    const ac = new AbortController();
    await expect(
      switchVaultToOpfs({ signal: ac.signal, onProgress: (p) => p.done === 1 && ac.abort() }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    handles.get = async () => {
      throw new Error("idb down");
    };
    await initVaultBackend();
    expect(await pendingVaultSwitch()).toEqual({ to: "opfs", done: 1 });
  });

  it("needs the folder granted", async () => {
    await seed();
    const { folder } = fakeFolder({ permission: "prompt" });
    await expect(switchVaultToFolder(folder)).rejects.toBeInstanceOf(VaultPermissionError);
  });
});
