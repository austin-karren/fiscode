---
status: proposed
---

# Document vault: documents are real files in a readable tree; sqlite holds metadata

fiscode is to replace Google Drive as the home for tax documents. Today a document's bytes are
content-addressed blobs in OPFS with no human name, so nobody can browse them without the app.
We decide that **the vault is a folder tree a person can read** (`documents/<year>/<category>/<date> <title>.<ext>`)
**with a `fiscode.json` manifest**, that this same layout is what the app keeps, what an export
writes, what a backup zip contains, and what Nextcloud or Drive will later mirror 1:1. sqlite stays
the source of truth for metadata, links and history; the tree is the source of the bytes. The two
are kept in step by a journal and a reconcile scan.

This ADR is design only. Every "Decision needed" is listed in § 14; the recommended option is what
the rest of the text assumes.

## 1. Current state

- **Rows.** `document_folder` (tree by `parent_id`, `default_key` marks a year's default folders),
  `document` (`folder_id`, editable `name` with duplicates allowed, `mime`, `sha256`) and
  `document_link` (polymorphic link to a record): `packages/db/src/schema/documents.ts:9`, `:35`, `:58`.
  Folder names are unique among live siblings (repo), not unique per document.
- **Bytes.** OPFS at `documents/blobs/<sha[0:2]>/<sha256>`, no extension, written once, never
  deleted by an app action, so History can revert a row to old bytes: `packages/db/src/blob-store.ts:1-8`,
  `:36-76`. Not in sqlite and not in the CSV.
- **sqlite** itself is `fiscode.sqlite` in OPFS via SQLocal: `packages/db/src/client.ts:6`, `:21`.
- **Rules.** 25 MB limit, mime allow-list (PDF, PNG, JPEG, WebP, HEIC, GIF, text), folder depth 8,
  names ≤ 120 chars and no `/`, default year folders `Expenses, Income, Mileage, Health insurance,
  Tax forms, Other`, `freeFolderName` for " (2)": `packages/core/src/documents.ts:5`, `:8`, `:43-45`,
  `:48-68`, `:95-134`.
- **Upload** hashes, stores the blob once per sha, then inserts the row: `packages/db/src/repo/documents.ts:454-461`,
  `:474`; dedupe lines in `apps/web/src/lib/documents-upload.ts:20-31`.
- **Rename/move** of folders and documents are row updates only (nothing on disk moves, since
  blobs are by sha): `packages/db/src/repo/documents.ts:145`, `:153`, `:506`, `:511`. Soft delete of a
  tree and its undo: `:181`, `:206`. Trash restore: `apps/web/src/lib/documents-restore.ts:26-35`.
- **Preview** is an object URL from `documentRepo.objectUrl(id)` (`repo/documents.ts:556`) shown in an
  `<iframe>` for PDF and `<img>` for images, with a "File not on this device" state when the blob
  is missing: `apps/web/src/components/documents/document-sheet.tsx:76-82`, `:140-160`.
- **Backup** already writes a human tree. One deterministic zip, then age-encrypted:
  `manifest.json`, the full CSV, every live document at `documents/<folder path>/<name>`, every
  other referenced blob at `documents/.versions/<sha256>`; restore checks every sha256 before
  writing: `packages/backup/src/index.ts:27-66`, `:78`. Names are made safe by `safeSegment`
  (control chars, `\ /`, Windows reserved chars, trailing dots/spaces, device names) and clashes get
  " (2)" ignoring case: `:228-286`. Restore puts blobs back into the store, then imports the bundle:
  `:586-603`.

So: the backup zip is already 80% of the vault layout. The gap is that the live app keeps bytes
by hash, file names carry no date, there is no length limit for sync targets, and no live tree
exists outside a zip.

## 2. The vault layout

```
<vault>/
  fiscode.json                       manifest (below)
  documents/
    2026/
      Receipts/2026-03-04 Amazon NAS.pdf
      Income/2026-01-31 Acme 1099-NEC.pdf
      Mileage/…
      Health insurance/…
      Tax forms/…
      Other/…
      <user folder>/<user subfolder>/…
    Unfiled/…
  exports/
    fiscode-2026-11-23.csv
    accountant-summary-2026.pdf
  backups/
    fiscode-backup-2026-11-23.zip.age
  .fiscode/
    versions/<sha[0:2]>/<sha256>     older bytes History still references (no extension)
    trash/<sha[0:2]>/<sha256>        bytes of soft-deleted documents
    journal.json                     pending tree operations (§ 6)
```

- `documents/` is the only part a person is meant to browse. Everything the app needs but a person
  doesn't (old versions, trash, journal) is under the dot-folder `.fiscode/`, which Finder,
  Explorer, Nextcloud and Drive show but sort out of the way, and which sync carries like any file.
- A soft-deleted document leaves the readable tree (it is in Trash in the app), so a person browsing
  Drive never sees deleted files mixed with live ones. Its bytes move to `.fiscode/trash/` so undo
  still works. Purging Trash is out of scope here; today blobs are never deleted and that stays.
- One file per live document, even when two documents share bytes (today's dedupe). The tree must
  read correctly without the app, so duplicates are real copies; `.fiscode/versions` and `trash`
  stay deduplicated by sha.
- The backup zip's contents become exactly `fiscode.json` + `documents/` + `.fiscode/versions` +
  `.fiscode/trash` + the CSV, so unzipping a backup *is* a vault (§ 9).

### Manifest `fiscode.json`

```jsonc
{
  "format": "fiscode-vault",
  "formatVersion": 1,
  "writtenAt": "2026-11-23T10:00:00Z",
  "app": { "csvSchema": "…", "build": "…" },
  "documents": {
    "<document id>": { "path": "documents/2026/Receipts/2026-03-04 Amazon NAS.pdf",
                       "sha256": "<64 hex>", "sizeBytes": 123456 }
  },
  "blobs": {                     // every other referenced byte file
    "<sha256>": { "path": ".fiscode/versions/ab/<sha256>", "sizeBytes": 999 }
  },
  "missing": ["<sha256>"]        // referenced but not on this device (as the backup has today)
}
```

The manifest is a cache of what sqlite says, written after every tree change. It lets a vault be
verified and restored without the app's database, and lets a scan tell "renamed outside" from
"new file" by sha256. It holds no personal metadata beyond paths (paths are already visible in the
tree). Keys are sorted so the file diffs cleanly under sync.

## 3. File naming

One pure function in `packages/core` (d-ux constraint 5), used by upload, rename, move, export,
backup and the dialogs' preview of the final path:

```ts
vaultFileName(input: { date: string | null; title: string; ext: string }): string
vaultPath(doc, folders, takenPathsLowercase): string   // name + collision rule below
```

**Derivation.** `<YYYY-MM-DD> <title>.<ext>`.
- `date`: the date of the linked record (expense, income, mileage) when exactly one is linked,
  else the date the document was added. Decision D2.
- `title`: the document's editable `name` with its extension removed. The user edits the title;
  the date prefix and the extension are not edited by hand (the date follows the link; the
  extension follows the mime). The dialog shows the final file name live.
- `ext`: from the mime (`pdf`, `png`, `jpg`, …), lower case, so a file is never misnamed `.PDF.pdf`.
- A title that already begins with that same `YYYY-MM-DD ` is not prefixed twice.

**Sanitising** (strictest of Windows, macOS, Linux, Nextcloud, Google Drive), applied per segment
to folder and file names alike; this extends today's `safeSegment`:
1. Unicode NFC (macOS stores NFD; Nextcloud compares NFC; without this one name can sync as two).
2. Drop C0/C1 control characters and DEL.
3. Replace `< > : " / \ | ? *` with `_` (Windows; `/` and `\` everywhere). Nextcloud also refuses
   these on Windows clients, and `\` on all.
4. Collapse runs of whitespace to one space; trim; strip trailing dots and spaces (Windows).
5. Leading `.` becomes `_` (a dot file is hidden and Nextcloud's default rules skip some, e.g.
   `.htaccess`, `.part`); names ending in `.part`, `.filepart` or `~` get `_` appended (Nextcloud
   and Office temp patterns that sync clients skip).
6. Windows device names (`CON, PRN, AUX, NUL, COM1-9, LPT1-9`, superscript digits, `CONIN$, CONOUT$`),
   with or without extension, get a `_` prefix.
7. Empty after all this: `_`.
8. **Length**: a segment ≤ 120 UTF-8 bytes (ext included), cut at a grapheme boundary before the
   extension; the whole path from the vault root ≤ 240 characters, so a vault under a typical
   `C:\Users\<name>\Nextcloud\` stays inside Windows' 260 MAX_PATH. If the path is too long, the
   title is shortened first, then the deepest user folder names. Decision D4.

Google Drive allows almost anything (including `/` in names via its API); these rules are a strict
subset of what it accepts, so a Drive mirror needs no further rewriting.

## 4. Collisions

- Uniqueness is **case-insensitive and NFC-normalised** per directory (macOS and Windows file
  systems, and Nextcloud on them, are case-insensitive).
- A clash with a file or a folder name gets ` (2)`, ` (3)`… before the extension:
  `2026-03-04 Amazon NAS (2).pdf`, the same rule as today's `numbered` and `freeFolderName`.
- The suffix is applied after length truncation, and truncation leaves room for it.
- Order is stable: the earlier-added document keeps the plain name, so a rename elsewhere never
  shuffles which file is "(2)". Suffixes are not renumbered when a gap opens.
- Folder names stay unique among siblings, as today (`FolderNameTakenError` at create/rename;
  ` (2)` only on restore or import). Document titles may repeat; the path gets the suffix.

## 5. Categories

- A year is a top-level folder under `documents/`: `documents/<year>/`. Its default children are
  the categories. Today's keys map as:

  | default_key       | today's name     | vault folder        |
  |-------------------|------------------|---------------------|
  | `year-root`       | `<year>`         | `documents/<year>/` |
  | `expenses`        | Expenses         | `Receipts` (D3)     |
  | `income`          | Income           | `Income`            |
  | `mileage`         | Mileage          | `Mileage`           |
  | `health-insurance`| Health insurance | `Health insurance`  |
  | `tax-forms`       | Tax forms        | `Tax forms`         |
  | `other`           | Other            | `Other`             |

  The folder on disk is the folder's current `name`, so if D3 keeps "Expenses" nothing renames.
- **User folders** are ordinary directories at their place in the tree, at any depth ≤ 8, inside
  a year or at the top level beside the years.
- `Unfiled` (`folder_id` null) is `documents/Unfiled/`. A user folder named "Unfiled" at the top
  level is renamed on disk to "Unfiled (2)" by the collision rule.
- **What can be renamed or moved** (d-ux constraint 6): user folders freely. Default category
  folders can be renamed (their key stays, so year defaults never recreate them) but not moved out
  of their year. A year folder cannot be renamed or moved: its name is the tax year and the
  layout's first level. Decision D5.

## 6. Rename and move: no orphans, no duplicates

A rename or move changes sqlite rows and one or many file paths. Neither store has a transaction
that spans both, so we use a **write-ahead journal** in the vault.

Order of operations for any tree change (upload, rename, move, replace bytes, soft delete,
restore):
1. Compute the plan in memory: the new rows and a list of file ops `{from, to, sha256}`.
2. Write the plan to `.fiscode/journal.json` (write to `journal.json.tmp`, then move over; OPFS
   and FSA writables already commit only on `close()`).
3. Do the file ops. Each op is idempotent: a move whose `to` already holds `sha256` and whose
   `from` is gone is done; a new file is written to `<to>.fiscode-tmp` and then moved into place,
   so a half-written file never has its final name.
4. Commit the sqlite rows and their History rows in one `runAtomic` transaction (as the tree
   operations do today).
5. Rewrite `fiscode.json`, then delete the journal.

Crash safety: on boot (and before any new tree change) a journal that is present is **rolled
forward** if the sqlite rows show step 4 committed (the plan carries the new `updatedAt`), and
**rolled back** (ops reversed in reverse order) if not. Either way the tree and sqlite agree
before anything else runs, and no file exists twice or nowhere. Upload is the simple case: bytes
land first under a temp name, so a crash before the commit leaves only a `*.fiscode-tmp` that the
scan deletes.

Folder rename/move on disk moves each file into the new directory and then removes the old
empty directories; we do not rely on a directory `move()` because the File System Access API's
directory move is not supported everywhere. Large folders report progress (§ 11.3).

**When sqlite and the tree disagree** (after an outside change, a sync, or a restored backup),
sqlite wins for metadata and the tree wins for bytes, through a **reconcile scan** that walks
`documents/` and compares to sqlite by path and sha256:

| Found                                                      | Action                                         |
|------------------------------------------------------------|------------------------------------------------|
| Row's path holds the right sha                             | ok                                             |
| Row's path missing, same sha found elsewhere in `documents/` | treat as an outside move: offer to adopt the new folder/name (D6) or move it back |
| Row's path missing, sha nowhere                            | row shows "File not on this device" (existing state) |
| Row's path holds a different sha                           | an outside edit: keep the new bytes as a new version (old bytes to `.fiscode/versions`), History records it |
| File with no row                                           | listed as "New in folder": one click to import it as a document in that folder |
| `*.fiscode-tmp`, or a sync conflict copy (`* (conflicted copy *)`, `* (1).pdf` of Drive) | conflict files listed, never imported silently |

## 7. How the browser holds a real tree

Two backends behind one interface (replacing `BlobStore` with a `VaultStore`):

- **OPFS** (`navigator.storage.getDirectory()`), the default everywhere. Real directories and
  files in the origin-private file system, laid out exactly as § 2 under `vault/`. Supported in
  current Chrome, Edge, Firefox and Safari (desktop and iOS). Not visible to the user or to a
  sync client; it survives until site data is cleared, so `navigator.storage.persist()` is
  requested once.
- **A user-picked folder** (`showDirectoryPicker({ mode: "readwrite" })`, File System Access API),
  opt-in. This is the folder Nextcloud desktop or Drive for desktop syncs. Chromium desktop only
  (Chrome, Edge, Brave, Opera); not Firefox, not Safari, not any mobile browser. The handle is kept
  in IndexedDB. Permission: on each visit `queryPermission({mode:"readwrite"})` returns `granted`,
  `prompt` or `denied`; `requestPermission` needs a user gesture. Chrome 122+ offers "Allow on every
  visit", which makes `granted` stick; otherwise the user re-grants with one click per session.
- When a folder is picked, the vault lives there and OPFS keeps a read cache of recently viewed
  files only (D7). Without a folder, OPFS is the vault and the user gets the tree out through
  export and backup.

Browser support is to be re-checked when the build starts; nothing here depends on an API that
only one engine has, except the optional picked folder.

## 8. Where sqlite lives

`fiscode.sqlite` stays in OPFS: SQLocal needs OPFS sync access handles, which a user-picked folder
cannot give, and a live sqlite file inside a synced folder corrupts under sync. The vault therefore
holds no live database. What makes a vault self-describing without the app is `fiscode.json` plus
the latest CSV in `exports/` (written on every export and backup, D8). A vault opened on a new
device with a fresh database is restored by importing that CSV and adopting the files by sha256.

## 9. Export and backup write the same layout; 1:1 restore

- **Export vault** writes the § 2 tree (without `backups/`) to the picked folder, or as a plain
  zip where there is no picker.
- **Backup** stays as it is: one deterministic zip, age-encrypted, `fiscode-backup-<date>.zip.age`.
  Only the paths inside change: `manifest.json` becomes `fiscode.json` (format bumps to
  `formatVersion: 2`), live files use the § 3 names, `.versions` moves to `.fiscode/versions`,
  soft-deleted bytes go to `.fiscode/trash`. Readers keep accepting format 1.
- **Restore** is 1:1: every file in the zip or folder is checked against `fiscode.json` (size and
  sha256) before anything is written, as `readBackup` does now; then rows are imported and each
  file is written to its manifest path. A test restores a vault into an empty store and asserts the
  same set of `(path, sha256)` pairs.

## 10. Migration from the current storage

A one-off, resumable job on boot after the schema migration (d-data, needs a migration slot):

1. Schema: `document.vault_path text` (the current relative path, unique among live rows,
   case-folded index) and optionally `document.title` if D2 separates title from name. Generated
   with `bun run db:generate`.
2. For each live document (sorted by `added_at, id` so collision suffixes are stable): compute its
   path, copy `documents/blobs/<sha>` to `vault/<path>` via temp name, set `vault_path`. Then copy
   every other referenced blob to `.fiscode/versions` or `.fiscode/trash`.
3. Write `fiscode.json`, verify every sha256, then mark the migration done in a `meta` row.
4. Only after verification: delete `documents/blobs/` (D9: or keep it one release as a fallback).

Progress is `{phase:"migrating", done, total}`. It is resumable: each document is done once its
`vault_path` is set and the file there has the right sha; a crash restarts at the first one not done.
Cancelling stops between documents and leaves both stores readable (the old store is still whole).

## 11. UI contract (d-ux)

1. **Permission state.** `vault.permission(): Promise<"opfs" | "granted" | "prompt" | "denied">`
   ("opfs" = no picked folder). `vault.reconnect()` calls `requestPermission` and must run in a
   click handler. When not granted, the banner shows; reads come from the OPFS cache (bytes not in
   the cache show "File not on this device"). **Writes are blocked** with `VaultPermissionError`
   ("Reconnect your vault folder to save changes."), not queued: a queue would let sqlite and the
   folder drift while sync runs. Decision D10.
2. **Without File System Access** (Firefox, Safari, all mobile): `vault.canPickFolder(): boolean`
   (feature test of `showDirectoryPicker`). False hides the picker and shows one line: "Your files
   are kept in this browser. Use Export vault or Backup to get them out." OPFS is the vault.
3. **Long operations.** Folder rename/move, migration, export, restore and a re-scan take
   `onProgress({phase, done, total})` and an `AbortSignal`, like the backup. Rename/move is
   journaled (§ 6): cancel or failure rolls back, so the state is "nothing changed" and the error
   says so. Migration and export are resumable and cancel between files: the state left is "N of
   M done, old storage still complete". A scan changes nothing on its own; it returns a report.
4. **Outside changes.** `vault.scan(): Promise<ScanReport>` runs on boot, on window focus (debounced)
   and from a "Check folder" button. Report: `moved[]` (adopt or put back), `missing[]` (row shows the
   existing "File not on this device"), `changed[]` (new version recorded), `unknown[]` ("New in
   folder", one-click import), `conflicts[]` (path shown, user resolves). No silent deletes ever.
5. **Names.** `vaultFileName` and `vaultPath` in `packages/core` (§ 3, § 4) are pure, so dialogs
   show the final path before save. The user edits the title; date and extension are derived.
6. **Categories.** Defaults per year, renamable, not movable; year folders fixed; user folders
   free, depth ≤ 8 (§ 5).
7. **Errors.** All extend `DocumentError` with a displayable `message`: `VaultPermissionError`,
   `VaultNameTakenError` (path on disk is taken by a file not in sqlite; carries `path`),
   `StorageQuotaError` (exists), `VaultFileLockedError` (a write failed with
   `NoModificationAllowedError`/`InvalidStateError`, e.g. a sync client holds it), `VaultConflictError`
   (carries `path` and the conflict copy's `path`), `VaultIntegrityError` (sha256 mismatch on read
   or restore; carries `path`), `VaultPathTooLongError`.
8. **Preview.** `documentRepo.readBytes(id)` and `documentRepo.objectUrl(id)` keep their
   signatures and resolve through the `VaultStore`, so the sheet does not care whether bytes come
   from OPFS, the picked folder or the cache.

## 12. What Nextcloud and Drive sync later needs

- Phase 1 (this ADR): the picked folder is synced by the desktop client; fiscode just keeps a
  correct tree and reconciles. Nothing server-side.
- Phase 2 (later ADR): direct sync from the browser. Nextcloud via WebDAV (`PROPFIND`, `PUT`, `MOVE`
  with app password; CORS needs a server setting or a proxy) and Drive via the Drive API (OAuth,
  `drive.file` scope, folder ids). Both need: a stable id per file (Drive file id, Nextcloud
  `oc:fileid`) stored next to `vault_path`, the manifest's sha256 to skip unchanged files (Nextcloud
  can report `oc:checksums`; Drive gives `sha256Checksum`), the § 3 rules so no name is refused, and
  the § 6 journal applied to remote ops. The encrypted backups in `backups/` sync as opaque files.
- Never sync `fiscode.sqlite` (§ 8).

## 13. Preview of PDF, PNG and JPEG

Unchanged in approach: an object URL from the store, `<iframe>` for PDF (the browser's own viewer,
works in all four engines on desktop; on iOS Safari it shows page 1 inline and a full view on tap),
`<img>` for PNG and JPEG. HEIC keeps its fallback. pdf.js is not added now; revisit if mobile PDF
preview is not good enough (D11). The bytes are verified against sha256 on first read from the
picked folder, since sync may have changed them (§ 6).

## 14. Decisions needed from Austin

| #   | Decision | Options | Recommendation |
|-----|----------|---------|----------------|
| D1  | Default vault backend | (a) OPFS by default, picked folder opt-in; (b) require a picked folder on Chromium | (a): works in every browser, no lost data if the permission lapses |
| D2  | Date prefix source | (a) linked record's date, else added date; (b) always added date; (c) a document date field the user sets | (a), plus later (c) when the PDF importer reads dates |
| D3  | Rename "Expenses" to "Receipts" | (a) yes for new years and migrate existing default folders; (b) keep "Expenses" | (b): matches the app's own nav words; the brief's "Receipts" was an example |
| D4  | Path length budget | (a) 240 chars total, 120 bytes per name; (b) no total limit | (a): Windows Nextcloud clients refuse longer paths |
| D5  | Year folders | (a) fixed; (b) renamable | (a) |
| D6  | A file moved outside the app | (a) adopt the new place into sqlite; (b) move it back; (c) ask each time | (c) in the scan report, with "adopt all" |
| D7  | With a picked folder, keep a full OPFS copy? | (a) cache only recently viewed; (b) full mirror | (a): halves storage; the folder is the vault |
| D8  | Write the latest CSV into `exports/` on every backup | yes / no | yes: makes the vault restorable without the app |
| D9  | After migration, keep `documents/blobs` one release | yes / no | yes, then delete in the next release |
| D10 | Writes while the folder isn't granted | (a) block with a message; (b) queue and replay | (a) |
| D11 | PDF preview | (a) browser viewer; (b) bundle pdf.js | (a) for now |
| D12 | Duplicate bytes in two documents | (a) a real copy per document; (b) one file, the other a row only | (a): the tree must read right without the app |

## 15. PR split

| # | Owner | PR | Depends on |
|---|-------|----|-----------|
| 1 | d-data | `vaultFileName`/`vaultPath` pure functions + tests in `packages/core` (§ 3, § 4) | — |
| 2 | d-data | `VaultStore` interface, OPFS backend, journal and roll-forward/back (§ 6, § 7); `BlobStore` callers move over; preview getter unchanged | 1 |
| 3 | d-data | **Migration** (needs a migration slot): `vault_path` column via `db:generate`, the resumable blob→tree job, verification (§ 10) | 2 |
| 4 | d-data | Repo tree ops write through the journal (upload, rename, move, replace, delete, restore) | 3 |
| 5 | d-data | Backup format 2 and Export vault, 1:1 restore test (§ 9) | 4 |
| 6 | d-data | Reconcile scan + `ScanReport` (§ 6) | 4 |
| 7 | d-data | Picked-folder backend, permission state, cache (§ 7, § 11.1-2) | 6 |
| 8 | d-ux | Upload and rename dialogs show the final path; category rules in the tree (§ 11.5-6) | 1, 4 |
| 9 | d-ux | Migration and long-op progress, cancel and error lines (§ 11.3, 11.7) | 3 |
| 10 | d-ux | Vault settings: pick folder, reconnect banner, Firefox/Safari line (§ 11.1-2) | 7 |
| 11 | d-ux | Scan report UI: moved, missing, new, conflicts (§ 11.4) | 6 |

PRs 1-6 are useful alone (OPFS vault, better backups) before any picked folder exists.
