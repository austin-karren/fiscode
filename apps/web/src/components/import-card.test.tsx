import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { emptyBundle, exportBundle, type Bundle } from "@fiscode/csv";
import { afterEach, describe, expect, it, vi } from "vitest";

// SQLite over OPFS and the router do not exist in jsdom; both are replaced at
// the package boundary. The CSV package is the real one.
const { buildBundle, importBundle, invalidate } = vi.hoisted(() => ({
  buildBundle: vi.fn(),
  importBundle: vi.fn(),
  invalidate: vi.fn(async () => {}),
}));

vi.mock("@fiscode/db", () => ({ buildBundle, importBundle }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ invalidate }),
}));

import { ImportCard } from "./import-card";

const FIXED = "2026-06-04T12:00:00.000Z";

const profile = () => ({
  id: "profile",
  filingStatus: "single",
  state: "UT",
  seStartDate: "2024-01-01",
  dependents: 0,
  tracksRoth: false,
  usesRetirement: false,
  quarterlyMethod: "annualized",
  prepLeadDays: 14,
  priorYearTotalTaxCents: null,
  priorYearAgiCents: null,
  priorYearStateTaxCents: null,
  priorYearFiguresYear: null,
  priorYearNotFiled: null,
  createdAt: FIXED,
  updatedAt: FIXED,
});

const income = (id: string, date: string, deletedAt: string | null = null) => ({
  id,
  date,
  clientId: null,
  amountCents: 100_00,
  sourceType: "1099",
  kind: "recurring",
  description: null,
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt,
});

/** Three live rows (profile + two income), one deleted row, one history entry. */
const backup = (): Bundle => ({
  ...emptyBundle(),
  profile: profile(),
  income: [
    income("in_2025", "2025-03-01"),
    income("in_2026", "2026-03-01"),
    income("in_gone", "2026-04-01", FIXED),
  ],
  history: [
    {
      id: "h_1",
      entity: "income",
      entityId: "in_gone",
      op: "delete",
      beforeJson: "{}",
      afterJson: null,
      at: FIXED,
    },
  ],
});

/** What is in the app: the profile, one row the file also has, one it has not. */
const appState = (): Bundle => ({
  ...emptyBundle(),
  profile: profile(),
  income: [income("in_2026", "2026-03-01"), income("in_only_here", "2026-05-01")],
});

