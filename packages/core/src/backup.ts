// Full backup bundle (contract: d-data drafts/contract-backup.md): the typed errors. Messages are
// written for the user.

/** The base of every error a backup read or restore throws on purpose. */
export class BackupError extends Error {
  override readonly name: string = "BackupError";
}

export class BackupNotAZipError extends BackupError {
  override readonly name = "BackupNotAZipError";
  constructor() {
    super("This isn't a fiscode backup. Choose the .zip you made with Back up everything.");
  }
}
export class BackupManifestError extends BackupError {
  override readonly name = "BackupManifestError";
  constructor(reason: string) {
    super(`This backup can't be read: ${reason}. Nothing was changed.`);
  }
}
export class BackupTooNewError extends BackupError {
  override readonly name = "BackupTooNewError";
  constructor(version: number) {
    super(
      `This backup is format ${version}, written by a newer fiscode. Update the app, then restore again.`,
    );
  }
}
/**
 * A damaged backup. With `path`: one file inside the zip doesn't match the manifest. Without: the
 * encrypted file itself is damaged, cut short or altered (age's checks failed after the passphrase
 * matched), so retrying the passphrase won't help.
 */
export class BackupFileCorruptError extends BackupError {
  override readonly name = "BackupFileCorruptError";
  constructor(readonly path?: string) {
    super(
      path === undefined
        ? "This backup file is damaged (cut short or altered), so it can't be opened. The passphrase is right. Nothing was changed."
        : `"${path}" in this backup is damaged (its contents don't match the backup's record). Nothing was changed.`,
    );
  }
}
export class BackupBytesMissingError extends BackupError {
  override readonly name = "BackupBytesMissingError";
  constructor(documentName: string) {
    super(`The file for "${documentName}" isn't in this backup. Nothing was changed.`);
  }
}
export class BackupUnexpectedFileError extends BackupError {
  override readonly name = "BackupUnexpectedFileError";
  constructor(path: string) {
    super(`This backup has a file its record doesn't list: "${path}". Nothing was changed.`);
  }
}
export class BackupPassphraseError extends BackupError {
  override readonly name = "BackupPassphraseError";
  constructor(reason: "wrong" | "missing" | "too-short") {
    super(
      reason === "wrong"
        ? "That passphrase doesn't open this backup. Check it and try again. Nothing was changed."
        : reason === "missing"
          ? "This backup is encrypted. Enter its passphrase to restore it."
          : "Use a passphrase of at least 12 characters. It is the only way to open the backup: keep it somewhere safe.",
    );
  }
}
