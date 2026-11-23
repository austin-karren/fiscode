// The /documents URL: which list is open (a folder, Unfiled, Trash or a search) and which
// document's dialog. Pure, so the rules are tested without the router.

export type DocumentsSearch = {
  folder?: string;
  /** The documents with no folder. */
  unfiled?: boolean;
  doc?: string;
  trash?: boolean;
  q?: string;
};

const flag = (v: unknown) =>
  v === true || v === "1" || v === 1 || v === "true" ? true : undefined;

export const parseDocumentsSearch = (s: Record<string, unknown>): DocumentsSearch => ({
  folder: typeof s.folder === "string" ? s.folder : undefined,
  unfiled: flag(s.unfiled),
  doc: typeof s.doc === "string" ? s.doc : undefined,
  trash: flag(s.trash),
  q: typeof s.q === "string" && s.q ? s.q : undefined,
});

/** The folder whose list is open: none (null) for Unfiled, else the asked one or the year's. */
export const openFolderId = (
  search: DocumentsSearch,
  yearFolderId: string | undefined,
): string | null => (search.unfiled ? null : (search.folder ?? yearFolderId ?? null));

/** Where a link to a document goes: its folder's list, or Unfiled when it has none. */
export const documentLinkSearch = (doc: { id: string; folderId: string | null }): DocumentsSearch =>
  doc.folderId === null ? { unfiled: true, doc: doc.id } : { folder: doc.folderId, doc: doc.id };
