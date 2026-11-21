import {
  cents,
  ENTITY_TYPE_LABELS,
  EXPENSE_CATEGORY_LABELS,
  FILING_STATUS_LABELS,
  formatUSD,
  HOME_OFFICE_METHOD_LABELS,
  INCOME_KIND_LABELS,
  INCOME_SOURCE_TYPE_LABELS,
  isoFromDate,
  labelFor,
  QUARTERLY_METHOD_LABELS,
  RETIREMENT_ACCOUNT_LABELS,
  VEHICLE_METHOD_LABELS,
  type LabelMap,
} from "@fiscode/core";
import type { Bundle, HistoryRow } from "@fiscode/db";
import { formatDate, formatDateTime } from "./format-date";

// Turns a history row (table name, op code, two JSON snapshots) into what a
// person reads: when, what kind of record, what happened to it and what
// changed. Pure, so the History screen and its tests share it.

type Snapshot = Record<string, unknown>;

/** Names for the ids a snapshot points at. */
export type NameLookup = { clients: Record<string, string>; vehicles: Record<string, string> };

export type HistoryAction = "added" | "edited" | "removed" | "restored" | "imported";

export const HISTORY_ACTION_LABELS: Record<HistoryAction, string> = {
  added: "Added",
  edited: "Edited",
  removed: "Deleted or archived",
  restored: "Restored",
  imported: "Imported",
};

export type HistoryChange = { label: string; from: string; to: string };

export type HistoryEntry = {
  id: string;
  at: Date;
  /** Record type key, for the filter: a table name, or "import". */
  kind: string;
  kindLabel: string;
  action: HistoryAction;
  /** "Edited expense: Demo software $99.00" */
  headline: string;
  /** For an edit, the fields that changed. */
  changes: HistoryChange[];
  /** For anything else, the record's main fields. */
  facts: string[];
  /** Headline plus changes in one sentence. */
  summary: string;
  recordId: string;
};

const NONE = "none";

const text = (v: unknown): string => (v === null || v === undefined || v === "" ? NONE : String(v));
const money = (v: unknown): string => (typeof v === "number" ? formatUSD(cents(v)) : NONE);
const yesNo = (v: unknown): string => (v ? "yes" : "no");
const labelled =
  (labels: LabelMap) =>
  (v: unknown): string =>
    typeof v === "string" && v !== "" ? labelFor(labels, v) : NONE;

/** A stored `YYYY-MM-DD` as "Nov 2, 2026", the way the date fields show it. */
export const formatDay = (v: unknown): string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return NONE;
  return formatDate(v.slice(0, 10));
};

