// Vault names (ADR 0001 § 3-5, § 11.5): pure rules for the readable tree
// `documents/<year>/<category>/<YYYY-MM-DD> <title>.<ext>`. No I/O; the repos and the dialogs call these.

import { DocumentError } from "./documents.ts";

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
  cutBytes(vaultSegment(name), MAX_VAULT_SEGMENT_BYTES) || "_";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  const e = vaultSegment(ext.toLowerCase().replace(/^\.+/, "")).replace(/\./g, "_");
  let t = title.normalize("NFC").trim();
  if (e !== "_" && t.toLowerCase().endsWith(`.${e}`)) t = t.slice(0, -(e.length + 1));
  const prefix = date !== null && ISO_DATE.test(date) ? `${date} ` : "";
  if (prefix !== "" && t.startsWith(prefix)) t = t.slice(prefix.length);
  else if (prefix !== "" && t === date) t = "";
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
 * grapheme boundary). A title that already begins with the date is not prefixed twice.
 */
export const vaultFileName = (input: VaultFileNameInput): string =>
  buildName(nameParts(input), "", MAX_VAULT_SEGMENT_BYTES) ??
  vaultSegment(`.${nameParts(input).ext}`);

export interface VaultPathInput extends VaultFileNameInput {
  /** Folder names from the top down (e.g. ["2026", "Expenses"]); null for Unfiled. */
  folders: readonly string[] | null;
}

export interface VaultPathResult {
  /** `documents/<folders>/<name>`, with " (2)" when taken. */
  path: string;
  /** False when the path is over 240 even with the title at one character. */
  fits: boolean;
  /** How many characters over 240 (0 when it fits). */
  overBy: number;
}

/** Lower-cased NFC: how the vault compares paths (case-insensitive file systems). */
export const vaultPathKey = (path: string): string => path.normalize("NFC").toLowerCase();

/**
 * Where a document goes: its folder path plus `vaultFileName`, the title shortened until the
 * path is ≤ 240, and " (2)", " (3)"... before the extension when `taken` holds that path (files
 * or folders, compared by `vaultPathKey`). Never throws: `fits: false` means the dialog shows
 * "Name too long" and disables Save.
 *
 * Folder names are not shortened here: a folder's disk name must be the same for every file in
 * it, so that is decided per folder (`vaultFolderName`), not per file.
 */
export const vaultPath = (input: VaultPathInput, taken: Iterable<string> = []): VaultPathResult => {
  const takenKeys = new Set([...taken].map(vaultPathKey));
  const dirs = input.folders === null ? [VAULT_UNFILED_DIR] : input.folders.map(vaultFolderName);
  const dir = [VAULT_DOCUMENTS_DIR, ...dirs].join("/");
  const parts = nameParts(input);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` (${n})`;
    const full = buildName(parts, suffix, MAX_VAULT_SEGMENT_BYTES);
    let name = full;
    if (name !== undefined && dir.length + 1 + name.length > MAX_VAULT_PATH) {
      const over = dir.length + 1 + name.length - MAX_VAULT_PATH;
      const titleUnits = name.length - parts.prefix.length - suffix.length - parts.ext.length - 1;
      name = buildName(parts, suffix, MAX_VAULT_SEGMENT_BYTES, titleUnits - over);
    }
    if (name === undefined) {
      const shortest = buildName(parts, suffix, MAX_VAULT_SEGMENT_BYTES, 1) ?? full ?? "_";
      const path = `${dir}/${shortest}`;
      return { path, fits: false, overBy: Math.max(path.length - MAX_VAULT_PATH, 0) };
    }
    const path = `${dir}/${name}`;
    if (!takenKeys.has(vaultPathKey(path))) {
      const overBy = Math.max(path.length - MAX_VAULT_PATH, 0);
      return { path, fits: overBy === 0, overBy };
    }
  }
};

/** What the user may do with a folder, by its `default_key` (ADR § 5, D5). */
export const vaultFolderRules = (defaultKey: string | null): { rename: boolean; move: boolean } => {
  if (defaultKey === "year-root") return { rename: false, move: false };
  if (defaultKey !== null) return { rename: true, move: false };
  return { rename: true, move: true };
};

// Errors (ADR § 11.7). StorageQuotaError already exists in documents.ts.

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
