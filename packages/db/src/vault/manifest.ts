import { eq } from "drizzle-orm";
import { getDb } from "../client.ts";
import { document, history as historyTable } from "../schema/index.ts";
import type { VaultStore } from "./store.ts";

/** The vault's own description of itself (ADR § 2): a cache of what sqlite says. */
export const MANIFEST_FILE = "fiscode.json";

export type VaultManifest = {
  format: "fiscode-vault";
  formatVersion: 1;
  writtenAt: string;
  documents: Record<string, { path: string; sha256: string; sizeBytes: number }>;
  blobs: Record<string, { path: string; sizeBytes: number }>;
  missing: string[];
};

const sortedObject = <V>(entries: [string, V][]): Record<string, V> =>
  Object.fromEntries(entries.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Every sha a row or a History entry of a document refers to, other than live documents' current
 * bytes: the bytes `_fiscode/` must hold (§ 2). `old` are History's earlier versions; `deleted` are
 * soft-deleted documents' bytes.
 */
export const referencedOldShas = async (): Promise<{ versions: string[]; trash: string[] }> => {
  const db = getDb();
  const docs = await db.select().from(document);
  const current = new Map(docs.map((d) => [d.id, d.sha256]));
  const live = new Set(docs.filter((d) => d.deletedAt === null).map((d) => d.sha256));
  const versions = new Set<string>();
  const rows = await db
    .select({
      id: historyTable.entityId,
      before: historyTable.beforeJson,
      after: historyTable.afterJson,
    })
    .from(historyTable)
    .where(eq(historyTable.entity, "document"));
  for (const h of rows) {
    for (const json of [h.before, h.after]) {
      if (!json) continue;
      const sha = (JSON.parse(json) as { sha256?: unknown }).sha256;
      if (typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha) && sha !== current.get(h.id)) {
        versions.add(sha);
      }
    }
  }
  const trash = new Set(
    docs.filter((d) => d.deletedAt !== null && !versions.has(d.sha256)).map((d) => d.sha256),
  );
  // A live document's bytes are in the tree already; only an old version shared with one is kept.
  for (const s of trash) if (live.has(s)) trash.delete(s);
  return { versions: [...versions].sort(), trash: [...trash].sort() };
};

/** Builds `fiscode.json` from sqlite and the store (missing = referenced but not on this device). */
export const buildManifest = async (store: VaultStore): Promise<VaultManifest> => {
  const docs = await getDb().select().from(document);
  const documents: [string, VaultManifest["documents"][string]][] = [];
  for (const d of docs) {
    if (d.deletedAt !== null || !d.vaultPath) continue;
    documents.push([d.id, { path: d.vaultPath, sha256: d.sha256, sizeBytes: d.sizeBytes }]);
  }
  const { versions, trash } = await referencedOldShas();
  const blobs: [string, VaultManifest["blobs"][string]][] = [];
  const missing: string[] = [];
  for (const sha of [...new Set([...versions, ...trash])].sort()) {
    const old = await store.resolveOldBytes(sha);
    if (old) blobs.push([sha, { path: old.path, sizeBytes: old.bytes.size }]);
    else missing.push(sha);
  }
  return {
    format: "fiscode-vault",
    formatVersion: 1,
    writtenAt: new Date().toISOString(),
    documents: sortedObject(documents),
    blobs: sortedObject(blobs),
    missing,
  };
};

export const writeManifest = async (store: VaultStore): Promise<VaultManifest> => {
  const manifest = await buildManifest(store);
  await store.write(
    MANIFEST_FILE,
    new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: "application/json" }),
  );
  return manifest;
};

/** Each document's place in the tree (document id → vault_path), for rows that have one. */
export const documentVaultPaths = async (): Promise<Map<string, string>> => {
  const rows = await getDb()
    .select({ id: document.id, vaultPath: document.vaultPath })
    .from(document);
  return new Map(rows.flatMap((r) => (r.vaultPath ? [[r.id, r.vaultPath] as const] : [])));
};
