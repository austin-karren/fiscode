import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoRawValues } from "../test/raw-values";

// Demo data. "Demo Archived Co" was archived after the first row was logged.
const liveClient = { id: "c_live", name: "Demo Live Co", deletedAt: null };
const archivedClient = {
  id: "c_arch",
  name: "Demo Archived Co",
  deletedAt: "2026-02-01T00:00:00.000Z",
};
const rowForArchived = {
  id: "inc_1",
  date: "2026-01-15",
  amountCents: 120000,
  clientId: "c_arch",
  sourceType: "1099",
  kind: "consulting",
  description: "Demo consulting",
  notes: null,
  deletedAt: null,
};
const rowForLive = { ...rowForArchived, id: "inc_2", date: "2026-03-01", clientId: "c_live" };

const { create, update, softDelete, revertTo, invalidate } = vi.hoisted(() => ({
  create: vi.fn(async () => undefined),
  update: vi.fn(async () => undefined),
  softDelete: vi.fn(async () => true),
  revertTo: vi.fn(async () => undefined),
  invalidate: vi.fn(),
}));

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({
  incomeRepo: { list: async () => [], create, update, softDelete, revertTo },
  clientRepo: { list: async () => [], listIncludingDeleted: async () => [] },
  profileRepo: { get: async () => null },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({
    income: [rowForArchived, rowForLive],
    clients: [liveClient, archivedClient],
    profile: null,
  }),
  useRouter: () => ({ invalidate }),
}));

import { Route } from "./income";

const IncomePage = Route.options.component!;

const renderPage = () =>
  render(
    <>
      <IncomePage />
      <Toaster />
    </>,
  );

const rowFor = (text: string) => screen.getByText(text).closest("tr")!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("income table text", () => {
  it("shows dates and kinds as words, never stored values", () => {
    renderPage();
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Jan 15, 2026");
    expect(table).toHaveTextContent("Consulting");
    expectNoRawValues(table);
  });
});

describe("income list with an archived client", () => {
  it("keeps showing the archived client's name, marked as archived", () => {
    renderPage();
    const archivedRow = rowFor("Demo Archived Co");
    expect(within(archivedRow).getByText("· archived")).toBeInTheDocument();
    expect(within(rowFor("Demo Live Co")).queryByText("· archived")).not.toBeInTheDocument();
  });

  it("keeps the client link when such a row is edited and saved", async () => {
    renderPage();
    fireEvent.click(within(rowFor("Demo Archived Co")).getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Client")).toHaveTextContent(
      "Demo Archived Co (archived)",
    );
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "Demo consulting, edited" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(
      "inc_1",
      expect.objectContaining({ clientId: "c_arch", description: "Demo consulting, edited" }),
    );
  });

  it("does not offer an archived client for a new entry", async () => {
    renderPage();
    fireEvent.click(screen.getByLabelText("Client"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Demo Live Co" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: /Demo Archived Co/ })).toBeNull();
  });
});

describe("income row delete", () => {
  it("deletes at once with no dialog, and Undo restores the exact row", async () => {
    renderPage();
    fireEvent.click(within(rowFor("Demo Live Co")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(softDelete).toHaveBeenCalledWith("inc_2"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Income entry deleted.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(revertTo).toHaveBeenCalledWith("inc_2", rowForLive));
  });
});

describe("adding a run of entries", () => {
  const addCard = () => screen.getByText("Add entry").closest("[data-slot=card]") as HTMLElement;

  it("Duplicate fills the add form with that row, and focuses its date", async () => {
    renderPage();
    fireEvent.click(within(rowFor("Mar 1, 2026")).getByRole("button", { name: "Duplicate" }));

    const card = within(addCard());
    expect(card.getByLabelText("Amount")).toHaveValue("1200.00");
    expect(card.getByLabelText("Description")).toHaveValue("Demo consulting");
    expect(card.getByRole("combobox", { name: "Client" })).toHaveTextContent("Demo Live Co");
    expect(card.getByLabelText("Date")).toHaveTextContent("Mar 1, 2026");
    await waitFor(() => expect(card.getByLabelText("Date")).toHaveFocus());
  });

  it("Duplicate leaves out a client that has been archived", () => {
    renderPage();
    fireEvent.click(within(rowFor("Jan 15, 2026")).getByRole("button", { name: "Duplicate" }));
    expect(within(addCard()).getByRole("combobox", { name: "Client" })).not.toHaveTextContent(
      "Demo Archived Co",
    );
  });

  it("after Add, keeps the date and client, clears the rest, and focuses Amount", async () => {
    renderPage();
    fireEvent.click(within(rowFor("Mar 1, 2026")).getByRole("button", { name: "Duplicate" }));
    fireEvent.click(within(addCard()).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-03-01", clientId: "c_live", amountCents: 120000 }),
    );
    const card = within(addCard());
    await waitFor(() => expect(card.getByLabelText("Amount")).toHaveValue(""));
    expect(card.getByLabelText("Description")).toHaveValue("");
    expect(card.getByLabelText("Date")).toHaveTextContent("Mar 1, 2026");
    expect(card.getByRole("combobox", { name: "Client" })).toHaveTextContent("Demo Live Co");
    await waitFor(() => expect(card.getByLabelText("Amount")).toHaveFocus());
  });
});
