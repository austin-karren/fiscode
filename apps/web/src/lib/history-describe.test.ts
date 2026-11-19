import type { HistoryRow } from "@fiscode/db";
import { describe, expect, it } from "vitest";

import {
  ALL,
  describeHistoryRow,
  formatHistoryTime,
  matchesFilter,
  parseHistoryTime,
  type NameLookup,
} from "./history-describe";

const names: NameLookup = {
  clients: { client_1: "Demo Co" },
  vehicles: { vehicle_1: "2020 Demo Wagon" },
};

const stamps = { createdAt: "2026-11-02T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z" };
const DELETED_AT = "2026-11-05T10:00:00.000Z";

const expense = {
  id: "expense_1",
  date: "2026-11-02",
  amountCents: 8950,
  category: "software_subs",
  clientId: null,
  description: "Demo software",
  reason: null,
  notes: null,
  flagForSection179: false,
  startupExpense: false,
  deletedAt: null,
  ...stamps,
};
const income = {
  id: "income_1",
  date: "2026-11-03",
  clientId: "client_1",
  amountCents: 150000,
  sourceType: "1099",
  kind: "consulting",
  description: "Demo consulting",
  notes: null,
  deletedAt: null,
  ...stamps,
};
const client = {
  id: "client_1",
  name: "Demo Co",
  type: "agency",
  notes: null,
  defaultRateCents: 12500,
  defaultCommissionRate: null,
  deletedAt: null,
  ...stamps,
};
const vehicle = {
  id: "vehicle_1",
  make: "Demo",
  model: "Wagon",
  year: 2020,
  mpg: 30,
  method: "standard_mileage",
  inServiceDate: null,
  notes: null,
  deletedAt: null,
  ...stamps,
};
const mileage = {
  id: "mileage_1",
  date: "2026-11-04",
  vehicleId: "vehicle_1",
  businessMiles: 120,
  purpose: "Client visit",
  notes: null,
  deletedAt: null,
  ...stamps,
};
const timeEntry = {
  id: "time_1",
  date: "2026-11-04",
  clientId: "client_1",
  minutes: 75,
  description: null,
  notes: null,
  deletedAt: null,
  ...stamps,
};
const profile = {
  id: "profile",
  filingStatus: "single",
  state: "UT",
  seStartDate: "2026-11-02",
  dependents: 0,
  tracksRoth: false,
  usesRetirement: false,
  quarterlyMethod: "annualized",
  prepLeadDays: 14,
  ...stamps,
};
const bundle = (expenses: unknown[], extra: Record<string, unknown> = {}) => ({
  profile,
  entities: [],
  spouses: [],
  clients: [client],
  income: [income],
  timeEntries: [],
  vehicles: [],
  mileage: [],
  homeOffice: [],
  expenses,
  retirementContributions: [],
  history: [],
  ...extra,
});

let n = 0;
const row = (
  entity: string,
  op: string,
  before: unknown,
  after: unknown,
  entityId = "record_1",
): HistoryRow => ({
  id: `history_${++n}`,
  entity,
  entityId,
  op,
  beforeJson: before === undefined ? null : JSON.stringify(before),
  afterJson: after === undefined ? null : JSON.stringify(after),
  at: "2026-11-18T21:04:05.000Z",
});

const deleted = <T extends object>(r: T) => ({ ...r, deletedAt: DELETED_AT });

