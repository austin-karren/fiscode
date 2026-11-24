// Vault names (ADR 0001 § 3-5, § 11.5): pure rules for the readable tree
// `documents/<year>/<category>/<YYYY-MM-DD> <title>.<ext>`. No I/O; the repos and the dialogs call these.

import { DocumentError, freeFolderName, sameName, YEAR_ROOT_KEY } from "./documents.ts";

/** The longest path from the vault root, in UTF-16 units (Windows MAX_PATH 260 less a typical root). D4. */
export const MAX_VAULT_PATH = 240;
/** The longest single file or folder name, in UTF-8 bytes, extension included. D4. */
export const MAX_VAULT_SEGMENT_BYTES = 120;
/** The browsable top of the vault. */
export const VAULT_DOCUMENTS_DIR = "documents";
/** Where documents with no folder live. */
export const VAULT_UNFILED_DIR = "Unfiled";

// Windows can't create these: the characters, and the device names (Microsoft's "Naming Files":
// CON, PRN, AUX, NUL, COM1-9 and LPT1-9 with superscript ¹²³ too, CONIN$, CONOUT$) with or
// without an extension.
const WINDOWS_RESERVED_CHARS = /[<>:"|?*]/g;
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(\.|$)/i;

/**
 * The backup zip's (format 1) path segment: control characters and slashes dropped, Windows'
 * reserved characters as "_", no trailing dots or spaces, and a device name prefixed with "_".
 * Frozen: backup output must stay byte-identical. New code uses `vaultSegment`.
 */
export const safeSegment = (name: string): string => {
  const cleaned = [...name]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch !== "/" && ch !== "\\")
    .join("")
    .replace(WINDOWS_RESERVED_CHARS, "_")
    .trim()
    .replace(/[. ]+$/, "");
  if (cleaned === "") return "_";
  return WINDOWS_DEVICE_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
};

// UTF-8 length without TextEncoder (core has no DOM or Node types).
const byteLength = (s: string): number => {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
};
const isControl = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return c < 0x20 || (c >= 0x7f && c <= 0x9f);
};
const graphemes = (s: string): string[] =>
  [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s)].map((g) => g.segment);

// Trim to `maxBytes` UTF-8 bytes without splitting a grapheme, then drop trailing dots and spaces.
const cutBytes = (s: string, maxBytes: number): string => {
  let out = "";
  let bytes = 0;
  for (const g of graphemes(s)) {
    const b = byteLength(g);
    if (bytes + b > maxBytes) break;
    out += g;
    bytes += b;
  }
  return out.replace(/[. ]+$/, "");
};

/**
 * One folder or file name safe on Windows, macOS, Linux, Nextcloud and Drive (ADR § 3 rules 1-7):
 * NFC, no control characters, reserved characters and slashes as "_", one space between words, no
 * leading dot, no trailing dot or space, no sync-temp ending, no device name, never empty.
 * Length is not applied here (see `vaultFileName` and `vaultFolderName`).
 */
export const vaultSegment = (raw: string): string => {
  let s = [...raw.normalize("NFC")]
    .filter((ch) => !isControl(ch))
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (s.startsWith(".")) s = `_${s.slice(1)}`;
  if (/(\.part|\.filepart|~)$/i.test(s)) s = `${s}_`;
  if (WINDOWS_DEVICE_NAME.test(s)) s = `_${s}`;
  return s === "" ? "_" : s;
};

/** A folder name as it goes on disk: `vaultSegment`, cut to 120 UTF-8 bytes. */
export const vaultFolderName = (name: string): string =>
  // Sanitise again after the cut, so it can't expose a trailing dot, space, ".part" or "~".
  vaultSegment(cutBytes(vaultSegment(name), MAX_VAULT_SEGMENT_BYTES - 1));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATED_TITLE = /^(\d{4})-(\d{2})-(\d{2})(?: |$)/;
