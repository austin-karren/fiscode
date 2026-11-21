import type { FolderNode, FolderRow } from "./documents-stub";

// Display helpers for the Documents screen: sizes, file kinds, and folder paths.

/** "12 KB", "3.4 MB": a file size for a list. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const KINDS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG image",
  "image/jpeg": "JPEG image",
  "image/webp": "WebP image",
  "image/heic": "HEIC image",
  "image/gif": "GIF image",
  "text/plain": "Text",
};
/** The file kind in words, never the stored MIME type. */
export const fileKind = (mime: string): string => KINDS[mime] ?? "File";

/** Every folder in tree order with its depth, for pickers and the keyboard tree. */
export const flattenTree = (
  nodes: FolderNode[],
  depth = 0,
): { folder: FolderRow; depth: number; documentCount: number; hasChildren: boolean }[] =>
  nodes.flatMap((n) => [
    { folder: n.folder, depth, documentCount: n.documentCount, hasChildren: n.children.length > 0 },
    ...flattenTree(n.children, depth + 1),
  ]);

/** "2026 / Expenses": where a folder sits. */
export const folderPath = (folders: FolderRow[], id: string | null): string => {
  const names: string[] = [];
  for (let at = id; at;) {
    const f = folders.find((x) => x.id === at);
    if (!f) break;
    names.unshift(f.name);
    at = f.parentId;
  }
  return names.length ? names.join(" / ") : "Unfiled";
};

/** The ids of a folder and everything under it: a folder can't move into these. */
export const subtreeOf = (folders: FolderRow[], id: string): Set<string> => {
  const ids = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
};

/** One short line for a typed error from the repos: its own message, never a stack. */
export const errorLine = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "That didn't work. Try again.";
