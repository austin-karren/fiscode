// Documents (contract: d-data drafts/contract-documents.md): limits, the mime allow-list, name
// rules and the typed errors the repos throw. Messages are written for the user.

/** The largest file fiscode stores: 25 MB. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** The file types fiscode stores. HEIC is stored and downloadable; preview depends on the browser. */
export const ALLOWED_DOCUMENT_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/gif",
  "text/plain",
] as const;
export type DocumentMime = (typeof ALLOWED_DOCUMENT_MIMES)[number];

const MIME_BY_EXTENSION: Record<string, DocumentMime> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  gif: "image/gif",
  txt: "text/plain",
};

/**
 * The mime to store for a file: the browser's type when it gave one, else from the file name's
 * extension (some browsers give "" for HEIC). Undefined when neither is allowed.
 */
export const documentMimeFor = (name: string, browserType: string): DocumentMime | undefined => {
  const given = browserType.split(";")[0]!.trim().toLowerCase();
  if ((ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(given)) return given as DocumentMime;
  if (given !== "" && given !== "application/octet-stream") return undefined;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return name.includes(".") ? MIME_BY_EXTENSION[ext] : undefined;
};

/** Folders nest at most this deep (a root folder is depth 1). */
export const MAX_FOLDER_DEPTH = 8;
/** The longest folder name. */
export const MAX_FOLDER_NAME = 120;

/** The folders `ensureYearDefaults` makes under each `<year>` root, in order, with their keys. */
export const YEAR_DEFAULT_FOLDERS = [
  "Expenses",
  "Income",
  "Mileage",
  "Health insurance",
  "Tax forms",
  "Other",
] as const;

/** `document_folder.default_key` of a year's root folder. */
export const YEAR_ROOT_KEY = "year-root";

/** `document_folder.default_key` for each default child folder. */
export const YEAR_DEFAULT_FOLDER_KEYS: Record<(typeof YEAR_DEFAULT_FOLDERS)[number], string> = {
  Expenses: "expenses",
  Income: "income",
  Mileage: "mileage",
  "Health insurance": "health-insurance",
  "Tax forms": "tax-forms",
  Other: "other",
};

/** Record types a document can link to (CSV record-type names; open for later ones). */
export const LINKABLE_RECORD_TYPES = [
  "expense",
  "income",
  "mileage",
  "home_office",
  "profile",
  "client",
  "vehicle",
] as const;
export type LinkableRecordType = (typeof LINKABLE_RECORD_TYPES)[number];

/** The base of every error the document repos throw on purpose; `message` can be shown as is. */
export class DocumentError extends Error {
  override readonly name: string = "DocumentError";
}

export class FolderNameInvalidError extends DocumentError {
  override readonly name = "FolderNameInvalidError";
  constructor(reason: string) {
    super(reason);
  }
}

/** A folder name after trimming, or a `FolderNameInvalidError` saying why it can't be used. */
export const validFolderName = (raw: string): string => {
  const name = raw.trim();
  if (name === "") throw new FolderNameInvalidError("Enter a folder name.");
  if (name.length > MAX_FOLDER_NAME) {
    throw new FolderNameInvalidError(`Use ${MAX_FOLDER_NAME} characters or fewer.`);
  }
  if (name.includes("/")) throw new FolderNameInvalidError("A folder name can't contain /.");
  return name;
};

export class DocumentNameInvalidError extends DocumentError {
  override readonly name = "DocumentNameInvalidError";
  constructor(reason: string) {
    super(reason);
  }
}

/** A document name after trimming, or a `DocumentNameInvalidError` (same rules as folders). */
export const validDocumentName = (raw: string): string => {
  const name = raw.trim();
  if (name === "") throw new DocumentNameInvalidError("Enter a name.");
  if (name.length > MAX_FOLDER_NAME) {
    throw new DocumentNameInvalidError(`Use ${MAX_FOLDER_NAME} characters or fewer.`);
  }
  if (name.includes("/")) throw new DocumentNameInvalidError("A name can't contain /.");
  return name;
};

/**
 * Whether two names or paths are the same place to fiscode. The one comparison for folder names
 * (`freeFolderName`) and vault paths (`vaultPath`), so they never disagree. It is
 * `localeCompare` at "base" sensitivity: case- AND accent-insensitive ("Cafe" = "café"), and
 * NFC/NFD forms compare equal. That is stricter than Windows (case-insensitive only); a stricter
 * rule only adds a " (2)" that wasn't strictly needed, and never lets two names collide on disk.
 */
export const sameName = (a: string, b: string): boolean =>
  a.localeCompare(b, "en", { sensitivity: "base" }) === 0;

/**
 * A folder name free among `siblingNames`: the name itself, or "Name (2)", "Name (3)", ... the
 * first not taken, matched without case. Used wherever a folder comes back or comes in and must
 * not refuse (History restore, restoreTree, Add rows / Update rows of another device's folders).
 */
export const freeFolderName = (name: string, siblingNames: readonly string[]): string => {
  const taken = (n: string) => siblingNames.some((s) => sameName(s, n));
  let out = name;
  for (let i = 2; taken(out); i++) out = `${name} (${i})`;
  return out;
};

export class FolderNameTakenError extends DocumentError {
  override readonly name = "FolderNameTakenError";
  constructor(folderName: string) {
    super(`There is already a folder named "${folderName}" here. Choose another name.`);
  }
}
export class FolderNotFoundError extends DocumentError {
  override readonly name = "FolderNotFoundError";
  constructor() {
    super("That folder no longer exists. It may have been deleted.");
  }
}
export class FolderTooDeepError extends DocumentError {
  override readonly name = "FolderTooDeepError";
  constructor() {
    super(`Folders can be nested ${MAX_FOLDER_DEPTH} deep at most.`);
  }
}
export class FolderCycleError extends DocumentError {
  override readonly name = "FolderCycleError";
  constructor() {
    super("A folder can't be moved into itself or into one of its own folders.");
  }
}
export class DocumentTooLargeError extends DocumentError {
  override readonly name = "DocumentTooLargeError";
  constructor(fileName: string) {
    super(`"${fileName}" is larger than 25 MB. fiscode stores files up to 25 MB.`);
  }
}
export class DocumentTypeNotAllowedError extends DocumentError {
  override readonly name = "DocumentTypeNotAllowedError";
  constructor(fileName: string) {
    super(
      `"${fileName}" isn't a type fiscode stores. Use a PDF, PNG, JPEG, WebP, HEIC, GIF or text file.`,
    );
  }
}
export class StorageQuotaError extends DocumentError {
  override readonly name = "StorageQuotaError";
  constructor() {
    super("This browser has no room left for files. Free some space, then try again.");
  }
}
export class DocumentBytesMissingError extends DocumentError {
  override readonly name = "DocumentBytesMissingError";
  constructor() {
    super("File not on this device. Restore a backup that includes your documents.");
  }
}
export class DocumentNotFoundError extends DocumentError {
  override readonly name = "DocumentNotFoundError";
  constructor() {
    super("That document no longer exists. It may have been deleted.");
  }
}
export class RecordNotFoundError extends DocumentError {
  override readonly name = "RecordNotFoundError";
  constructor() {
    super("That record no longer exists, so the document can't be attached to it.");
  }
}
