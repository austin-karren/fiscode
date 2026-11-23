import { describe, expect, it } from "vitest";
import { memoryDir, type VaultDirHandle } from "./dir.ts";
import { oldBytesPath, sha256Hex, vaultStore, VaultWrongKindError } from "./store.ts";

const bytes = (s: string) => new Blob([s]);
const setup = () => {
  const root = memoryDir();
  return { root, store: vaultStore(root) };
};
const names = async (root: VaultDirHandle, path: string[]) => {
  let dir = root;
  for (const p of path) dir = await dir.getDirectoryHandle(p);
  const out: string[] = [];
  for await (const [n] of dir.entries()) out.push(n);
  return out;
};

describe("vaultStore by sha (documents/blobs until PR 3)", () => {
  it("puts once per sha and reads it back from the legacy blob path", async () => {
    const { root, store } = setup();
    const sha = await sha256Hex(bytes("a"));
    await store.put(sha, bytes("a"));
    await store.put(sha, bytes("ignored"));
    expect(await (await store.get(sha))!.text()).toBe("a");
    expect(await names(root, ["documents", "blobs", sha.slice(0, 2)])).toEqual([sha]);
    expect(await store.has("0".repeat(64))).toBe(false);
    expect(await store.get("0".repeat(64))).toBeUndefined();
  });
});

describe("vaultStore by path", () => {
  it("writes through a hidden temp name, then renames into place", async () => {
    const { root, store } = setup();
    await store.write("documents/2026/Expenses/a.pdf", bytes("one"));
    await store.write("documents/2026/Expenses/a.pdf", bytes("two"));
    expect(await names(root, ["vault", "documents", "2026", "Expenses"])).toEqual(["a.pdf"]);
    expect(await (await store.read("documents/2026/Expenses/a.pdf"))!.text()).toBe("two");
  });

  it("replaces through remove-then-move where an engine won't move onto a taken name", async () => {
    const root = memoryDir();
    const strict = (dir: VaultDirHandle): VaultDirHandle => ({
      ...dir,
      getDirectoryHandle: async (n, o) => strict(await dir.getDirectoryHandle(n, o)),
      getFileHandle: async (n, o) => {
        const file = await dir.getFileHandle(n, o);
        return {
          ...file,
          async move(newName) {
            const taken = await dir.getFileHandle(newName).then(
              () => true,
              () => false,
            );
            if (taken) throw new DOMException(newName, "InvalidModificationError");
            await file.move(newName);
          },
        };
      },
    });
    const store = vaultStore(strict(root));
    await store.write("x/a.pdf", bytes("one"));
    await store.write("x/a.pdf", bytes("two"));
    expect(await names(root, ["vault", "x"])).toEqual(["a.pdf"]);
    expect(await (await store.read("x/a.pdf"))!.text()).toBe("two");
    const sha = await sha256Hex(bytes("blob"));
    await store.put(sha, bytes("blob"));
    expect(await names(root, ["documents", "blobs", sha.slice(0, 2)])).toEqual([sha]);
  });

  it("never removes the live file when the temp file vanished before the rename", async () => {
    const root = memoryDir();
    const vanishing = (dir: VaultDirHandle): VaultDirHandle => ({
      ...dir,
      getDirectoryHandle: async (n, o) => vanishing(await dir.getDirectoryHandle(n, o)),
      getFileHandle: async (n, o) => {
        const file = await dir.getFileHandle(n, o);
        if (!n.endsWith(".fiscode-tmp")) return file;
        return {
          ...file,
          async move() {
            await dir.removeEntry(n); // e.g. a sync client took it
            throw new DOMException(n, "NotFoundError");
          },
        };
      },
    });
    const plain = vaultStore(root);
    await plain.write("x/a.pdf", bytes("live"));
    await expect(vaultStore(vanishing(root)).write("x/a.pdf", bytes("new"))).rejects.toThrow();
    expect(await (await plain.read("x/a.pdf"))!.text()).toBe("live");
  });

  it("never removes the live file when a refused rename finds the temp file gone", async () => {
    const root = memoryDir();
    const refusing = (dir: VaultDirHandle): VaultDirHandle => ({
      ...dir,
      getDirectoryHandle: async (n, o) => refusing(await dir.getDirectoryHandle(n, o)),
      getFileHandle: async (n, o) => {
        const file = await dir.getFileHandle(n, o);
        if (!n.endsWith(".fiscode-tmp")) return file;
        return {
          ...file,
          async move() {
            await dir.removeEntry(n);
            throw new DOMException(n, "InvalidModificationError");
          },
        };
      },
    });
    const plain = vaultStore(root);
    await plain.write("x/a.pdf", bytes("live"));
    await expect(vaultStore(refusing(root)).write("x/a.pdf", bytes("new"))).rejects.toThrow();
    expect(await (await plain.read("x/a.pdf"))!.text()).toBe("live");
  });

  it("gives a typed error, not 'not found', where a folder sits at a file's path", async () => {
    const { store } = setup();
    await store.write("documents/2026/a.pdf", bytes("a"));
    for (const op of [
      () => store.read("documents/2026"),
      () => store.write("documents/2026", bytes("x")),
      () => store.remove("documents/2026"),
      () => store.read("documents/2026/a.pdf/inner.pdf"),
      () => store.list("documents/2026/a.pdf"),
    ]) {
      await expect(op()).rejects.toBeInstanceOf(VaultWrongKindError);
    }
    expect(await store.list("documents")).toEqual([{ name: "2026", kind: "directory" }]);
  });

  it("moves idempotently, and finishes a half-done move", async () => {
    const { store } = setup();
    const sha = await sha256Hex(bytes("a"));
    await store.write("a/one.pdf", bytes("a"));
    await store.move("a/one.pdf", "b/two.pdf", sha);
    await store.move("a/one.pdf", "b/two.pdf", sha); // again: done
    expect(await store.read("a/one.pdf")).toBeUndefined();
    expect(await store.holds("b/two.pdf", sha)).toBe(true);
    // Crash between the copy and the remove: both exist.
    await store.write("a/one.pdf", bytes("a"));
    await store.move("a/one.pdf", "b/two.pdf", sha);
    expect(await store.read("a/one.pdf")).toBeUndefined();
  });

  it("copies idempotently and removes what is already gone", async () => {
    const { store } = setup();
    const sha = await sha256Hex(bytes("a"));
    await store.write("a.pdf", bytes("a"));
    await store.copy("a.pdf", "b.pdf", sha);
    await store.remove("a.pdf");
    await store.copy("a.pdf", "b.pdf", sha); // `to` holds sha: done without reading `from`
    await store.remove("a.pdf");
    expect(await store.holds("b.pdf", sha)).toBe(true);
  });

  it("lists a directory and prunes directories a remove left empty", async () => {
    const { store } = setup();
    await store.write("documents/2026/Income/b.pdf", bytes("b"));
    await store.write("documents/2026/a.pdf", bytes("a"));
    expect(await store.list("documents/2026")).toEqual([
      { name: "Income", kind: "directory" },
      { name: "a.pdf", kind: "file" },
    ]);
    await store.remove("documents/2026/Income/b.pdf");
    expect(await store.list("documents/2026")).toEqual([{ name: "a.pdf", kind: "file" }]);
    expect(await store.list("nowhere")).toEqual([]);
  });

  it("hides the temp file a crashed write leaves", async () => {
    const { root, store } = setup();
    await store.write("documents/a.pdf", bytes("a"));
    const dir = await (await root.getDirectoryHandle("vault")).getDirectoryHandle("documents");
    const tmp = await (
      await dir.getFileHandle(".b.pdf.fiscode-tmp", { create: true })
    ).createWritable();
    await tmp.write(bytes("half"));
    await tmp.close();
    expect(await store.list("documents")).toEqual([{ name: "a.pdf", kind: "file" }]);
  });
});

