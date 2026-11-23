import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Document folders, documents and their links to records (contract: d-data
// drafts/contract-documents.md). Bytes never live here: a document's bytes are a
// file in the vault tree at `vault_path` (vault/store.ts); before the migration, a
// content-addressed blob at documents/blobs/<sha[0:2]>/<sha256>.

/** A folder. `parentId` null = a root folder. Names are unique among live siblings (repo). */
export const documentFolder = sqliteTable(
  "document_folder",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    // Set on a year's default folders and their children; a filter only.
    taxYear: integer("tax_year"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Which of a year's default folders this is ('year-root', 'expenses', ...), or null for a
    // folder the user made. ensureYearDefaults never makes a key twice for a year (review #84 r1).
    defaultKey: text("default_key"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // One folder per default key per year, ever (deleted rows included: a deleted default is never
  // made again). Stops two tabs from each making a year's set (review #84 r3).
  (t) => [
    uniqueIndex("document_folder_default_key_idx")
      .on(t.taxYear, t.defaultKey)
      .where(sql`${t.defaultKey} IS NOT NULL`),
  ],
);

/** A document: one file's current bytes (by sha256) and how it is shown. */
export const document = sqliteTable(
  "document",
  {
    id: text("id").primaryKey(),
    // Null = "Unfiled".
    folderId: text("folder_id"),
    // Display name including the extension; editable; duplicates allowed.
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Lowercase hex, 64 chars: the content address of the current bytes.
    sha256: text("sha256").notNull(),
    // When it was first uploaded.
    addedAt: text("added_at").notNull(),
    notes: text("notes"),
    // Where its bytes are in the vault tree ("documents/2026/Expenses/2026-03-04 Amazon NAS.pdf",
    // ADR 0001 § 2). Null until the migration (or the boot backstop) has put the file there.
    vaultPath: text("vault_path"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("document_folder_idx").on(t.folderId),
    index("document_sha_idx").on(t.sha256),
    // One live document per path, ignoring ASCII case (§ 4). The repo also folds Unicode case
    // (sameName); this is the backstop.
    uniqueIndex("document_vault_path_idx")
      .on(sql`lower(${t.vaultPath})`)
      .where(sql`${t.deletedAt} IS NULL AND ${t.vaultPath} IS NOT NULL`),
  ],
);

/** A link from a document to a record (polymorphic by CSV record-type name). Unlink = soft delete. */
export const documentLink = sqliteTable(
  "document_link",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    // 'expense' | 'income' | 'mileage' (open for later record types).
    recordType: text("record_type").notNull(),
    recordId: text("record_id").notNull(),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("document_link_doc_idx").on(t.documentId),
    index("document_link_rec_idx").on(t.recordType, t.recordId),
  ],
);

export type DocumentFolderRow = typeof documentFolder.$inferSelect;
export type DocumentFolderInsert = typeof documentFolder.$inferInsert;
export type DocumentRow = typeof document.$inferSelect;
export type DocumentInsert = typeof document.$inferInsert;
export type DocumentLinkRow = typeof documentLink.$inferSelect;
export type DocumentLinkInsert = typeof documentLink.$inferInsert;
