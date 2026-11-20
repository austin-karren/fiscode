import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Toaster, toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
const db = vi.hoisted(() => {
  const repo = () => ({
    softDelete: vi.fn(async (_id: string) => true),
    revertTo: vi.fn(async (_id: string, snapshot: unknown) => snapshot),
  });
  return {
    state: { history: [] as unknown[], bundle: {} as Record<string, unknown> },
    expenseRepo: repo(),
    clientRepo: repo(),
    other: repo(),
    profileRepo: {
      get: vi.fn(),
      revertTo: vi.fn(async (snapshot: unknown) => snapshot),
    },
    importBundle: vi.fn(async () => {}),
    invalidate: vi.fn(),
  };
});

vi.mock("@fiscode/db", () => ({
  historyRepo: { listAll: async () => db.state.history },
  buildBundle: async () => db.state.bundle,
  emptyBundle: () => ({ ...emptyBundle }),
  importBundle: db.importBundle,
  expenseRepo: db.expenseRepo,
  clientRepo: db.clientRepo,
  entityRepo: db.other,
  spouseRepo: db.other,
  incomeRepo: db.other,
  timeRepo: db.other,
  vehicleRepo: db.other,
  mileageRepo: db.other,
  homeOfficeRepo: db.other,
  retirementRepo: db.other,
  profileRepo: db.profileRepo,
}));

let loaderData: unknown;
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => loaderData,
  useRouter: () => ({ invalidate: db.invalidate }),
}));

import { Route } from "./history";

const HistoryPage = Route.options.component!;
const loader = Route.options.loader as unknown as () => Promise<unknown>;

const emptyBundle = {
  profile: undefined,
  entities: [],
  spouses: [],
  clients: [],
  income: [],
  timeEntries: [],
  vehicles: [],
  mileage: [],
  homeOffice: [],
  expenses: [],
  retirementContributions: [],
  history: [],
};

const stamps = { createdAt: "2026-11-02T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z" };
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
const client = {
  id: "client_1",
  name: "Demo Co",
  type: null,
  notes: null,
  defaultRateCents: null,
  defaultCommissionRate: null,
  deletedAt: null,
  ...stamps,
};

let n = 0;
const historyRow = (
  entity: string,
  op: string,
  before: unknown,
  after: unknown,
  entityId: string,
) => ({
  id: `history_${++n}`,
  entity,
  entityId,
  op,
  beforeJson: before === undefined ? null : JSON.stringify(before),
  afterJson: after === undefined ? null : JSON.stringify(after),
  // Stored oldest first; a minute apart.
  at: new Date(Date.UTC(2026, 10, 18, 21, n)).toISOString(),
});

const expenseAt = (amountCents: number, more: object = {}) => ({
  ...expense,
  amountCents,
  ...more,
});
const DELETED_AT = "2026-11-18T22:00:00.000Z";

async function show(history: unknown[], bundle: object) {
  db.state.history = history;
  db.state.bundle = { ...emptyBundle, ...bundle };
  loaderData = await loader();
  render(
    <>
      <HistoryPage />
      <Toaster />
    </>,
  );
}

// The list's own items; an edit's changes are a list inside one.
const entries = () => [...screen.getByRole("list", { name: "History" }).children] as HTMLElement[];
const entry = (headline: string) =>
  entries().find((li) => within(li).queryByText(headline) !== null)!;
const restoreButton = (headline: string) =>
  within(entry(headline)).queryByRole("button", { name: `Restore: ${headline}` });

async function confirmRestore(headline: string) {
  fireEvent.click(restoreButton(headline)!);
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
  return dialog;
}

beforeEach(() => {
  n = 0;
});

// Sonner's toast store outlives the Toaster: without dismissing, a later test
// sees an earlier test's Undo.
afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.clearAllMocks();
});