export const formatMinutes = (v: unknown): string => {
  if (typeof v !== "number") return NONE;
  const h = Math.floor(v / 60);
  const m = v % 60;
  // Same form as the Time screen.
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const percentFromBasisPoints = (v: unknown): string =>
  typeof v === "number" ? `${v / 100}%` : NONE;

type Formatter = (value: unknown, names: NameLookup) => string;

const clientName: Formatter = (v, names) =>
  typeof v === "string" && v !== "" ? (names.clients[v] ?? "a client no longer here") : NONE;
const vehicleName: Formatter = (v, names) =>
  typeof v === "string" && v !== "" ? (names.vehicles[v] ?? "a vehicle no longer here") : NONE;

type FieldSpec = readonly [key: string, label: string, format: Formatter];

type KindSpec = {
  /** Lower case, as it reads after a verb: "Edited expense". */
  noun: string;
  /** Soft-deleting it is called archiving on its own screen. */
  archives?: boolean;
  /** What tells this record from its neighbours: "Demo software $99.00". */
  title: (row: Snapshot, names: NameLookup) => string;
  fields: readonly FieldSpec[];
  /** Field keys shown for an add, delete or restore. */
  facts: readonly string[];
};

const join = (...parts: (string | undefined)[]): string =>
  parts.filter((p) => p !== undefined && p !== "" && p !== NONE).join(" ");

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

const KINDS: Record<string, KindSpec> = {
  income: {
    noun: "income",
    title: (r, n) =>
      join(
        str(r.description) ??
          (str(r.clientId) ? clientName(r.clientId, n) : labelled(INCOME_KIND_LABELS)(r.kind)),
        money(r.amountCents),
      ),
    fields: [
      ["date", "Date", formatDay],
      ["amountCents", "Amount", money],
      ["clientId", "Client", clientName],
      ["sourceType", "Source", labelled(INCOME_SOURCE_TYPE_LABELS)],
      ["kind", "Kind", labelled(INCOME_KIND_LABELS)],
      ["description", "Description", text],
      ["notes", "Notes", text],
    ],
    facts: ["date", "clientId", "kind"],
  },
  expense: {
    noun: "expense",
    title: (r) =>
      join(
        str(r.description) ?? labelled(EXPENSE_CATEGORY_LABELS)(r.category),
        money(r.amountCents),
      ),
    fields: [
      ["date", "Date", formatDay],
      ["amountCents", "Amount", money],
      ["category", "Category", labelled(EXPENSE_CATEGORY_LABELS)],
      ["clientId", "Client", clientName],
      ["description", "Description", text],
      ["reason", "Reason", text],
      ["notes", "Notes", text],
      ["flagForSection179", "Section 179 candidate", yesNo],
      ["startupExpense", "Startup expense", yesNo],
    ],
    facts: ["date", "category", "clientId"],
  },
  mileage: {
    noun: "mileage",
    title: (r) => join(`${text(r.businessMiles)} mi`, str(r.purpose)),
    fields: [
      ["date", "Date", formatDay],
      ["businessMiles", "Business miles", text],
      ["vehicleId", "Vehicle", vehicleName],
      ["purpose", "Purpose", text],
      ["notes", "Notes", text],
    ],
    facts: ["date", "vehicleId"],
  },
  time_entry: {
    noun: "time entry",
    title: (r, n) =>
      join(
        formatMinutes(r.minutes),
        str(r.description) ?? (str(r.clientId) ? clientName(r.clientId, n) : undefined),
      ),
    fields: [
      ["date", "Date", formatDay],
      ["minutes", "Time", formatMinutes],
      ["clientId", "Client", clientName],
      ["description", "Description", text],
      ["notes", "Notes", text],
    ],
    facts: ["date", "clientId"],
  },
  client: {
    noun: "client",
    archives: true,
    title: (r) => text(r.name),
    fields: [
      ["name", "Name", text],
      ["type", "Type", text],
      ["defaultRateCents", "Default rate", money],
      ["defaultCommissionRate", "Commission", percentFromBasisPoints],
      ["notes", "Notes", text],
    ],
    facts: ["type", "defaultRateCents"],
  },
  vehicle: {
    noun: "vehicle",
    archives: true,
    title: (r) => join(str(r.year === null ? "" : String(r.year ?? "")), str(r.make), str(r.model)),
    fields: [
      ["make", "Make", text],
      ["model", "Model", text],
      ["year", "Year", text],
      ["mpg", "MPG", text],
      ["method", "Method", labelled(VEHICLE_METHOD_LABELS)],
      ["inServiceDate", "In service", formatDay],
      ["notes", "Notes", text],
    ],
    facts: ["method", "inServiceDate"],
  },
  home_office: {
    noun: "home office",
    title: (r) => `from ${formatDay(r.startDate)}`,
    fields: [
      ["startDate", "Start", formatDay],
      ["endDate", "End", formatDay],
      ["method", "Method", labelled(HOME_OFFICE_METHOD_LABELS)],
      ["officeSqft", "Office sq ft", text],
      ["homeSqft", "Home sq ft", text],
      ["monthlyRentMortgageCents", "Monthly rent or mortgage", money],
      ["monthlyUtilitiesCents", "Monthly utilities", money],
      ["monthlyInsuranceCents", "Monthly insurance", money],
      ["regularExclusiveAck", "Regular and exclusive use", yesNo],
      ["notes", "Notes", text],
    ],
    facts: ["method", "officeSqft", "endDate"],
  },
  entity: {
    noun: "entity period",
    title: (r) => `${labelled(ENTITY_TYPE_LABELS)(r.type)} from ${formatDay(r.startDate)}`,
    fields: [
      ["type", "Entity type", labelled(ENTITY_TYPE_LABELS)],
      ["startDate", "Start", formatDay],
      ["endDate", "End", formatDay],
      ["notes", "Notes", text],
    ],
    facts: ["endDate"],
  },
  spouse: {
    noun: "spouse income period",
    title: (r) => `from ${formatDay(r.startDate)}`,
    fields: [
      ["startDate", "Start", formatDay],
      ["endDate", "End", formatDay],
      ["annualW2WagesCents", "Annual W-2 wages", money],
      ["annualFederalWithholdingCents", "Annual federal withholding", money],
      ["annualStateWithholdingCents", "Annual state withholding", money],
      ["notes", "Notes", text],
    ],
    facts: ["annualW2WagesCents", "endDate"],
  },
  // Documents (data layer only; d-ux owns the screens). The bytes never appear here.
  document: {
    noun: "document",
    title: (r) => text(r.name),
    fields: [
      ["name", "Name", text],
      ["notes", "Notes", text],
      ["sizeBytes", "Size (bytes)", text],
      ["mime", "Type", text],
    ],
    facts: [],
  },
  document_folder: {
    noun: "document folder",
    title: (r) => text(r.name),
    fields: [["name", "Name", text]],
    facts: [],
  },
  document_link: {
    noun: "document link",
    title: (r) =>
      `attached to ${r.recordType === "income" ? "an income row" : r.recordType === "mileage" ? "a mileage trip" : "an expense"}`,
    fields: [],
    facts: [],
  },
  retirement_contribution: {
    noun: "retirement contribution",
    title: (r) => join(labelled(RETIREMENT_ACCOUNT_LABELS)(r.account), money(r.amountCents)),
    fields: [
      ["date", "Date", formatDay],
      ["account", "Account", labelled(RETIREMENT_ACCOUNT_LABELS)],
      ["amountCents", "Amount", money],
      ["notes", "Notes", text],
    ],
    facts: ["date"],
  },
  profile: {
    noun: "profile",
    title: () => "",
    fields: [
      ["filingStatus", "Filing status", labelled(FILING_STATUS_LABELS)],
      ["state", "State", text],
      ["seStartDate", "Self-employment start date", formatDay],
      ["dependents", "Dependents", text],
      ["tracksRoth", "Tracks Roth", yesNo],
      ["usesRetirement", "Uses retirement accounts", yesNo],
      ["quarterlyMethod", "Quarterly method", labelled(QUARTERLY_METHOD_LABELS)],
      ["prepLeadDays", "Prep lead days", text],
    ],
    facts: ["filingStatus", "state"],
  },
};

const IMPORT_ENTITY = "__import_snapshot";
/** The import reason a whole-state restore from History is stored under. */
export const HISTORY_RESTORE_REASON = "history-restore";
/** The import reason a full backup restored over data is stored under (@fiscode/backup). */
export const BACKUP_RESTORE_REASON = "backup-restore";

/**
 * "the backup of Nov 20, 2026": the local day the backup was made (its file name's date), from
 * the `backup.createdAt` the restore keeps in the entry. "a backup" when the entry has none.
 */
const backupName = (after: Snapshot | undefined): string => {
  const createdAt = (after as { backup?: { createdAt?: unknown } } | undefined)?.backup?.createdAt;
  const made = typeof createdAt === "string" ? new Date(createdAt) : undefined;
  return made && !Number.isNaN(made.getTime())
    ? `the backup of ${formatDate(isoFromDate(made))}`
    : "a backup";
};
export const IMPORT_KIND = "import";

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The record types the filter offers, in screen order. */
export const HISTORY_KIND_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(KINDS).map(([key, spec]) => [key, capitalize(spec.noun)])),
  [IMPORT_KIND]: "Import",
};