describe("describeHistoryRow", () => {
  it.each<[string, HistoryRow, string, string]>([
    [
      "an added expense",
      row("expense", "insert", undefined, expense),
      "added",
      "Added expense: Demo software $89.50",
    ],
    [
      "an edited expense",
      row("expense", "update", expense, { ...expense, amountCents: 9900 }),
      "edited",
      "Edited expense: Demo software $99.00, amount $89.50 → $99.00",
    ],
    [
      "an edit of several fields",
      row("expense", "update", expense, {
        ...expense,
        category: "travel",
        description: null,
        flagForSection179: true,
      }),
      "edited",
      "Edited expense: Travel $89.50, category Software & subscriptions → Travel, description Demo software → none, section 179 candidate no → yes",
    ],
    [
      "a deleted income",
      row("income", "delete", income, deleted(income)),
      "removed",
      "Deleted income: Demo consulting $1,500.00",
    ],
    [
      "an income named by its client",
      row("income", "insert", undefined, { ...income, description: null }),
      "added",
      "Added income: Demo Co $1,500.00",
    ],
    [
      "an archived client",
      row("client", "delete", client, deleted(client)),
      "removed",
      "Archived client: Demo Co",
    ],
    [
      "an archived vehicle",
      row("vehicle", "delete", vehicle, deleted(vehicle)),
      "removed",
      "Archived vehicle: 2020 Demo Wagon",
    ],
    [
      "a restored expense",
      row("expense", "revert", deleted(expense), expense),
      "restored",
      "Restored expense: Demo software $89.50",
    ],
    [
      "a revert that deleted again (Undo of a restore)",
      row("expense", "revert", expense, deleted(expense)),
      "removed",
      "Deleted expense: Demo software $89.50",
    ],
    [
      "a revert of an edit",
      row("expense", "revert", { ...expense, amountCents: 9900 }, expense),
      "restored",
      "Reverted expense: Demo software $89.50, amount $99.00 → $89.50",
    ],
    [
      "a revert that put back a record that was gone",
      row("expense", "revert", undefined, expense),
      "restored",
      "Restored expense: Demo software $89.50",
    ],
    [
      "added mileage",
      row("mileage", "insert", undefined, mileage),
      "added",
      "Added mileage: 120 mi Client visit",
    ],
    [
      "an edited time entry",
      row("time_entry", "update", timeEntry, { ...timeEntry, minutes: 90 }),
      "edited",
      "Edited time entry: 1h 30m Demo Co, time 1h 15m → 1h 30m",
    ],
    [
      "an edited profile",
      row("profile", "update", profile, { ...profile, filingStatus: "mfj", dependents: 2 }),
      "edited",
      "Edited profile, filing status Single → Married filing jointly, dependents 0 → 2",
    ],
    [
      "an overwrite import",
      row(
        "__import_snapshot",
        "revert",
        bundle([expense]),
        bundle([expense, { ...expense, id: "expense_2" }]),
        "import-restore",
      ),
      "imported",
      "Import replaced everything (5 rows)",
    ],
    [
      "a whole-state restore from History, or its Undo",
      row("__import_snapshot", "revert", bundle([expense]), bundle([]), "history-restore"),
      "restored",
      "Went back to an earlier state from History (3 rows)",
    ],
    [
      "an overwrite import under its old name",
      row("__import_snapshot", "revert", bundle([]), bundle([expense]), "import-overwrite"),
      "imported",
      "Import replaced everything (4 rows)",
    ],
    [
      "an append import",
      row(
        "__import_snapshot",
        "revert",
        bundle([expense]),
        bundle([expense, { ...expense, id: "expense_2" }, { ...expense, id: "expense_3" }]),
        "import-append",
      ),
      "imported",
      "Import added 2 rows",
    ],
    [
      "a table it does not know",
      row("mystery_table", "update", { id: "x" }, { id: "x" }),
      "edited",
      "Changed a record of a type this screen does not know",
    ],
  ])("describes %s", (_name, historyRow, action, summary) => {
    const entry = describeHistoryRow(historyRow, names);
    expect(entry.action).toBe(action);
    expect(entry.summary).toBe(summary);
  });

  it("never puts a raw id, table name or op code in what is read", () => {
    const rows = [
      row("time_entry", "update", timeEntry, { ...timeEntry, minutes: 90 }, "time_1"),
      row("income", "delete", income, deleted(income), "income_1"),
      row("mileage", "insert", undefined, mileage, "mileage_1"),
      row("__import_snapshot", "revert", bundle([]), bundle([expense]), "import-restore"),
    ];
    for (const historyRow of rows) {
      const entry = describeHistoryRow(historyRow, names);
      const read = [entry.summary, entry.kindLabel, ...entry.facts].join(" | ");
      expect(read).not.toMatch(/time_entry|__import_snapshot|import-restore|client_1|vehicle_1/);
      expect(read).not.toMatch(/\b(insert|update|delete|revert)\b/);
    }
  });

  it("lists the main fields of a record that was not edited", () => {
    const entry = describeHistoryRow(row("income", "delete", income, deleted(income)), names);
    expect(entry.changes).toEqual([]);
    expect(entry.facts).toEqual(["Date: Nov 3, 2026", "Client: Demo Co", "Kind: Consulting"]);
  });

  it("lists old and new values of an edit, with labels for codes", () => {
    const entry = describeHistoryRow(
      row("expense", "update", expense, { ...expense, category: "travel", clientId: "client_1" }),
      names,
    );
    expect(entry.facts).toEqual([]);
    expect(entry.changes).toEqual([
      { label: "Category", from: "Software & subscriptions", to: "Travel" },
      { label: "Client", from: "none", to: "Demo Co" },
    ]);
  });

  it("says so when a record points at a client that is gone", () => {
    const entry = describeHistoryRow(
      row("income", "insert", undefined, { ...income, description: null, clientId: "client_9" }),
      names,
    );
    expect(entry.summary).toBe("Added income: a client no longer here $1,500.00");
  });

  it("survives a snapshot that is not JSON", () => {
    const broken = { ...row("expense", "update", expense, expense), afterJson: "{nope" };
    expect(describeHistoryRow(broken, names).summary).toBe("Edited expense: Demo software $89.50");
  });
});

describe("history time", () => {
  it("reads an ISO stamp and SQLite's own UTC stamp as the same instant", () => {
    expect(parseHistoryTime("2026-11-18T21:04:05.000Z").getTime()).toBe(
      parseHistoryTime("2026-11-18 21:04:05").getTime(),
    );
  });

  it("shows local time, not the UTC text", () => {
    const at = new Date(2026, 10, 18, 14, 4);
    expect(formatHistoryTime(at)).toBe("Nov 18, 2026, 2:04 PM");
  });
});

describe("matchesFilter", () => {
  const edited = describeHistoryRow(
    row("expense", "update", expense, { ...expense, amountCents: 9900 }),
    names,
  );
  const archived = describeHistoryRow(row("client", "delete", client, deleted(client)), names);

  it.each([
    [ALL, ALL, [true, true]],
    ["expense", ALL, [true, false]],
    [ALL, "removed", [false, true]],
    ["client", "removed", [false, true]],
    ["client", "edited", [false, false]],
  ])("record %s and action %s", (kind, action, expected) => {
    expect([edited, archived].map((e) => matchesFilter(e, kind, action))).toEqual(expected);
  });
});
