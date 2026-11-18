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

const { softDelete, revertTo, invalidate } = vi.hoisted(() => ({
  softDelete: vi.fn(async () => true),
  revertTo: vi.fn(async () => undefined),
  invalidate: vi.fn(),
}));

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({
  clientRepo: {
    list: async () => [],
    listIncludingDeleted: async () => [],
    create: vi.fn(),
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
    clients: [liveClient, archivedClient],
    income: [...pointsAt("c_live", 2), ...pointsAt("c_arch", 4)],
    timeEntries: pointsAt("c_live", 1),
    expenses: [],
  }),
  useRouter: () => ({ invalidate }),
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
});

describe("archiving a client", () => {
  it("asks first, naming the client and how many rows reference it", async () => {
    renderPage();
    fireEvent.click(within(rowFor("Demo Live Co")).getByRole("button", { name: "Archive" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Archive Demo Live Co?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("2 income rows and 1 time entry reference it.");
    expect(softDelete).not.toHaveBeenCalled();

    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Archive"]);
  });

  it("does nothing on Cancel", async () => {
    renderPage();
    fireEvent.click(within(rowFor("Demo Live Co")).getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("archives on confirm and offers Undo, which restores the exact row", async () => {
    renderPage();
    fireEvent.click(within(rowFor("Demo Live Co")).getByRole("button", { name: "Archive" }));
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
    expect(within(row).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Un-archive" }));
    await waitFor(() =>
      expect(revertTo).toHaveBeenCalledWith("c_arch", { ...archivedClient, deletedAt: null }),
    );
    expect(await screen.findByText("Demo Archived Co un-archived.")).toBeInTheDocument();
  });
});
