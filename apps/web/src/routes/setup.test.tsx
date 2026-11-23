import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
const { upsert, create, list, navigate, buildBundle, importBundle } = vi.hoisted(() => ({
  list: vi.fn(async (): Promise<unknown[]> => []),
  upsert: vi.fn(async () => {}),
  create: vi.fn(async () => {}),
  navigate: vi.fn(),
  buildBundle: vi.fn(),
  importBundle: vi.fn(async () => {}),
}));

vi.mock("@fiscode/db", () => ({
  // The vault migration is done: every write is on (vault PR 9).
  getVaultMigrationState: (
    (done) => () =>
      done
  )({ phase: "done" }),
  onVaultMigrationState: () => () => {},

  profileRepo: { exists: async () => false, upsert },
  entityRepo: { create, list },
  buildBundle,
  importBundle,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate: async () => {} }),
}));

import { emptyBundle, exampleBundle, exportBundle } from "@fiscode/csv";

import { Route } from "./setup";

const SetupPage = Route.options.component!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const field = (label: string) => screen.getByLabelText(label);

const submitButton = () => screen.getByRole("button", { name: "Save and continue" });

const pickOption = async (label: string, option: string) => {
  fireEvent.click(field(label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
  // The open popup hides the rest of the page from the accessibility tree.
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
};

const fillEveryField = async () => {
  await pickOption("Filing status", "Single");

  const state = field("State of residence");
  fireEvent.change(state, { target: { value: "Utah" } });
  fireEvent.keyDown(state, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: /Utah/ }));

  fireEvent.click(field("Self-employment start date"));
  const grid = await screen.findByRole("grid");
  const day = within(grid)
    .getAllByRole("button")
    .find((b) => !(b as HTMLButtonElement).disabled)!;
  fireEvent.click(day);

  await pickOption("Entity type", "Sole proprietor");
};

describe("setup form", () => {
  it("names a field with an info tooltip by its label alone", () => {
    render(<SetupPage />);
    expect(screen.getByRole("combobox", { name: "Entity type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More info" })).toBeInTheDocument();
  });

  it("marks every field invalid after an empty submit", async () => {
    render(<SetupPage />);
    fireEvent.click(submitButton());

    await screen.findByText("Pick a filing status");
    for (const label of [
      "Filing status",
      "State of residence",
      "Self-employment start date",
      "Entity type",
    ]) {
      expect(field(label)).toHaveAttribute("aria-invalid", "true");
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("can be submitted once every field is filled after an empty submit", async () => {
    render(<SetupPage />);
    fireEvent.click(submitButton());
    await screen.findByText("Pick a filing status");

    await fillEveryField();

    await waitFor(() => {
      expect(screen.queryByText("Pick a filing status")).not.toBeInTheDocument();
      expect(screen.queryByText("Pick a US state")).not.toBeInTheDocument();
      expect(screen.queryByText("Pick a start date")).not.toBeInTheDocument();
      expect(screen.queryByText("Pick an entity type")).not.toBeInTheDocument();
    });
    expect(submitButton()).toBeEnabled();

    fireEvent.click(submitButton());
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ filingStatus: "single", state: "UT" }),
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: "sole_prop" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });
});

describe("setup: restore from a backup", () => {
  it("restores a backup into the empty app without filling in the form", async () => {
    buildBundle.mockResolvedValue(emptyBundle());
    render(<SetupPage />);
    expect(screen.getByText("Restore from a CSV")).toBeInTheDocument();

    const csv = exportBundle(exampleBundle(), { scope: "full" });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File([csv], "fiscode-full-backup.csv", { type: "text/csv" })] },
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Restore this CSV?");
    // An empty app has nothing to keep, so there is no mode to choose.
    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
    expect(importBundle).toHaveBeenCalledWith(
      expect.objectContaining({ profile: exampleBundle().profile }),
      "import-restore",
    );
    // No profile was invented on the way.
    expect(upsert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("setup after a restore that brought no profile", () => {
  it("does not create a second business entity when one is already there", async () => {
    list.mockResolvedValueOnce([{ id: "ent_restored", type: "sole_prop" }]);
    render(<SetupPage />);
    await fillEveryField();
    fireEvent.click(submitButton());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});