describe("history screen", () => {
  it("says so when there is no history", async () => {
    await show([], {});
    expect(screen.getByText("No history yet")).toBeInTheDocument();
  });

  it("lists entries newest first, in words, with local times", async () => {
    await show(
      [
        historyRow("expense", "insert", undefined, expenseAt(8950), "expense_1"),
        historyRow("expense", "update", expenseAt(8950), expenseAt(9900), "expense_1"),
        historyRow("client", "delete", client, { ...client, deletedAt: DELETED_AT }, "client_1"),
      ],
      { expenses: [expenseAt(9900)], clients: [{ ...client, deletedAt: DELETED_AT }] },
    );

    const heads = entries().map((li) => li.querySelector("p")!.textContent);
    expect(heads).toEqual([
      "Archived client: Demo Co",
      "Edited expense: Demo software $99.00",
      "Added expense: Demo software $89.50",
    ]);
    expect(
      within(entry("Edited expense: Demo software $99.00")).getByText(/\$89\.50/),
    ).toBeInTheDocument();
    expect(screen.getByText("3 entries")).toBeInTheDocument();

    const time = entries()[0]!.querySelector("time")!;
    expect(time).toHaveAttribute("datetime", "2026-11-18T21:03:00.000Z");
    expect(time.textContent).toBe(
      new Date("2026-11-18T21:03:00.000Z").toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    );
    expect(time.textContent).not.toContain("T21:03");
  });

  it("offers Restore only where there is an earlier state to go back to", async () => {
    await show(
      [
        historyRow("expense", "insert", undefined, expenseAt(8950), "expense_1"),
        historyRow("expense", "update", expenseAt(8950), expenseAt(9900), "expense_1"),
        historyRow(
          "profile",
          "update",
          { id: "profile", state: "UT" },
          { id: "profile", state: "CO" },
          "profile",
        ),
      ],
      { expenses: [expenseAt(9900)] },
    );
    expect(restoreButton("Added expense: Demo software $89.50")).toBeNull();
    expect(restoreButton("Edited expense: Demo software $99.00")).not.toBeNull();
    // There is no profile now, so there is nothing to put the old one onto.
    expect(restoreButton("Edited profile")).toBeNull();
  });

  it("does not offer Restore when the record is already in that state", async () => {
    await show([historyRow("expense", "update", expenseAt(8950), expenseAt(9900), "expense_1")], {
      expenses: [expenseAt(8950, { updatedAt: "2026-11-19T00:00:00.000Z" })],
    });
    expect(restoreButton("Edited expense: Demo software $99.00")).toBeNull();
  });
});

