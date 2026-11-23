---
status: accepted (2026-11-23)
---

# Document vault: documents are real files in a readable tree; sqlite holds metadata

fiscode is to replace Google Drive as the home for tax documents. Today a document's bytes are
content-addressed blobs in OPFS with no human name, so nobody can browse them without the app.
We decide that **the vault is a folder tree a person can read** (`documents/<year>/<category>/<date> <title>.<ext>`)
**with a `fiscode.json` manifest**, that this same layout is what the app keeps, what an export
writes, what a backup zip contains, and what Nextcloud or Drive will later mirror 1:1. sqlite stays
the source of truth for metadata, links and history; the tree is the source of the bytes. The two
are kept in step by a journal and a reconcile scan.

This ADR is design only. Austin accepted it on 2026-11-23. The decisions taken are listed in § 14, and
the rest of the text follows them.

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
      Expenses/2026-03-04 Amazon NAS.pdf
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
  _fiscode/
    versions/<sha[0:2]>/<sha256>     old bytes, first saved by replace, revert or an outside edit
    trash/<sha[0:2]>/<sha256>        old bytes, first saved by a soft delete
                                     (a sha is in only one; read through resolveOldBytes, § 2)
```

OPFS only, never in the vault folder (device-local):
```
vault-journal.json                   pending tree operations (§ 6)
```

- `documents/` is the only part a person is meant to browse. Old versions and trash, which the app
  needs and a person doesn't, are under `_fiscode/`. The folder is **visible, not a dot-folder**:
  Nextcloud desktop skips hidden files by default ("Sync hidden files" is off) and Finder hides
  dot-folders, so a `.fiscode/` would silently fail to sync. The leading `_` sorts it out of the
  way. This keeps History and Trash working after a 1:1 mirror or restore.
- The **journal never lives in the vault**: it is in OPFS. Another device has its own sqlite, so
  recovering against a journal synced from a foreign device would be wrong.
- A soft-deleted document leaves the readable tree (it is in Trash in the app), so a person browsing
  Drive never sees deleted files mixed with live ones. Its bytes are kept under `_fiscode/` by the
  copy rule below (normally into `trash/`), then the live file is removed, so undo still works. Purging Trash is out of scope here; today blobs are never deleted and that stays.
- One file per live document, even when two documents share bytes (today's dedupe). The tree must
  read correctly without the app, so duplicates are real copies; `_fiscode/versions` and `trash`
  stay deduplicated by sha.
- **Old bytes: one lookup and one copy rule.** Every path that reads or writes old bytes uses these
  two and nothing else:
  - `resolveOldBytes(sha)`: look in `_fiscode/versions/`, then `_fiscode/trash/`. Every read from
    `_fiscode/` uses it.
  - **Copy rule:** copy a sha into `versions/` or `trash/` only if neither of them holds it already.
  So a sha lives in exactly one of them: wherever it was first written. The migration puts
  History-referenced shas in `versions/` and the rest in `trash/`. After that, the folder a sha is in
  says only which op saved it first, and no reader depends on it.
- **Bytes leave `_fiscode/` only by copy, never by move** (temp name, then rename into place).
  Two documents can share one sha there (D12), so moving it out for one would strip the other.
  A `_fiscode/` file is removed only when no row and no History entry references its sha, which
  today means never.
- The backup zip's contents become exactly `fiscode.json` + `documents/` + `_fiscode/versions` +
  `_fiscode/trash` + the CSV, so unzipping a backup *is* a vault (§ 9).

### Manifest `fiscode.json`

```jsonc
{
  "format": "fiscode-vault",
  "formatVersion": 1,
  "writtenAt": "2026-11-23T10:00:00Z",
  "app": { "csvSchema": "…", "build": "…" },
  "documents": {
    "<document id>": { "path": "documents/2026/Expenses/2026-03-04 Amazon NAS.pdf",
                       "sha256": "<64 hex>", "sizeBytes": 123456 }
  },
  "blobs": {                     // every other referenced byte file
    "<sha256>": { "path": "_fiscode/versions/ab/<sha256>", "sizeBytes": 999 }
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
vaultPath(doc, folders, takenPathsLowercase):
  { path: string; fits: boolean; overBy: number }   // name + collision rule below
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
   `C:\Users\<name>\Nextcloud\` stays inside Windows' 260 MAX_PATH. If the path is too long,
   `vaultPath` shortens **only the document title** (never the date prefix or the extension) and
   never renames a folder. The folder path's budget is enforced on folder **create, rename and move**.
   - **File reserve** = 30 characters: `/` (1) + date prefix `YYYY-MM-DD ` (11) + the shortest legal
     title, 8 characters (8) + ` (99)` (5) + the longest extension `.jpeg` (5).
   - A folder path fits if `path length + 30 ≤ 240`. A create checks the new folder. A rename or move
     checks the **deepest descendant folder** after the change (its new path + 30), so no file
     already below it can end up over budget. A failing user action is refused with
     `VaultPathTooLongError`.
   - **Restore, History revert and import never refuse.** When a restored or imported folder would
     not fit, folder names on its path are shortened in one bounded pass, from the top folder
     down, each cut at a grapheme boundary to no less than 1 grapheme (then the § 4 ` (n)` rule if the
     shorter name is taken). If it still does not fit after that pass, the result is `fits: false`. The item
     is kept where it is and reported, and nothing loops or refuses, and the result line reports it ("Restored *Long name…* as
     *Long na (2)*: the full name was too long for the vault").
   - `folderPathFits(newPath, deepestDescendantSuffix = ""): { fits, overBy }` in `packages/core`
     is the pure check the dialogs use before saving, so they can show "Name too long" (PR 1). The repo enforces it in PR 3. Decision D4.

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
  | `expenses`        | Expenses         | `Expenses` (D3)     |
  | `income`          | Income           | `Income`            |
  | `mileage`         | Mileage          | `Mileage`           |
  | `health-insurance`| Health insurance | `Health insurance`  |
  | `tax-forms`       | Tax forms        | `Tax forms`         |
  | `other`           | Other            | `Other`             |

  The folder on disk is the folder's current `name`, and D3 keeps "Expenses", so nothing is renamed.
- **User folders** are ordinary directories at their place in the tree, at any depth ≤ 8, inside
  a year or at the top level beside the years.
- `Unfiled` (`folder_id` null) is `documents/Unfiled/`. A user folder named "Unfiled" at the top
  level is renamed on disk to "Unfiled (2)" by the collision rule.
- **What can be renamed or moved** (d-ux constraint 6): user folders freely. Default category
  folders can be renamed (their key stays, so year defaults never recreate them) but not moved out
  of their year. Renaming a category affects **only that year**: each year has its own default
  folder rows, so renaming 2026's "Other" leaves 2025's alone (the confirm dialog says "Only 2026").
  New years still get the default names. A year folder cannot be renamed or moved: its name is the tax year and the
  layout's first level. Decision D5.

## 6. Rename and move: no orphans, no duplicates

A rename or move changes sqlite rows and one or many file paths. Neither store has a transaction
that spans both, so we use a **write-ahead journal**, kept in OPFS (§ 2).

Order of operations for any tree change (upload, rename, move, replace bytes, soft delete,
restore from Trash, and **a History revert** that changes a document's name, folder, bytes or
deleted state, or a folder's name or parent; a History revert of notes only is not a tree change):
1. Compute the plan in memory: a new `planId` (uuid), the new rows, and a list of file ops
   `{op: "copy" | "move" | "remove", from, to, sha256}`.
2. Write the plan to OPFS `vault-journal.json` (writables commit only on `close()`).
3. Do the file ops. Each op is idempotent: a move whose `to` already holds `sha256` and whose
   `from` is gone is done; a copy whose `to` holds `sha256` is done; a new file is written to a
   hidden temp name `.<name>.fiscode-tmp` in the same directory and then renamed into place, so a
   half-written file never has its final name (Nextcloud skips dot-files, so it does not upload
   the temp file).
4. Commit the sqlite rows, their History rows and `INSERT INTO vault_applied(plan_id)` in one
   `runAtomic` transaction.
5. Rewrite `fiscode.json`, delete the journal, then delete the `vault_applied` row.

Bytes that must survive for undo are recorded as their own ops. Each one cites the two § 2 rules:
the copy rule for writes and `resolveOldBytes` for reads.
- **Soft delete:** `copy live → trash/<sha>` under the copy rule, then `remove live`.
- **Replace bytes** and **a History revert to older bytes:** `copy live → versions/<current sha>`
  under the copy rule, then `copy resolveOldBytes(<old sha>) → <tmp>` (replace has no old sha:
  it writes the new upload to `<tmp>`), then rename over the live path.
- **Restore from Trash** and **a History revert of a soft delete:** `copy resolveOldBytes(<sha>) →
  <tmp>`, then rename into the path.

Rollback reverses the ops, and every `remove` it undoes has its bytes in `_fiscode/` from an
earlier op of the same plan, found with `resolveOldBytes`.

Crash safety: on boot (and before any new tree change) a journal that is present is **rolled
forward** if a `vault_applied` row with its `planId` exists, and **rolled back** (ops reversed in
reverse order) if not. The check is exact. It does not rely on `updatedAt`, which a later write or
a clock step can change. The `vault_applied` table is created in PR 3's migration. Either way
the tree and sqlite agree before anything else runs, and no file exists twice or nowhere. A crash
before the commit of an upload leaves only a `.*.fiscode-tmp` file, which the scan deletes.

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
| Row's path holds a different sha                           | an outside edit: keep the new bytes as a new version (old bytes to `versions/` under the § 2 copy rule, so skipped when either folder holds them), History records it |
| File with no row                                           | listed as "New in folder": one click to import it as a document in that folder |
| `.*.fiscode-tmp`                                           | deleted (leftover of a crashed write)          |
| A sync conflict copy: Nextcloud `* (conflicted copy *)`; Drive `<stem> (1).<ext>` **only when** `<stem>.<ext>` exists beside it and has a row | listed as a conflict, never imported silently. A lone `Invoice (1).pdf` is an ordinary "New in folder" file |

**Two devices, one synced folder** is out of scope for phase 1: one device writes the vault. A
second device's scan would list the first device's uploads as "New in folder", and it imports
nothing unless the user clicks. Multi-device sync is the phase 2 ADR (§ 12).

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
- **sqlite never moves to the picked folder** (Austin, 2026-11-23). `fiscode.sqlite` always stays
  in OPFS (§ 8). The picked folder holds what Austin opens outside the app: `documents/`,
  `exports/` and `backups/`, plus `fiscode.json` and `_fiscode/`, which the app needs to keep
  them consistent.
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
  `formatVersion: 2`), live files use the § 3 names, `.versions` is replaced by `_fiscode/`,
  written exactly as the store holds it (`versions/` and `trash/`, § 2). The bytes of a
  soft-deleted document or an old version are read with `resolveOldBytes(sha)`, in export and
  backup alike. Readers keep accepting format 1.
- **Restore** is 1:1: every file in the zip or folder is checked against `fiscode.json` (size and
  sha256) before anything is written, as `readBackup` does now; then rows are imported and each
  file is written to its manifest path. A test restores a vault into an empty store and asserts the
  same set of `(path, sha256)` pairs.

## 10. Migration from the current storage

A one-off, resumable job (d-data, needs a migration slot). **Entry point:** it starts on its own
at the first boot after the schema migration, with no click needed, and shows a progress banner. While it runs the
app stays usable. Every screen without documents (income, expenses, mileage, year-end) works
normally. The Documents screen and the attach and upload dialogs are **read-only**: preview works from the old
store, and upload, rename, move, delete and replace are disabled with "Moving your files into the vault…".
Backup and restore wait until it is done. Steps:

1. Schema: `document.vault_path text` (the current relative path, unique among live rows,
   case-folded index) and optionally `document.title` if D2 separates title from name. Generated
   with `bun run db:generate`.
   Also the `vault_applied(plan_id text primary key)` table (§ 6).
2. For each live document (sorted by `added_at, id` so collision suffixes are stable): compute its
   path, copy `documents/blobs/<sha>` to `vault/<path>` via temp name, set `vault_path`. Then copy
   every other referenced blob into `_fiscode/` under the § 2 copy rule: History-referenced shas
   to `versions/`, the rest to `trash/`.
3. Write `fiscode.json`, verify every sha256, then mark the migration done in a `meta` row.
   **Paths already over budget:** a folder whose path fails the § 3.8 check gets the same fallback
   as restore (shortened with the collision rule), and a title that cannot fit is shortened by
   `vaultPath`. Neither ever stops the job. Each change is listed in the **migration report**
   ("3 folder names shortened to fit the vault"), shown in `/documents/check` (the scan report page) when the job finishes, not on a new page.
4. Keep `documents/blobs/` for one release as a fallback (D9), and delete it in the next release,
   only after this verification has passed.
5. The same PR puts every repo write through the vault journal (§ 15), so no document is
   written row-only after the job runs. As a backstop, every boot re-runs step 2 **only for live
   rows whose `vault_path` is null**. A row with a path whose file is missing or holds other bytes
   is left to the reconcile scan (§ 6), so the backstop never overwrites an outside edit or
   re-creates a file the user moved.

Progress is `{phase:"migrating", done, total}`. It is resumable: each document is done once its
`vault_path` is set and the file there has the right sha; a crash restarts at the first one not done.
Cancelling stops between documents and leaves both stores readable (the old store is still whole).

## 11. UI contract (d-ux)

1. **Permission state.** `vault.permission(): Promise<"opfs" | "granted" | "prompt" | "denied">`
   ("opfs" = no picked folder). `vault.reconnect()` calls `requestPermission` and must run in a
   click handler. When not granted, the banner shows "Reconnect to see your files" with one
   Reconnect button; reads come from the OPFS cache (bytes not in
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
   A focus scan that fires while a long op (rename/move, migration, export, restore) runs is
   **skipped**, not queued: the op ends with its own scan of what it touched, and the next focus
   scans again. The report is a **page** (`/documents/check`) reached from a badge on Documents
   ("3 to review"), not a dialog, because it can list hundreds of rows and is worked through over
   time. **Unknown** means a file under `documents/` with no row whose type is on the upload
   allow-list (PDF, PNG, JPEG, WebP, HEIC, GIF, text). Other files (a `.docx`, `.DS_Store`,
   `desktop.ini`, `Thumbs.db`) are ignored and never listed; `_fiscode/` is never scanned as
   documents.
5. **Names.** `vaultFileName` and `vaultPath` in `packages/core` (§ 3, § 4) are pure, so dialogs
   show the final path before save. `vaultPath` never throws for length: it returns
   `{ path, fits, overBy }` after the § 3 shortening, and `fits: false` (only when the title cannot be
   shortened enough, e.g. a folder path from before the folder check existed) lets the dialog show "Name too long"
   and disable Save. `VaultPathTooLongError` is thrown only by a write that ignored it. The user edits the title; date and extension are derived.
6. **Categories.** Defaults per year, renamable, not movable; year folders fixed; user folders
   free, depth ≤ 8 (§ 5).
7. **Errors.** All extend `DocumentError` with a displayable `message`: `VaultPermissionError`,
   `VaultNameTakenError` (path on disk is taken by a file not in sqlite; carries `path`),
   `StorageQuotaError` (exists), `VaultFileLockedError` (a write failed with
   `NoModificationAllowedError`/`InvalidStateError`, e.g. a sync client holds it), `VaultConflictError`
   (carries `path` and the conflict copy's `path`), `VaultIntegrityError` (sha256 mismatch on read
   or restore; carries `path`), `VaultPathTooLongError`, `VaultBusyError` (item 9).
8. **Preview.** `documentRepo.readBytes(id)` and `documentRepo.objectUrl(id)` keep their
   signatures and resolve through the `VaultStore`, so the sheet does not care whether bytes come
   from OPFS, the picked folder or the cache. A live document is read from its `vault_path`; a
   soft-deleted document or an old version is read with `resolveOldBytes(sha)` (§ 2).

9. **More than one tab.** Every tree change, scan, migration, export and restore runs under one
   Web Lock, `navigator.locks.request("fiscode-vault", …)` (all four engines). A rename in one
   tab therefore makes the others wait. A user action asks with `ifAvailable: true`: if it doesn't get
   the lock, it throws `VaultBusyError` ("Busy in another tab. Try again when it finishes."), and the UI shows that line
   on the action rather than freezing. Background work (focus scan, journal recovery at boot)
   waits for the lock instead. Journal recovery runs in whichever tab gets the lock first at
   boot. When one tab finishes a change, it posts to a `BroadcastChannel("fiscode-vault")` so other tabs
   refresh their loaders (`router.invalidate()`). sqlite writes are already single-writer through
   SQLocal, and the lock adds the file side.

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

## 14. Decisions taken (Austin, 2026-11-23)

Austin accepted every recommendation. The "Chosen" column is binding; the other options are kept for the record.

**Changed after acceptance (2026-11-23): trash and versions in a visible `_fiscode/`; the journal in OPFS.**
Reason: review r1 found that Nextcloud desktop skips hidden files by default, so a `.fiscode/`
folder would not sync and History and Trash would break after a mirror or restore. A journal synced
to another device would also be replayed against that device's different sqlite. No D-number
changes.

| #   | Decision | Options | Chosen |
|-----|----------|---------|----------------|
| D1  | Default vault backend | (a) OPFS by default, picked folder opt-in; (b) require a picked folder on Chromium | (a): works in every browser, no lost data if the permission lapses |
| D2  | Date prefix source | (a) linked record's date, else added date; (b) always added date; (c) a document date field the user sets | (a), plus later (c) when the PDF importer reads dates |
| D3  | Rename "Expenses" to "Receipts" | (a) yes for new years and migrate existing default folders; (b) keep "Expenses" | (b): matches the app's own nav words; the brief's "Receipts" was an example |
| D4  | Path length budget | (a) 240 chars total, 120 bytes per name; (b) no total limit | (a): Windows Nextcloud clients refuse longer paths |
| D5  | Year folders | (a) fixed; (b) renamable | (a) |
| D6  | A file moved outside the app | (a) adopt the new place into sqlite; (b) move it back; (c) ask each time | (c) in the scan report, with "adopt all" |
| D7  | With a picked folder, keep a full OPFS copy? | (a) cache only recently viewed; (b) full mirror | (a): OPFS holds sqlite plus a document cache; the picked folder holds `documents/`, `exports/` and `backups/`, and sqlite never moves there (Austin, 2026-11-23). Halves storage; the folder is the vault. **Trade-off:** while the permission is lapsed, every file not recently viewed shows "File not on this device" until you click Reconnect (the banner says "Reconnect to see your files"). With "Allow on every visit" in Chrome this is rare; (b) avoids it at double the storage |
| D8  | Write the latest CSV into `exports/` on every backup | yes / no | yes: makes the vault restorable without the app |
| D9  | After migration, keep `documents/blobs` one release | yes / no | yes, then delete in the next release |
| D10 | Writes while the folder isn't granted | (a) block with a message; (b) queue and replay | (a) |
| D11 | PDF preview | (a) browser viewer; (b) bundle pdf.js | (a) for now |
| D12 | Duplicate bytes in two documents | (a) a real copy per document; (b) one file, the other a row only | (a): the tree must read right without the app |

## 15. PR split

| # | Owner | PR | Depends on |
|---|-------|----|-----------|
| 1 | d-data | `vaultFileName`, `vaultPath` and `folderPathFits` pure functions + tests in `packages/core` (§ 3, § 4) | — |
| 2 | d-data | `VaultStore` interface, OPFS backend, journal and roll-forward/back, the `fiscode-vault` **Web Lock and `BroadcastChannel`**, `VaultBusyError` (§ 6, § 7, § 11.9); `BlobStore` callers move over. Until PR 3 the OPFS backend still reads and writes by sha (`documents/blobs`), since no `vault_path` exists yet; preview getter unchanged | 1 |
| 3 | d-data | **Migration and journaled writes, one PR** (needs a migration slot): `vault_path` column and `vault_applied` table via `db:generate`, the resumable blob→tree job with its every-boot backstop, verification (§ 10), **and** every repo tree op through the journal (upload, rename, move, replace, soft delete, restore, History revert; § 6). They ship together so no write lands row-only after the job has run | 2 |
| 4 | — | (folded into PR 3) | — |
| 5 | d-data | Backup format 2 and Export vault, 1:1 restore test (§ 9) | 3 |
| 6 | d-data | Reconcile scan + `ScanReport` (§ 6) | 3 |
| 7 | d-data | Picked-folder backend, permission state, cache (§ 7, § 11.1-2) | 6 |
| 8 | d-ux | Upload and rename dialogs show the final path; category rules in the tree (§ 11.5-6) | 1, 3 |
| 9 | d-ux | Migration banner and read-only Documents during it (§ 10); long-op progress, cancel and error lines (§ 11.3, 11.7); the migration report and the restore/import "shortened to fit" lines, shown in `/documents/check` | 3 (migration and journaled rename/move, which used to be PR 4); 11 (the `/documents/check` page) |
| 10 | d-ux | Vault settings: pick folder, reconnect banner, Firefox/Safari line (§ 11.1-2) | 7 |
| 11 | d-ux | Scan report page `/documents/check`: moved, missing, new, conflicts (§ 11.4) | 6 |
| 12 | d-ux | Export vault: button, folder choice (picker, or a zip download without one), progress and cancel; "Busy in another tab" line (§ 9, § 11.3, § 11.9) | 2 (lock), 5 |

PRs 1-3, 5 and 6 are useful alone (OPFS vault, better backups) before any picked folder exists.