// The file input is hidden (the button opens it), so it has no accessible name.
const choose = (text: string, name = "picked.csv") => {
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File([text], name, { type: "text/csv" })] },
  });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("import card: files that are refused", () => {
  it("refuses a file that is not a fiscode file, in the card, and offers no import", async () => {
    render(<ImportCard />);
    choose("hello world", "notes.csv");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This is not a fiscode file. Nothing was imported.");
    expect(alert).toHaveTextContent("notes.csv");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(buildBundle).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("refuses a file with no rows instead of offering to replace with 0 rows", async () => {
    render(<ImportCard />);
    choose(exportBundle(emptyBundle(), { scope: "full" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This file has no rows.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists rejected rows with row number and reason, the first ten and a count", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `income,1/${i + 1}/2026,10.00,in_${i}`);
    render(<ImportCard />);
    choose(["record_type,date,amount,id", ...rows].join("\r\n"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nothing was imported. 12 rows need fixing.");
    expect(within(alert).getAllByRole("listitem")).toHaveLength(11);
    expect(alert).toHaveTextContent(
      'Row 2 (income): date: Expected a date as YYYY-MM-DD, got "1/1/2026"',
    );
    expect(alert).toHaveTextContent("…and 2 more.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus to the refusal, so it is not missed below the fold", async () => {
    render(<ImportCard />);
    choose("hello world");
    const first = await screen.findByRole("alert");
    expect(first).toHaveFocus();

    // The same file again is a new refusal and is brought into view again.
    (document.activeElement as HTMLElement).blur();
    choose("hello world");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });

  it("keeps the file input away from assistive tech; the button is the control", () => {
    render(<ImportCard />);
    expect(document.querySelector('input[type="file"]')).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Choose a CSV file" })).toBeInTheDocument();
  });

  it("refuses a file that uses one id twice, naming both rows", async () => {
    render(<ImportCard />);
    choose(
      [
        "record_type,date,category,amount,id",
        "expense,2026-01-15,supplies,120.00,ex_new",
        "expense,2026-01-16,supplies,999.00,ex_new",
      ].join("\r\n"),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nothing was imported. 1 row needs fixing.");
    expect(alert).toHaveTextContent('Row 3 (expense): id: "ex_new" is also used on row 2.');
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("clears the refusal when a good file is picked next", async () => {
    buildBundle.mockResolvedValue(emptyBundle());
    render(<ImportCard />);
    choose("hello world");
    await screen.findByRole("alert");

    choose(exportBundle(backup(), { scope: "full" }));
    await screen.findByRole("dialog");
    expect(screen.queryByText(/not a fiscode file/)).not.toBeInTheDocument();
  });
});

describe("import card: an empty app", () => {
  it("asks no mode question and restores without a snapshot reason other than restore", async () => {
    buildBundle.mockResolvedValue(emptyBundle());
    importBundle.mockResolvedValue(undefined);
    const onImported = vi.fn();
    render(<ImportCard variant="setup" onImported={onImported} />);
    choose(exportBundle(backup(), { scope: "full" }), "backup.csv");

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Restore this backup?");
    expect(dialog).toHaveTextContent("backup.csv holds 3 rows, 1 deleted row and 1 history entry.");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("3 rows will show in the app.");
    expect(dialog).toHaveTextContent("1 deleted row will be restored as deleted.");
    expect(dialog).toHaveTextContent("The app is empty, so nothing is replaced.");
    expect(dialog).toHaveTextContent("1 history entry will be restored.");

    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(importBundle).toHaveBeenCalledWith(backup(), "import-restore");
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("import card: an app that holds data", () => {
  it("picks no mode for the user, then says in numbers what each one does", async () => {
    buildBundle.mockResolvedValue(appState());
    render(<ImportCard />);
    choose(exportBundle(backup(), { scope: "full" }));

    const dialog = await screen.findByRole("dialog");
    expect(buildBundle).toHaveBeenCalledWith({ includeDeleted: true, includeHistory: true });
    for (const radio of within(dialog).getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
    expect(within(dialog).getByRole("button", { name: "Choose an option" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("radio", { name: /Restore/ }));
    expect(dialog).toHaveTextContent("3 rows will show in the app.");
    expect(dialog).toHaveTextContent("1 deleted row will be restored as deleted.");
    expect(dialog).toHaveTextContent("Everything here now is replaced: 3 rows and 0 deleted rows.");
    expect(dialog).toHaveTextContent(
      "1 row here is not in the file and will be gone (1 visible, 0 deleted).",
    );
    expect(dialog).toHaveTextContent(
      "History: 0 history entries here are kept, 1 from the file is added, and 1 new entry records the state before this import.",
    );

    fireEvent.click(within(dialog).getByRole("radio", { name: /Add rows/ }));
    expect(dialog).toHaveTextContent("1 row will be added and show in the app.");
    expect(dialog).toHaveTextContent("1 deleted row will be added as deleted.");
    expect(dialog).toHaveTextContent("2 rows in the file are already here and will be skipped.");
    expect(dialog).toHaveTextContent("Nothing here is removed: 3 rows and 0 deleted rows stay.");
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("refuses Restore for a yearly file and names what would be lost", async () => {
    buildBundle.mockResolvedValue(backup());
    render(<ImportCard />);
    choose(exportBundle(backup(), { scope: "yearly", year: 2026 }), "fiscode-2026-tax-year.csv");

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("It is a yearly file for 2026, not a full backup.");
    const restore = within(dialog).getByRole("radio", { name: /Restore/ });
    expect(restore).toHaveAttribute("aria-disabled", "true");
    expect(dialog).toHaveTextContent(
      "Restoring from it would remove 2 rows that are here and not in the file.",
    );
    // A yearly file over data is an accountant's amended file: Update rows is the mode for it.
    expect(within(dialog).getByRole("radio", { name: /Update rows/ })).toBeChecked();
  });

  it("holds the button until the import commits", async () => {
    buildBundle.mockResolvedValue(appState());
    let commit!: () => void;
    importBundle.mockReturnValue(new Promise<void>((resolve) => (commit = resolve)));
    render(<ImportCard />);
    choose(exportBundle(backup(), { scope: "full" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Restore/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));

    const busy = await within(dialog).findByRole("button", { name: "Restoring…" });
    expect(busy).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(invalidate).not.toHaveBeenCalled();

    commit();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("runs one import when confirm fires several times before the first render", async () => {
    buildBundle.mockResolvedValue(appState());
    let commit!: () => void;
    importBundle.mockReturnValue(new Promise<void>((resolve) => (commit = resolve)));
    render(<ImportCard />);
    choose(exportBundle(backup(), { scope: "full" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Restore/ }));
    const button = within(dialog).getByRole("button", { name: "Restore" });

    // Three native clicks in one task: React has not re-rendered in between.
    button.click();
    button.click();
    button.click();

    await within(dialog).findByRole("button", { name: "Restoring…" });
    expect(importBundle).toHaveBeenCalledTimes(1);
    commit();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers nothing to do when every row of the file is already here", async () => {
    buildBundle.mockResolvedValue(backup());
    render(<ImportCard />);
    choose(exportBundle(backup(), { scope: "yearly", year: 2026 }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Add rows/ }));
    expect(dialog).toHaveTextContent(
      "Nothing would be added: every row in the file is already here.",
    );
    expect(within(dialog).getByRole("button", { name: "Add rows" })).toBeDisabled();
  });

  it("says nothing changed when the import fails, and keeps the dialog open", async () => {
    buildBundle.mockResolvedValue(appState());
    importBundle.mockRejectedValue(new Error("UNIQUE constraint failed: income.id"));
    const onImported = vi.fn();
    render(<ImportCard onImported={onImported} />);
    choose(exportBundle(backup(), { scope: "full" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Add rows/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add rows" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("The import failed. Nothing was changed.");
    expect(alert).toHaveTextContent("UNIQUE constraint failed: income.id");
    expect(onImported).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Add rows" })).toBeEnabled();
  });
});

describe("import card: Update rows", () => {
  const amended = (): Bundle => {
    const b = backup();
    b.income[1] = { ...b.income[1]!, amountCents: 999_00 }; // in_2026: changed
    b.income.push(income("in_new", "2026-08-01")); // added
    return b;
  };

  it("says in numbers what changes, what is added, what stays, and that nothing is removed", async () => {
    // Here: in_2025 deleted, in_2026 live, in_gone live. The file has in_gone deleted.
    const here = backup();
    here.income[0] = { ...here.income[0]!, deletedAt: FIXED };
    here.income[2] = { ...here.income[2]!, deletedAt: null };
    buildBundle.mockResolvedValue(here);
    render(<ImportCard />);
    choose(exportBundle(amended(), { scope: "full" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Update rows/ }));

    expect(dialog).toHaveTextContent("1 row here will take the file's values.");
    expect(dialog).toHaveTextContent("1 row will be added and show in the app.");
    expect(dialog).toHaveTextContent("1 row in the file is the same as here and stays as it is.");
    expect(dialog).toHaveTextContent("1 row deleted here is in the file. It stays deleted.");
    expect(dialog).toHaveTextContent(
      "1 row the file marks deleted is live here. It stays as it is: Update rows never removes a row.",
    );
    expect(dialog).toHaveTextContent("Nothing here is removed: 3 rows and 1 deleted row stay.");
  });

  it("writes with the import-update reason and names the counts in the toast", async () => {
    buildBundle.mockResolvedValue(backup());
    importBundle.mockResolvedValue(undefined);
    render(<ImportCard />);
    choose(exportBundle(amended(), { scope: "full" }), "amended.csv");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Update rows/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Update rows" }));

    await waitFor(() => expect(importBundle).toHaveBeenCalledTimes(1));
    const [written, reason] = importBundle.mock.calls[0]!;
    expect(reason).toBe("import-update");
    expect((written as Bundle).income.find((i) => i.id === "in_2026")!.amountCents).toBe(999_00);
    expect((written as Bundle).income).toHaveLength(4);
  });

  it("offers nothing to do when the file matches what is here", async () => {
    buildBundle.mockResolvedValue(backup());
    render(<ImportCard />);
    choose(exportBundle(backup(), { scope: "full" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Update rows/ }));
    expect(dialog).toHaveTextContent(
      "Nothing would change: every row in the file is already here with the same values.",
    );
    expect(within(dialog).getByRole("button", { name: "Update rows" })).toBeDisabled();
  });
});

describe("import card: warnings for Add rows and Update rows", () => {
  const withBadRows = (): Bundle => {
    const b = backup();
    b.income[1] = { ...b.income[1]!, amountCents: -45_00 };
    b.mileage = [
      {
        id: "mi_neg",
        date: "2026-03-02",
        vehicleId: null,
        purpose: "Demo trip",
        businessMiles: -12,
        notes: null,
        createdAt: FIXED,
        updatedAt: FIXED,
        deletedAt: null,
      },
    ];
    b.entities = [
      {
        id: "ent_file",
        type: "sole_prop",
        startDate: "2026-06-01",
        endDate: null,
        notes: null,
        createdAt: FIXED,
        updatedAt: FIXED,
        deletedAt: null,
      },
    ];
    return b;
  };
  const hereWithPeriod = (): Bundle => ({
    ...backup(),
    entities: [
      {
        id: "ent_here",
        type: "sole_prop",
        startDate: "2026-01-01",
        endDate: null,
        notes: null,
        createdAt: FIXED,
        updatedAt: FIXED,
        deletedAt: null,
      },
    ],
  });

  it("lists negative amounts and negative miles with their rows, and the overlapping periods", async () => {
    buildBundle.mockResolvedValue(hereWithPeriod());
    render(<ImportCard />);
    const csv = exportBundle(withBadRows(), { scope: "full" });
    choose(csv);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Update rows/ }));

    const warning = within(dialog).getByRole("alert", { name: /forms would not accept/ });
    expect(warning).toHaveTextContent(/negative amounts, negative miles/);
    const incomeLine = csv.split("\r\n").findIndex((l) => l.includes(",-45.00,")) + 1;
    expect(warning).toHaveTextContent(
      `Row ${incomeLine} (income): amount -$45.00 is negative. The form needs more than $0.`,
    );
    expect(warning).toHaveTextContent(
      /\(mileage\): business_miles -12 is negative\. The form needs 1 to 9,999\./,
    );
    expect(
      within(dialog).getByRole("alert", { name: /Entity periods would overlap/ }),
    ).toHaveTextContent(
      "The file's Sole proprietor period that started Jun 1, 2026 and is still open overlaps your Sole proprietor period that started Jan 1, 2026 and is still open.",
    );
    // Warnings do not block.
    expect(within(dialog).getByRole("button", { name: "Update rows" })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("radio", { name: /Add rows/ }));
    expect(within(dialog).getByRole("alert", { name: /forms would not accept/ })).toHaveTextContent(
      /\(mileage\): business_miles -12/,
    );

    fireEvent.click(within(dialog).getByRole("radio", { name: /Restore/ }));
    expect(within(dialog).queryByRole("alert", { name: /forms would not accept/ })).toBeNull();
    expect(
      within(dialog).queryByRole("alert", { name: /Entity periods would overlap/ }),
    ).toBeNull();
  });
});

describe("import card: Update rows with an older-format file (review #78 r1)", () => {
  it("writes only the columns the file has: a v3 file keeps the prior-year figures here", async () => {
    const here: Bundle = {
      ...backup(),
      profile: {
        ...backup().profile!,
        priorYearTotalTaxCents: 3_000_00,
        priorYearAgiCents: 100_000_00,
        priorYearStateTaxCents: 500_00,
        priorYearFiguresYear: 2025,
      },
    };
    buildBundle.mockResolvedValue(here);
    importBundle.mockResolvedValue(undefined);
    // The same data as a v3 file: no prior-year columns, and one amount changed.
    const v3 = exportBundle(
      {
        ...here,
        income: here.income.map((i) => (i.id === "in_2026" ? { ...i, amountCents: 999_00 } : i)),
      },
      { scope: "full" },
    ).replace("schema: v5", "schema: v3");

    const dropped = dropColumns(v3, [
      "prior_year_total_tax",
      "prior_year_agi",
      "prior_year_state_tax",
      "prior_year_figures_year",
      "prior_year_not_filed",
    ]);
    render(<ImportCard />);
    choose(dropped, "amended-v3.csv");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Update rows/ }));
    expect(dialog).toHaveTextContent("1 row here will take the file's values.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Update rows" }));

    await waitFor(() => expect(importBundle).toHaveBeenCalledTimes(1));
    const written = importBundle.mock.calls[0]![0] as Bundle;
    expect(written.profile).toEqual(here.profile);
    expect(written.income.find((i) => i.id === "in_2026")!.amountCents).toBe(999_00);
  });
});

/** Remove columns by header name from every table of a CSV (cells here have no commas). */
const dropColumns = (csv: string, names: string[]): string => {
  let cut: number[] = [];
  return csv
    .split("\r\n")
    .map((l) => {
      if (l.startsWith("record_type,")) {
        const cols = l.split(",");
        cut = names.map((n) => cols.indexOf(n)).filter((i) => i >= 0);
        return cols.filter((_, i) => !cut.includes(i)).join(",");
      }
      if (l === "" || l.startsWith("#") || l.startsWith("﻿#")) return l;
      return l
        .split(",")
        .filter((_, i) => !cut.includes(i))
        .join(",");
    })
    .join("\r\n");
};
