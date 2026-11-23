import { todayIso, YEAR_DEFAULT_FOLDER_KEYS, yearOf, type LinkableRecordType } from "@fiscode/core";
import { folderRepo, type LinkedRecord } from "@fiscode/db";

import { formatDate } from "./format-date";

// Rows that documents attach to, and where an upload from each row lands.

export type { LinkableRecordType };

const FOLDER_FOR: Record<LinkableRecordType, keyof typeof YEAR_DEFAULT_FOLDER_KEYS> = {
  expense: "Expenses",
  income: "Income",
  mileage: "Mileage",
  // A lease or utility bill; a W-9 or contract; a title or registration; a prior return.
  home_office: "Other",
  client: "Income",
  vehicle: "Mileage",
  profile: "Tax forms",
};

/** The screen each record type lives on, for links from a document back to its row. */
export const ROUTE_FOR = {
  expense: "/expenses",
  income: "/income",
  mileage: "/mileage",
  home_office: "/home-office",
  client: "/clients",
  vehicle: "/vehicles",
  profile: "/profile",
} as const satisfies Record<LinkableRecordType, string>;

export const isLinkable = (t: string): t is LinkableRecordType => t in ROUTE_FOR;

/** The element id of a record's table row: the target of a link from a document. */
export const rowAnchor = (recordId: string) => `row-${recordId}`;

/**
 * The folder an upload from a row goes into: `<year>/<default folder>` for the row's date (this
 * year when the record has none, like a client or the profile), made if it isn't there yet. Its path comes back too, for the result line.
 */
export async function folderForRecord(
  recordType: LinkableRecordType,
  date: string,
): Promise<{ id: string | null; path: string }> {
  const year = Number((date || todayIso()).slice(0, 4)) || yearOf(todayIso());
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

const KIND: Record<string, string> = {
  expense: "Expense",
  income: "Income",
  mileage: "Trip",
  home_office: "",
  client: "Client",
  vehicle: "Vehicle",
  profile: "",
};

/**
 * A linked row in words, as rows read elsewhere: "Expense Jul 9, 2026 · Travel · $250.00". The
 * repo's label starts with the ISO date; the rest of it is kept.
 */
export const linkedRowLabel = (r: LinkedRecord): string => {
  const rest = r.label.split(" · ").slice(r.date && r.label.startsWith(r.date) ? 1 : 0);
  const head = [KIND[r.recordType], r.date ? formatDate(r.date) : ""].filter(Boolean).join(" ");
  return [head, ...rest].filter(Boolean).join(" · ");
};