export const parseSnapshot = (json: string | null): Snapshot | undefined => {
  if (!json) return undefined;
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null ? (value as Snapshot) : undefined;
  } catch {
    return undefined;
  }
};

// SQLite's own default is "2026-11-18 21:04:05", in UTC with no zone mark.
export const parseHistoryTime = (at: string): Date =>
  new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);

/** A history timestamp in the reader's own time zone: "Nov 18, 2026, 2:04 PM". */
export const formatHistoryTime = (at: Date): string => formatDateTime(at);

const DATA_TABLES = [
  "entities",
  "spouses",
  "clients",
  "income",
  "timeEntries",
  "vehicles",
  "mileage",
  "homeOffice",
  "expenses",
  "retirementContributions",
  "w2Jobs",
  "estimatedPayments",
  "documentFolders",
  "documents",
  "documentLinks",
] as const satisfies readonly (keyof Bundle)[];

/** How many records a stored bundle holds; the profile counts as one. */
export const countBundleRows = (bundle: Snapshot | undefined): number => {
  if (!bundle) return 0;
  const lists = DATA_TABLES.reduce((sum, key) => {
    const rows = bundle[key];
    return sum + (Array.isArray(rows) ? rows.length : 0);
  }, 0);
  return lists + (bundle.profile ? 1 : 0);
};

