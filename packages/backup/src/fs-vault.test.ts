import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "@fiscode/db/vault";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fsVaultStore } from "./node.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fiscode-fs-vault-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("fsVaultStore", () => {
  it("keeps blobs where OPFS keeps them, and runs the path ops on disk", async () => {
    const store = fsVaultStore(dir);
    const bytes = new Blob(["a"]);
    const sha = await sha256Hex(bytes);
    await store.put(sha, bytes);
    expect(readdirSync(join(dir, "documents", "blobs", sha.slice(0, 2)))).toEqual([sha]);

    await store.write("documents/2026/a.pdf", bytes);
    await store.move("documents/2026/a.pdf", "documents/2027/b.pdf", sha);
    expect(readdirSync(join(dir, "vault", "documents"))).toEqual(["2027"]);
    expect(readdirSync(join(dir, "vault", "documents", "2027"))).toEqual(["b.pdf"]);
    expect(await store.holds("documents/2027/b.pdf", sha)).toBe(true);
    await store.remove("documents/2027/b.pdf");
    expect(readdirSync(join(dir, "vault"))).toEqual([]);
  });
});
