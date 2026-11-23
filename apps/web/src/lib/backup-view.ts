import type { BackupProgress, ExportVaultProgress } from "@fiscode/backup";

// Words for the backup and restore dialogs: progress by phase, and passphrase strength.

const PHASES: Record<BackupProgress["phase"], string> = {
  reading: "Reading your data",
  zipping: "Packing files",
  encrypting: "Encrypting",
  decrypting: "Decrypting",
  checking: "Checking every file",
  writing: "Writing",
};

/** "Packing files (3 of 12)", or just the phase when it has one step. */
export const progressLine = (p: BackupProgress): string =>
  p.total > 1 ? `${PHASES[p.phase]} (${Math.min(p.done, p.total)} of ${p.total})` : PHASES[p.phase];

export type Strength = { label: "Too short" | "Weak" | "Fair" | "Strong"; score: 0 | 1 | 2 | 3 };

/**
 * A rough strength for a passphrase, shown beside the field. Length counts most; mixing kinds of
 * characters (lower, upper, digits, other) helps. Under the minimum it is always "Too short".
 */
export const passphraseStrength = (value: string, min: number): Strength => {
  if (value.length < min) return { label: "Too short", score: 0 };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(value)).length;
  const words = value.trim().split(/\s+/).length;
  if (value.length >= 20 || (value.length >= 16 && (kinds >= 3 || words >= 4)))
    return { label: "Strong", score: 3 };
  if (value.length >= 14 || kinds >= 3) return { label: "Fair", score: 2 };
  return { label: "Weak", score: 1 };
};

/** Saves a blob as a file through a temporary link. */
export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const EXPORT_PHASES: Record<ExportVaultProgress["phase"], string> = {
  reading: "Reading your data",
  collecting: "Gathering files",
  zipping: "Packing the zip",
  writing: "Writing files",
};

/** Export vault's progress: "Writing files (3 of 12)", or just the phase when it has one step. */
export const exportProgressLine = (p: ExportVaultProgress): string =>
  p.total > 1
    ? `${EXPORT_PHASES[p.phase]} (${Math.min(p.done, p.total)} of ${p.total})`
    : EXPORT_PHASES[p.phase];
