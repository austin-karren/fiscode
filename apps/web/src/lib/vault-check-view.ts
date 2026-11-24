import type { ScanProgress, ScanResult } from "@fiscode/db";

// Words for the Check folder page (/documents/check, ADR 0001 § 6, § 11.4).

/** "Checking files (3 of 12)", or just "Checking files" before the count is known. */
export const scanProgressLine = (p: ScanProgress | undefined): string =>
  p && p.total > 0
    ? `Checking files (${Math.min(p.done, p.total)} of ${p.total})`
    : "Checking files";

/** Why Check now did nothing, for a skipped scan. */
export const skippedLine = (result: Extract<ScanResult, { status: "skipped" }>): string =>
  result.reason === "busy"
    ? "Busy in another tab. Try again when it finishes."
    : "The check waits until your files are moved into the vault.";

/** "1 file" / "3 files". */
export const count = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** The file name at the end of a vault path. */
export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
