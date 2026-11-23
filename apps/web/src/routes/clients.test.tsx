import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

// Demo data: one live client that rows point at, one archived client.
const liveClient = {
  id: "c_live",
  name: "Demo Live Co",
  type: "consulting",
  notes: null,
  defaultRateCents: null,
  defaultCommissionRate: null,
  deletedAt: null,
};
const archivedClient = {
  ...liveClient,
  id: "c_arch",
  name: "Demo Archived Co",
  deletedAt: "2026-02-01T00:00:00.000Z",
};
const pointsAt = (clientId: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${clientId}_${i}`, clientId }));

const { create, softDelete, revertTo, invalidate, loaded } = vi.hoisted(() => ({
  create: vi.fn(async () => undefined),
  // A test sets `loaded.clients` to load something other than the default pair.
  loaded: { clients: undefined as unknown[] | undefined },
  softDelete: vi.fn(async () => true),
  revertTo: vi.fn(async () => undefined),
  invalidate: vi.fn(),
}));

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({
  documentLinkRepo: { forRecord: async () => [], countsFor: async () => ({}) },
  clientRepo: {
    list: async () => [],
    listIncludingDeleted: async () => [],
    create,
    update: vi.fn(),
    softDelete,
    revertTo,
  },
  incomeRepo: { list: async () => [] },
  timeRepo: { list: async () => [] },
  expenseRepo: { list: async () => [] },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({
    linkCounts: { c_live: 2 },
    clients: loaded.clients ?? [liveClient, archivedClient],
    income: [...pointsAt("c_live", 2), ...pointsAt("c_arch", 4)],
    timeEntries: pointsAt("c_live", 1),
    expenses: [],
  }),
  useRouter: () => ({ invalidate }),
  useLocation: () => "",
}));

import { Route } from "./clients";

const ClientsPage = Route.options.component!;

const renderPage = () =>
  render(
    <>
      <ClientsPage />
      <Toaster />
    </>,
  );

const rowFor = (text: string) => screen.getByText(text).closest("tr")!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  loaded.clients = undefined;
});

describe("archiving a client", () => {
  it("asks first, naming the client and how many rows reference it", async () => {
    renderPage();
    fireEvent.click(
      within(rowFor("Demo Live Co")).getByRole("button", { name: "Archive client Demo Live Co" }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Archive Demo Live Co?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("2 income rows and 1 time entry reference it.");
    expect(dialog).toHaveTextContent("2 linked documents stay in Documents.");
    expect(softDelete).not.toHaveBeenCalled();

    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Archive"]);
  });

  it("does nothing on Cancel", async () => {
    renderPage();
    fireEvent.click(
      within(rowFor("Demo Live Co")).getByRole("button", { name: "Archive client Demo Live Co" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("archives on confirm and offers Undo, which restores the exact row", async () => {
    renderPage();
    fireEvent.click(
      within(rowFor("Demo Live Co")).getByRole("button", { name: "Archive client Demo Live Co" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(softDelete).toHaveBeenCalledWith("c_live"));
    expect(await screen.findByText("Demo Live Co archived.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(revertTo).toHaveBeenCalledWith("c_live", liveClient));
  });
});

describe("archived clients", () => {
  it("are hidden until asked for", () => {
    renderPage();
    expect(screen.queryByText("Demo Archived Co")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show archived (1)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("can be shown and un-archived", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Show archived (1)" }));

    const row = rowFor("Demo Archived Co");
    expect(within(row).getByText("· archived")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /^Archive\b/ })).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Un-archive" }));
    await waitFor(() =>
      expect(revertTo).toHaveBeenCalledWith("c_arch", { ...archivedClient, deletedAt: null }),
    );
    expect(await screen.findByText("Demo Archived Co un-archived.")).toBeInTheDocument();
  });

  it("says so when every client is archived, and points at Show archived", () => {
    loaded.clients = [archivedClient];
    renderPage();
    expect(screen.getByText("No active clients")).toBeInTheDocument();
    expect(screen.getByText(/Show archived/, { selector: "p, div" })).toBeInTheDocument();
    expect(screen.queryByText("No clients yet")).not.toBeInTheDocument();
  });
});

describe("client default rate", () => {
  const submit = (rate: string) => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Demo New Co" } });
    const input = screen.getByLabelText("Default rate (optional)");
    fireEvent.change(input, { target: { value: rate } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    return input;
  };

  it("does not save a non-numeric rate as empty", async () => {
    const input = submit("abc");
    expect(await screen.findByText("Enter an amount, like 12.50")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(create).not.toHaveBeenCalled();
  });

  it("saves a blank rate as none and a plain rate in cents", async () => {
    submit("");
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ defaultRateCents: null })),
    );
    cleanup();
    create.mockClear();
    submit("150");
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ defaultRateCents: 15000 })),
    );
  });
});