describe("resolveOldBytes and the copy rule (ADR § 2)", () => {
  it("finds a sha in neither, versions, or trash, versions first", async () => {
    const { store } = setup();
    const sha = await sha256Hex(bytes("old"));
    expect(await store.resolveOldBytes(sha)).toBeUndefined();
    await store.write(oldBytesPath("trash", sha), bytes("old"));
    expect((await store.resolveOldBytes(sha))!.path).toBe(oldBytesPath("trash", sha));
    await store.write(oldBytesPath("versions", sha), bytes("old"));
    expect((await store.resolveOldBytes(sha))!.path).toBe(oldBytesPath("versions", sha));
  });

  it("copies only when neither folder holds the sha", async () => {
    const { store } = setup();
    const sha = await sha256Hex(bytes("live"));
    await store.write("documents/a.pdf", bytes("live"));
    // Neither: copied into the folder asked for.
    expect(await store.keepOldBytes("trash", "documents/a.pdf", sha)).toEqual({
      to: oldBytesPath("trash", sha),
    });
    // One (trash) holds it: a later replace does not copy it into versions too.
    expect(await store.keepOldBytes("versions", "documents/a.pdf", sha)).toBeUndefined();
    expect(await store.read(oldBytesPath("versions", sha))).toBeUndefined();
    expect(await store.read("documents/a.pdf")).toBeDefined(); // a copy, never a move
  });

  it("skips the copy when both folders already hold it", async () => {
    const { store } = setup();
    const sha = await sha256Hex(bytes("x"));
    await store.write("documents/a.pdf", bytes("x"));
    await store.write(oldBytesPath("versions", sha), bytes("x"));
    await store.write(oldBytesPath("trash", sha), bytes("x"));
    expect(await store.keepOldBytes("trash", "documents/a.pdf", sha)).toBeUndefined();
  });
});