const rows = (n: number): string => `${n} ${n === 1 ? "row" : "rows"}`;

/** Same values in every field, whatever the key order (rows from a CSV and from the database differ in it). */
const sameValues = (x: Snapshot, y: Snapshot): boolean => {
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if ((x[k] ?? null) !== (y[k] ?? null)) return false;
  return true;
};

/** Rows in `after` whose id is in `before` with different values (an Update rows import). */
const countChangedRows = (before: Snapshot | undefined, after: Snapshot | undefined): number => {
  if (!before || !after) return 0;
  const list = (b: Snapshot, key: string) => (Array.isArray(b[key]) ? (b[key] as Snapshot[]) : []);
  let changed = 0;
  for (const key of DATA_TABLES) {
    const was = new Map(list(before, key).map((r) => [r.id, r]));
    for (const r of list(after, key)) {
      const prior = was.get(r.id);
      if (prior && !sameValues(prior, r)) changed++;
    }
  }
  const [p, q] = [before.profile, after.profile];
  if (p && q && !sameValues(p as Snapshot, q as Snapshot)) changed++;
  return changed;
};

const isDeleted = (row: Snapshot | undefined): boolean =>
  typeof row?.deletedAt === "string" && row.deletedAt !== "";

export const diffSnapshots = (
  spec: Pick<KindSpec, "fields">,
  before: Snapshot,
  after: Snapshot,
  names: NameLookup,
): HistoryChange[] =>
  spec.fields.flatMap(([key, label, format]) => {
    const from = format(before[key], names);
    const to = format(after[key], names);
    return from === to ? [] : [{ label, from, to }];
  });

const actionOf = (op: string, before?: Snapshot, after?: Snapshot): HistoryAction => {
  if (op === "insert") return "added";
  if (op === "update") return "edited";
  if (op === "delete") return "removed";
  // A revert puts back whatever snapshot it was given; what it did shows in
  // the two snapshots.
  if (!before || (isDeleted(before) && !isDeleted(after))) return "restored";
  if (!isDeleted(before) && isDeleted(after)) return "removed";
  return "restored";
};

const verbOf = (action: HistoryAction, spec: KindSpec, changed: boolean): string => {
  if (action === "added") return "Added";
  if (action === "edited") return "Edited";
  if (action === "removed") return spec.archives ? "Archived" : "Deleted";
  // A restore that only changed values, on a record that was never gone.
  return changed ? "Reverted" : "Restored";
};