// A tax-year label such as "2025 W-2". A space must follow: "2025" alone and "2025-budget" are
// not read as a year label, so they keep the prefix.
const YEAR_TITLE = /^(19\d{2}|2[01]\d{2}) /;
// Only a real calendar day counts: "2026-13-40" and "2026-02-30" are not dates.
const startsWithDate = (t: string): boolean => {
  if (YEAR_TITLE.test(t)) return true;
  const m = DATED_TITLE.exec(t);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
};
// The title without a trailing ".<ext>" (the extension as `vaultFileName` writes it).
const stripExt = (title: string, ext: string): { t: string; e: string } => {
  // Capped so a malformed extension can never crowd out the name.
  const e = vaultSegment(ext.toLowerCase().replace(/^\.+/, "")).replace(/\./g, "_").slice(0, 16);
  let t = title.normalize("NFC").trim();
  if (e !== "_" && t.toLowerCase().endsWith(`.${e}`)) t = t.slice(0, -(e.length + 1));
  return { t, e };
};
/**
 * Whether a title already starts with a valid date or a year (1900-2199) and a space, so its
 * file name gets no date prefix. Pass
 * the file's `ext` when the title may end in it ("2026-08-12.pdf" is a dated title).
 */
export const titleHasDate = (title: string, ext = ""): boolean =>
  startsWithDate(stripExt(title, ext).t);

export interface VaultFileNameInput {
  /** `YYYY-MM-DD`: the linked record's date, else the date added (D2). Null: no prefix. */
  date: string | null;
  /** The editable title; a trailing ".<ext>" matching `ext` is removed. */
  title: string;
  /** From the mime: "pdf", "png", "jpg"... Lower-cased. */
  ext: string;
}

// The parts of a file name: "<prefix><title><suffix>.<ext>", sanitised, title not yet cut.
const nameParts = ({ date, title, ext }: VaultFileNameInput) => {
  const { t, e } = stripExt(title, ext);
  // A title that already starts with a date or a year names the file as it is, even when that date isn't
  // the D2 date: prefixing it would give "2026-11-23 2026-08-12 ...".
  if (startsWithDate(t)) return { prefix: "", title: t, ext: e };
  const prefix = date !== null && ISO_DATE.test(date) ? `${date} ` : "";
  return { prefix, title: t, ext: e };
};

// Build the name with the title cut so the whole name fits `maxBytes`; undefined when even a
// one-grapheme title doesn't fit.
const buildName = (
  parts: ReturnType<typeof nameParts>,
  suffix: string,
  maxBytes: number,
  maxTitleUnits = Infinity,
): string | undefined => {
  const tail = `${suffix}.${parts.ext}`;
  const room = maxBytes - byteLength(parts.prefix) - byteLength(tail);
  let t = vaultSegment(parts.title);
  // A title empty after sanitising stays "_" unless a date prefix names the file.
  if (t === "_" && parts.title.trim() === "" && parts.prefix !== "") t = "";
  let cut = t === "" ? "" : cutBytes(t, room);
  if (cut.length > maxTitleUnits) {
    let short = "";
    for (const g of graphemes(cut)) {
      if (short.length + g.length > maxTitleUnits) break;
      short += g;
    }
    cut = short.replace(/[. ]+$/, "");
  }
  if (t !== "" && cut === "") return undefined;
  const stem =
    parts.prefix === "" ? cut : cut === "" ? parts.prefix.trimEnd() : `${parts.prefix}${cut}`;
  return vaultSegment(`${stem}${tail}`);
};

/**
 * `<YYYY-MM-DD> <title>.<ext>`, sanitised, at most 120 UTF-8 bytes (the title is shortened at a
 * grapheme boundary). A title that already begins with a date ("YYYY-MM-DD", then a space or the
 * end) gets no prefix, whatever its date.
 */
export const vaultFileName = (input: VaultFileNameInput): string =>
  buildName(nameParts(input), "", MAX_VAULT_SEGMENT_BYTES) ??
  vaultSegment(`.${nameParts(input).ext}`);

export interface VaultPathInput extends VaultFileNameInput {
  /** Folder names from the top down (e.g. ["2026", "Expenses"]); null for Unfiled. */
  folders: readonly string[] | null;
  /** Disk names of the other top-level folders, so a top-level "Unfiled" gets a free " (n)". */
  topLevelSiblings?: readonly string[];
}

