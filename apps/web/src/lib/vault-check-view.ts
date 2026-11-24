import type { AdoptFallback, AdoptResult, ScanProgress, ScanResult } from "@fiscode/db";

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

/** Why Adopt files a document in Unfiled instead of the folder it was moved to (#114). */
export const ADOPT_FALLBACK_REASONS: Record<AdoptFallback, string> = {
  year: "a new top-level folder can't be named like a year",
  name: "fiscode can't use that folder's name",
  unfiled: "folders inside Unfiled aren't kept",
  "too-deep": "that folder is nested deeper than fiscode allows",
};

/** "Adopt puts it in Unfiled: <why>." Always Unfiled, even below a folder fiscode knows. */
export const adoptFallbackLine = (reason: AdoptFallback): string =>
  `Adopt puts it in Unfiled: ${ADOPT_FALLBACK_REASONS[reason]}.`;

/** "Adopt creates the folder Receipts / March." for the folders made outside fiscode. */
export const adoptCreatesLine = (folders: readonly string[]): string =>
  `Adopt creates the ${folders.length === 1 ? "folder" : "folders"} ${folders.join(" / ")}.`;

/**
 * What an adopt did beyond moving documents, one line each: folders it created, names it
 * shortened to fit, and documents it put in Unfiled with why. Empty when it only moved files.
 */
export const adoptResultLines = (
  result: AdoptResult,
  names: ReadonlyMap<string, string>,
): string[] => [
  ...(result.folders.length > 0
    ? [
        `Created ${count(result.folders.length, "folder")}: ${result.folders.map((f) => f.name).join(", ")}.`,
      ]
    : []),
  ...result.shortened.map((s) => `Folder name shortened to fit: ${s.from} → ${s.to}.`),
  ...result.unfiled.map(
    (u) =>
      `${names.get(u.documentId) ?? baseName(u.foundAt)} went to Unfiled: ${ADOPT_FALLBACK_REASONS[u.reason]}.`,
  ),
];