describe("restore from history", () => {
  it("brings back a deleted expense, and Undo deletes it again", async () => {
    const gone = expenseAt(8950, { deletedAt: DELETED_AT });
    await show([historyRow("expense", "delete", expenseAt(8950), gone, "expense_1")], {
      expenses: [gone],
    });

    const dialog = await confirmRestore("Deleted expense: Demo software $89.50");
    expect(dialog).toHaveTextContent("Bring back this expense?");
    expect(dialog).toHaveTextContent("This brings back the expense Demo software $89.50.");

    await waitFor(() => expect(db.expenseRepo.revertTo).toHaveBeenCalledTimes(1));
    expect(db.expenseRepo.revertTo).toHaveBeenCalledWith("expense_1", expenseAt(8950));
    await waitFor(() => expect(db.invalidate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Demo software $89.50 is back.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(db.expenseRepo.revertTo).toHaveBeenCalledTimes(2));
    expect(db.expenseRepo.revertTo).toHaveBeenLastCalledWith("expense_1", gone);
    await waitFor(() => expect(db.invalidate).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Restore undone.")).toBeInTheDocument();
  });

  it("reverts an edit to its previous values, saying what changes", async () => {
    await show([historyRow("expense", "update", expenseAt(8950), expenseAt(9900), "expense_1")], {
      expenses: [expenseAt(9900)],
    });

    const dialog = await confirmRestore("Edited expense: Demo software $99.00");
    expect(dialog).toHaveTextContent(
      "This puts Demo software $99.00 back to amount $89.50. The current values are replaced.",
    );
    // Nothing newer is lost, so it is not styled as destructive.
    expect(within(dialog).getByRole("button", { name: "Restore" }).className).not.toMatch(
      /text-destructive/,
    );

    await waitFor(() =>
      expect(db.expenseRepo.revertTo).toHaveBeenCalledWith("expense_1", expenseAt(8950)),
    );
    expect(await screen.findByText("Demo software $89.50 restored.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(db.expenseRepo.revertTo).toHaveBeenLastCalledWith("expense_1", expenseAt(9900)),
    );
  });

  it("warns, in the destructive style, when later changes would be lost", async () => {
    await show(
      [
        historyRow("expense", "update", expenseAt(8950), expenseAt(9900), "expense_1"),
        historyRow("expense", "update", expenseAt(9900), expenseAt(12000), "expense_1"),
      ],
      { expenses: [expenseAt(12000)] },
    );

    fireEvent.click(restoreButton("Edited expense: Demo software $99.00")!);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "This puts Demo software $120.00 back to amount $89.50. It was changed again after this entry; those later changes are replaced too.",
    );
    expect(within(dialog).getByRole("button", { name: "Restore" }).className).toMatch(
      /text-destructive/,
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(db.expenseRepo.revertTo).not.toHaveBeenCalled();
  });

  it("puts back a record an import removed, and Undo deletes it", async () => {
    await show([historyRow("expense", "update", expenseAt(8950), expenseAt(9900), "expense_1")], {
      expenses: [],
    });

    await confirmRestore("Edited expense: Demo software $99.00");
    await waitFor(() =>
      expect(db.expenseRepo.revertTo).toHaveBeenCalledWith("expense_1", expenseAt(8950)),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(db.expenseRepo.softDelete).toHaveBeenCalledWith("expense_1"));
  });

  it("does not offer to go back to before an import when that is the state now", async () => {
    const before = { ...emptyBundle, expenses: [expenseAt(8950)] };
    const after = { ...emptyBundle, expenses: [expenseAt(9900)] };
    await show([historyRow("__import_snapshot", "revert", before, after, "import-restore")], {
      // Same rows; only updatedAt has moved.
      expenses: [expenseAt(8950, { updatedAt: "2026-11-19T00:00:00.000Z" })],
    });
    expect(restoreButton("Import replaced everything (1 row)")).toBeNull();
  });

  it("restores an earlier profile, and Undo puts the current one back", async () => {
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
      priorYearTotalTaxCents: null,
      priorYearAgiCents: null,
      priorYearStateTaxCents: null,
      ...stamps,
    };
    const edited = { ...profile, filingStatus: "mfj" };
    await show([historyRow("profile", "update", profile, edited, "profile")], {
      profile: edited,
    });

    const dialog = await confirmRestore("Edited profile");
    expect(dialog).toHaveTextContent(
      "This puts the profile back to filing status Single. The current values are replaced.",
    );
    await waitFor(() => expect(db.profileRepo.revertTo).toHaveBeenCalledWith(profile));
    expect(await screen.findByText("Profile restored.")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(db.profileRepo.revertTo).toHaveBeenLastCalledWith(edited));
  });

  it("moves focus to the list after a restore, since its button is gone", async () => {
    await show([historyRow("expense", "update", expenseAt(8950), expenseAt(9900), "expense_1")], {
      expenses: [expenseAt(9900)],
    });

    await confirmRestore("Edited expense: Demo software $99.00");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("list", { name: "History" })).toHaveFocus());
  });

  it("gives focus back to Restore when the dialog is cancelled", async () => {
    await show([historyRow("expense", "update", expenseAt(8950), expenseAt(9900), "expense_1")], {
      expenses: [expenseAt(9900)],
    });
    const button = restoreButton("Edited expense: Demo software $99.00")!;
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole("alertdialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("goes back to before an import, and Undo returns to the state it left", async () => {
    const before = { ...emptyBundle, expenses: [expenseAt(8950)] };
    const after = { ...emptyBundle, expenses: [expenseAt(9900)], clients: [client] };
    const now = { expenses: [expenseAt(12000)], clients: [client] };
    await show([historyRow("__import_snapshot", "revert", before, after, "import-restore")], now);

    const dialog = await confirmRestore("Import replaced everything (2 rows)");
    expect(dialog).toHaveTextContent(
      "This puts everything back to how it was just before this import (1 row). Everything added or changed since then is replaced.",
    );

    await waitFor(() => expect(db.importBundle).toHaveBeenCalledTimes(1));
    expect(db.importBundle).toHaveBeenCalledWith(before, "history-restore");

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(db.importBundle).toHaveBeenCalledTimes(2));
    expect(db.importBundle).toHaveBeenLastCalledWith({ ...emptyBundle, ...now }, "history-restore");
  });

  it("says so and changes nothing more when a restore fails", async () => {
    db.expenseRepo.revertTo.mockRejectedValueOnce(new Error("demo failure"));
    await show([historyRow("expense", "update", expenseAt(8950), expenseAt(9900), "expense_1")], {
      expenses: [expenseAt(9900)],
    });

    await confirmRestore("Edited expense: Demo software $99.00");

    expect(await screen.findByText("Restore failed. Nothing was changed.")).toBeInTheDocument();
    expect(db.invalidate).not.toHaveBeenCalled();
  });

  it("says so when Undo of a record restore fails", async () => {
    const gone = expenseAt(8950, { deletedAt: DELETED_AT });
    await show([historyRow("expense", "delete", expenseAt(8950), gone, "expense_1")], {
      expenses: [gone],
    });
    await confirmRestore("Deleted expense: Demo software $89.50");
    await screen.findByText("Demo software $89.50 is back.");

    db.expenseRepo.revertTo.mockRejectedValueOnce(new Error("demo failure"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Undo failed. Nothing was changed.")).toBeInTheDocument();
    expect(screen.queryByText("Restore undone.")).not.toBeInTheDocument();
    expect(db.invalidate).toHaveBeenCalledTimes(1);
  });

  it("says so when Undo of going back to before an import fails", async () => {
    const before = { ...emptyBundle, expenses: [expenseAt(8950)] };
    const after = { ...emptyBundle, expenses: [expenseAt(9900)] };
    await show([historyRow("__import_snapshot", "revert", before, after, "import-restore")], {
      expenses: [expenseAt(12000)],
    });
    await confirmRestore("Import replaced everything (1 row)");
    await waitFor(() => expect(db.importBundle).toHaveBeenCalledTimes(1));

    db.importBundle.mockRejectedValueOnce(new Error("demo failure"));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Undo failed. Nothing was changed.")).toBeInTheDocument();
    expect(screen.queryByText("Restore undone.")).not.toBeInTheDocument();
  });
});