export interface VaultPathResult {
  /** `documents/<folders>/<name>`, with " (2)" when taken. */
  path: string;
  /** False when the path is over 240 even with the title at 8 characters (§ 3.8). */
  fits: boolean;
  /** How many characters over 240 (0 when it fits). */
  overBy: number;
}

/**
 * Where a document goes: its folder path plus `vaultFileName`, the title shortened until the
 * path is ≤ 240, and " (2)", " (3)"... before the extension when `taken` holds that path (files
 * or folders, compared by `sameName`). Never throws: `fits: false` means the dialog shows
 * "Name too long" and disables Save.
 *
 * Folder names are not shortened here: a folder's disk name must be the same for every file in
 * it, so that is decided per folder (`vaultFolderName`), not per file.
 */
export const vaultPath = (input: VaultPathInput, taken: Iterable<string> = []): VaultPathResult => {
  const takenPaths = [...taken];
  const dirs = input.folders === null ? [VAULT_UNFILED_DIR] : input.folders.map(vaultFolderName);
  // A top-level user folder named "Unfiled" must not share the Unfiled directory (§ 5).
  if (input.folders !== null && dirs[0] !== undefined && sameName(dirs[0], VAULT_UNFILED_DIR)) {
    dirs[0] = freeFolderName(dirs[0], [VAULT_UNFILED_DIR, ...(input.topLevelSiblings ?? [])]);
  }
  const dir = [VAULT_DOCUMENTS_DIR, ...dirs].join("/");
  const parts = nameParts(input);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` (${n})`;
    const full = buildName(parts, suffix, MAX_VAULT_SEGMENT_BYTES);
    let name = full;
    if (name !== undefined && dir.length + 1 + name.length > MAX_VAULT_PATH) {
      const over = dir.length + 1 + name.length - MAX_VAULT_PATH;
      const titleUnits = name.length - parts.prefix.length - suffix.length - parts.ext.length - 1;
      name = buildName(
        parts,
        suffix,
        MAX_VAULT_SEGMENT_BYTES,
        Math.max(titleUnits - over, VAULT_MIN_TITLE),
      );
    }
    if (name === undefined) {
      const shortest =
        buildName(parts, suffix, MAX_VAULT_SEGMENT_BYTES, VAULT_MIN_TITLE) ?? full ?? "_";
      const path = `${dir}/${shortest}`;
      return { path, fits: false, overBy: Math.max(path.length - MAX_VAULT_PATH, 0) };
    }
    const path = `${dir}/${name}`;
    if (!takenPaths.some((t) => sameName(t, path))) {
      const overBy = Math.max(path.length - MAX_VAULT_PATH, 0);
      return { path, fits: overBy === 0, overBy };
    }
  }
};

/** What the user may do with a folder, by its `default_key` (ADR § 5, D5). */
export const vaultFolderRules = (defaultKey: string | null): { rename: boolean; move: boolean } => {
  if (defaultKey === YEAR_ROOT_KEY) return { rename: false, move: false };
  if (defaultKey !== null) return { rename: true, move: false };
  return { rename: true, move: true };
};

// Errors (ADR § 11.7). StorageQuotaError already exists in documents.ts.

/** A user rename or move that `vaultFolderRules` forbids (D5, § 5). */
export class FolderFixedError extends DocumentError {
  override readonly name = "FolderFixedError";
  constructor(readonly defaultKey: string | null) {
    super(
      defaultKey === YEAR_ROOT_KEY
        ? "Year folders can't be renamed or moved."
        : "Default folders can't be moved.",
    );
  }
}
/** A folder rename or move cancelled before its commit: nothing changed (§ 11.3). */
export class OperationCancelledError extends DocumentError {
  override readonly name = "OperationCancelledError";
  constructor() {
    super("Cancelled. Nothing was changed.");
  }
}