export function describeHistoryRow(row: HistoryRow, names: NameLookup): HistoryEntry {
  const at = parseHistoryTime(row.at);
  const before = parseSnapshot(row.beforeJson);
  const after = parseSnapshot(row.afterJson);
  const base = { id: row.id, at, recordId: row.entityId, changes: [], facts: [] };

  if (row.entity === IMPORT_ENTITY) {
    const added = countBundleRows(after) - countBundleRows(before);
    // A whole-state restore from this screen, or the Undo of one. The two
    // are stored the same way, so the words fit both.
    const fromHistory = row.entityId === HISTORY_RESTORE_REASON;
    const headline =
      row.entityId === "import-append"
        ? `Import added ${rows(Math.max(added, 0))}`
        : row.entityId === "import-update"
          ? `Import updated ${rows(countChangedRows(before, after))} and added ${rows(Math.max(added, 0))}`
          : fromHistory
            ? `Went back to an earlier state from History (${rows(countBundleRows(after))})`
            : row.entityId === BACKUP_RESTORE_REASON
              ? `Restored from ${backupName(after)} (${rows(countBundleRows(after))})`
              : `Import replaced everything (${rows(countBundleRows(after))})`;
    return {
      ...base,
      kind: IMPORT_KIND,
      kindLabel: HISTORY_KIND_LABELS[IMPORT_KIND]!,
      action: fromHistory ? "restored" : "imported",
      headline,
      facts:
        row.entityId === "import-append" || row.entityId === "import-update"
          ? []
          : [`${rows(countBundleRows(before))} before`],
      summary: headline,
    };
  }

  const spec = KINDS[row.entity];
  if (!spec) {
    const headline = "Changed a record of a type this screen does not know";
    return {
      ...base,
      kind: row.entity,
      kindLabel: "Other",
      action: actionOf(row.op, before, after),
      headline,
      summary: headline,
    };
  }

  const action = actionOf(row.op, before, after);
  // A removed record is named as it was; anything else as it is after.
  const shown = (action === "removed" ? before : after) ?? after ?? before ?? {};
  const valuesChanged =
    before && after && !isDeleted(before) === !isDeleted(after)
      ? diffSnapshots(spec, before, after, names)
      : [];
  const changes = action === "edited" || action === "restored" ? valuesChanged : [];
  const facts =
    changes.length > 0
      ? []
      : spec.fields
          .filter(([key]) => spec.facts.includes(key))
          .map(([key, label, format]) => [label, format(shown[key], names)] as const)
          .filter(([, value]) => value !== NONE)
          .map(([label, value]) => `${label}: ${value}`);

  const title = spec.title(shown, names);
  const verb = verbOf(action, spec, changes.length > 0);
  const headline = title === "" ? `${verb} ${spec.noun}` : `${verb} ${spec.noun}: ${title}`;
  const summary =
    changes.length === 0
      ? headline
      : `${headline}, ${changes.map((c) => `${c.label.toLowerCase()} ${c.from} → ${c.to}`).join(", ")}`;

  return {
    ...base,
    kind: row.entity,
    kindLabel: capitalize(spec.noun),
    action,
    headline,
    changes,
    facts,
    summary,
  };
}

/** The filter's "everything" choice. */
export const ALL = "all";

export const matchesFilter = (entry: HistoryEntry, kind: string, action: string): boolean =>
  (kind === ALL || entry.kind === kind) && (action === ALL || entry.action === action);

/** The record's name alone, for a dialog or a toast: "Demo software $99.00". */
export const snapshotTitle = (entity: string, row: Snapshot, names: NameLookup): string => {
  const spec = KINDS[entity];
  if (!spec) return "this record";
  const title = spec.title(row, names);
  return title === "" ? `the ${spec.noun}` : title;
};

export const snapshotNoun = (entity: string): string => KINDS[entity]?.noun ?? "record";

export const snapshotChanges = (
  entity: string,
  from: Snapshot,
  to: Snapshot,
  names: NameLookup,
): HistoryChange[] => {
  const spec = KINDS[entity];
  return spec ? diffSnapshots(spec, from, to, names) : [];
};

export const namesFromBundle = (bundle: Pick<Bundle, "clients" | "vehicles">): NameLookup => ({
  clients: Object.fromEntries(bundle.clients.map((c) => [c.id, c.name])),
  vehicles: Object.fromEntries(
    bundle.vehicles.map((v) => [
      v.id,
      join(v.year === null ? "" : String(v.year), v.make, v.model),
    ]),
  ),
});
