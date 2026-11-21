import { YEAR_DEFAULT_FOLDER_KEYS } from "@fiscode/core";
import { folderRepo } from "@fiscode/db";

// Rows that documents attach to, and where an upload from each row lands.

export type LinkableRecordType = "expense" | "income" | "mileage";

const FOLDER_FOR: Record<LinkableRecordType, keyof typeof YEAR_DEFAULT_FOLDER_KEYS> = {
  expense: "Expenses",
  income: "Income",
  mileage: "Mileage",
};

/** The screen each record type lives on, for links from a document back to its row. */
export const ROUTE_FOR: Record<LinkableRecordType, "/expenses" | "/income" | "/mileage"> = {
  expense: "/expenses",
  income: "/income",
  mileage: "/mileage",
};

export const isLinkable = (t: string): t is LinkableRecordType => t in ROUTE_FOR;

/** The element id of a record's table row: the target of a link from a document. */
export const rowAnchor = (recordId: string) => `row-${recordId}`;

/**
 * The folder an upload from a row goes into: `<year>/<Expenses|Income|Mileage>` for the row's date,
 * made if it isn't there yet. Its path comes back too, for the result line.
 */
export async function folderForRecord(
  recordType: LinkableRecordType,
  date: string,
): Promise<{ id: string | null; path: string }> {
  const year = Number(date.slice(0, 4));
  const name = FOLDER_FOR[recordType];
  if (Number.isInteger(year)) {
    await folderRepo.ensureYearDefaults(year);
    const key = YEAR_DEFAULT_FOLDER_KEYS[name];
    const found = (await folderRepo.list()).find(
      (f) => f.deletedAt === null && f.taxYear === year && f.defaultKey === key,
    );
    if (found) return { id: found.id, path: `${year} / ${found.name}` };
  }
  return { id: null, path: "Unfiled" };
}