export class VaultPermissionError extends DocumentError {
  override readonly name = "VaultPermissionError";
  constructor() {
    super("Reconnect your vault folder to save changes.");
  }
}
export class VaultNameTakenError extends DocumentError {
  override readonly name = "VaultNameTakenError";
  constructor(readonly path: string) {
    super(
      `"${path}" is already in your vault folder and fiscode doesn't know it. Check the folder, then try again.`,
    );
  }
}
export class VaultFileLockedError extends DocumentError {
  override readonly name = "VaultFileLockedError";
  constructor(readonly path: string) {
    super(`"${path}" is in use by another program, such as a sync client. Try again in a moment.`);
  }
}
export class VaultConflictError extends DocumentError {
  override readonly name = "VaultConflictError";
  constructor(
    readonly path: string,
    readonly conflictPath: string,
  ) {
    super(`"${path}" has a conflicting copy at "${conflictPath}". Choose which one to keep.`);
  }
}
export class VaultIntegrityError extends DocumentError {
  override readonly name = "VaultIntegrityError";
  constructor(readonly path: string) {
    super(`"${path}" doesn't match what fiscode saved. It may have been changed or damaged.`);
  }
}
export class VaultPathTooLongError extends DocumentError {
  override readonly name = "VaultPathTooLongError";
  constructor(readonly path: string) {
    super("Name too long. Shorten the name or a folder name, then save.");
  }
}
export class VaultBusyError extends DocumentError {
  override readonly name = "VaultBusyError";
  constructor() {
    super("Busy in another tab. Try again when it finishes.");
  }
}

/**
 * A document write while the vault migration runs (ADR § 10): Documents is read-only until it
 * finishes. Preview still works from the old store.
 */
export class VaultMigratingError extends DocumentError {
  override readonly name = "VaultMigratingError";
  constructor() {
    super("Moving your files into the vault… You can change documents when it finishes.");
  }
}

/**
 * A document write, import, restore or backup after the vault migration stopped part way (it
 * failed, or was cancelled). Documents stays read-only until it is resumed and finishes (§ 10).
 */
export class VaultMigrationIncompleteError extends DocumentError {
  override readonly name = "VaultMigrationIncompleteError";
  constructor() {
    super("Moving your files into the vault didn't finish. Resume it to change documents.");
  }
}

/** `vaultPath` never cuts a title below this many characters (§ 3.8). */
export const VAULT_MIN_TITLE = 8;

/**
 * What a folder path must leave for any file below it (§ 3.8): "/" (1) + "YYYY-MM-DD " (11) +
 * the 8-character title floor (8) + " (99)" (5) + ".jpeg" (5) = 30.
 */
export const VAULT_FILE_RESERVE = 30;

/**
 * Whether a folder path fits the D4 budget: `newPath + deepestDescendantSuffix` plus the
 * 30-character file reserve is ≤ 240. `newPath` is from the vault root ("documents/2026/Trips");
 * for a rename or move, `deepestDescendantSuffix` is the deepest folder below it ("/Spring/Day 1").
 * Never throws: the dialog shows "Name too long" and disables Save when `fits` is false.
 */
export const folderPathFits = (
  newPath: string,
  deepestDescendantSuffix = "",
): { fits: boolean; overBy: number } => {
  const overBy = Math.max(
    (newPath + deepestDescendantSuffix).length + VAULT_FILE_RESERVE - MAX_VAULT_PATH,
    0,
  );
  return { fits: overBy === 0, overBy };
};

/**
 * The never-refuse fallback for a folder path over budget (§ 3.8): restore, History revert, import
 * and the migration. `names` are a folder path's disk names from the top down, without
 * "documents/"; `suffix` is what must still fit below the last one (the deepest descendant's
 * "/Spring/Day 1"). Names are cut from the top down in one pass, each at a grapheme boundary and to
 * no less than one grapheme, until `folderPathFits`. Returns the new names (unchanged ones as they
 * were) and whether they fit; the caller applies the ` (n)` rule to a shortened name now taken.
 */
export const shortenFolderNames = (
  names: readonly string[],
  suffix = "",
): { names: string[]; fits: boolean } => {
  const out = [...names];
  const over = () => folderPathFits([VAULT_DOCUMENTS_DIR, ...out].join("/"), suffix).overBy;
  for (let i = 0; i < out.length && over() > 0; i++) {
    const gs = graphemes(out[i]!);
    let keep = gs.length;
    let units = out[i]!.length;
    const need = over();
    while (keep > 1 && out[i]!.length - units < need) {
      keep--;
      units -= gs[keep]!.length;
    }
    out[i] = vaultSegment(gs.slice(0, keep).join(""));
  }
  return { names: out, fits: over() === 0 };
};
