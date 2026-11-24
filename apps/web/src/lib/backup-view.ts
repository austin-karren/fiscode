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

/**
 * What a cancelled Export vault left behind, from the last progress it reported. exportVault
 * reports `writing` done=i just before it writes file i and checks the signal only before the
 * next file, so file i always lands: i + 1 files are written. Before `writing`, nothing is.
 */
export const cancelledExportLine = (
  last: ExportVaultProgress | undefined,
  folder: boolean,
): string => {
  if (!folder) return "Export cancelled. Nothing was downloaded.";
  if (last?.phase !== "writing") return "Export cancelled before any file was written.";
  const written = Math.min(last.done + 1, last.total);
  return `Export cancelled: ${written} of ${last.total} ${last.total === 1 ? "file" : "files"} written. They stay in the folder, with no fiscode.json, so it isn't a complete export.`;
};
