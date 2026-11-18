import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
const { upsert, create, navigate } = vi.hoisted(() => ({
  upsert: vi.fn(async () => {}),
  create: vi.fn(async () => {}),
  navigate: vi.fn(),
}));

vi.mock("@fiscode/db", () => ({
  profileRepo: { exists: async () => false, upsert },
  entityRepo: { create },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));

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
