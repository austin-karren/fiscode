import {
  documentMimeFor,
  folderPathFits,
  freeFolderName,
  shortenFolderNames,
  sameName,
  VAULT_DOCUMENTS_DIR,
  VAULT_UNFILED_DIR,
  vaultFolderName,
  vaultFileName,
  vaultPath,
  type VaultPathResult,
} from "@fiscode/core";

// Where rows go in the vault tree (ADR 0001 § 2-5), as pure functions over rows. The repo, the
// migration and the boot backstop all compute paths here, so they never disagree.

type FolderLike = {
  deletedAt?: string | null;
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
};

type DocLike = {
  id: string;
  folderId: string | null;
  name: string;
  mime: string;
  addedAt: string;
};

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "text/plain": "txt",
};

/** The file extension for a stored mime (§ 3: from the mime, lower case). */
export const extForMime = (mime: string): string => EXT_BY_MIME[mime] ?? "bin";

const byCreated = (a: FolderLike, b: FolderLike) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;

/**
 * Each live folder's name on disk: `vaultFolderName(name)`, and " (2)" when sanitising makes two
 * siblings' names the same ("a:b" and "a_b") or a top-level folder is called "Unfiled" (§ 4, § 5).
 * The earlier-made folder keeps the plain name, so the order is stable.
 */
export const folderDiskNames = (folders: readonly FolderLike[]): Map<string, string> => {
  const out = new Map<string, string>();
  const byParent = new Map<string | null, FolderLike[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), f]);
  }
  for (const [parent, siblings] of byParent) {
    const taken: string[] = parent === null ? [VAULT_UNFILED_DIR] : [];
    for (const f of siblings.toSorted(byCreated)) {
      const name = freeFolderName(vaultFolderName(f.name), taken);
      taken.push(name);
      out.set(f.id, name);
    }
  }
  return out;
};

/** A folder's disk names from the top down, or undefined when it (or a parent) isn't live. */
export const folderSegments = (
  id: string,
  folders: ReadonlyMap<string, FolderLike>,
  disk: ReadonlyMap<string, string>,
): string[] | undefined => {
  const out: string[] = [];
  for (let at: string | null = id; at !== null;) {
    const f = folders.get(at);
    const name = disk.get(at);
    if (!f || name === undefined || out.length > 64) return undefined;
    out.unshift(name);
    at = f.parentId ?? null;
  }
  return out;
};

/** "documents/2026/Expenses": a folder's directory from the vault root. */
export const folderDir = (segments: readonly string[] | null) =>
  [VAULT_DOCUMENTS_DIR, ...(segments ?? [VAULT_UNFILED_DIR])].join("/");

/** The date prefix (D2): the one linked record's date, else the date the document was added. */
export const documentDate = (addedAt: string, linkedDates: readonly string[]): string => {
  const dated = linkedDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return dated.length === 1 && linkedDates.length === 1 ? dated[0]! : addedAt.slice(0, 10);
};

/**
 * The title for § 3: the name with its extension removed when that extension means the same mime
 * ("IMG_1.JPEG" for a jpeg is "IMG_1", so the file is never "IMG_1.JPEG.jpg").
 */
const titleOf = (name: string, mime: string) => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name;
  return documentMimeFor(name, "") === mime ? name.slice(0, dot) : name;
};

export type PathContext = {
  folders: ReadonlyMap<string, FolderLike>;
  disk: ReadonlyMap<string, string>;
};

export const pathContext = (liveFolders: readonly FolderLike[]): PathContext => ({
  folders: new Map(liveFolders.map((f) => [f.id, f])),
  disk: folderDiskNames(liveFolders),
});

/**
 * Where a document goes (§ 3, § 4): its folder's directory plus `vaultPath`'s name, " (n)" when a
 * path in `taken` has it. A document whose folder isn't live goes to Unfiled.
 */
export const documentVaultPath = (
  doc: DocLike,
  ctx: PathContext,
  linkedDates: readonly string[],
  taken: Iterable<string>,
): VaultPathResult => {
  const segments =
    doc.folderId === null ? null : folderSegments(doc.folderId, ctx.folders, ctx.disk);
  return vaultPath(
    {
      date: documentDate(doc.addedAt, linkedDates),
      title: titleOf(doc.name, doc.mime),
      ext: extForMime(doc.mime),
      folders: segments ?? null,
    },
    taken,
  );
};

/** Whether `path` is in `taken` by the § 4 rule (case- and accent-insensitive). */
export const pathTaken = (path: string, taken: Iterable<string>) => {
  for (const t of taken) if (sameName(t, path)) return true;
  return false;
};

/** A folder name the never-refuse fallback shortened (§ 3.8), for the result line or report. */
export type ShortenedFolder = { folderId: string; from: string; to: string };

/**
 * The never-refuse fallback (§ 3.8): shorten the names on each over-budget path, top down, then
 * " (n)" when the shorter name is taken. Mutates `folders`; returns what it changed.
 */
export const fitFolders = <F extends FolderLike>(
  folders: Map<string, F>,
  ids: Iterable<string>,
): ShortenedFolder[] => {
  const out: ShortenedFolder[] = [];
  for (const id of ids) {
    const live = [...folders.values()].filter((f) => f.deletedAt === null);
    const ctx = pathContext(live);
    const segments = folderSegments(id, ctx.folders, ctx.disk);
    if (!segments || folderPathFits(folderDir(segments)).fits) continue;
    const { names } = shortenFolderNames(segments);
    // Walk up from `id` to name each level's row.
    const chain: string[] = [];
    for (let at: string | null = id; at !== null; at = folders.get(at)?.parentId ?? null) {
      chain.unshift(at);
    }
    chain.forEach((fid, i) => {
      if (names[i] === segments[i]) return;
      const f = folders.get(fid)!;
      const siblings = live
        .filter((s) => s.id !== fid && (s.parentId ?? null) === (f.parentId ?? null))
        .map((s) => s.name);
      const to = freeFolderName(names[i]!, siblings);
      out.push({ folderId: fid, from: f.name, to });
      folders.set(fid, { ...f, name: to });
    });
  }
  return out;
};

/** The file name a document would get with no length or collision limits (for the report). */
export const documentFileName = (doc: DocLike, linkedDates: readonly string[]): string =>
  vaultFileName({
    date: documentDate(doc.addedAt, linkedDates),
    title: titleOf(doc.name, doc.mime),
    ext: extForMime(doc.mime),
  });
