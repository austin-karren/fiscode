import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn(async () => undefined) }));

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({
  expenseRepo: { list: async () => [], create, update: vi.fn(), softDelete: vi.fn() },
  profileRepo: { get: async () => null },
  documentLinkRepo: { forRecord: async () => [], countsFor: async () => ({}) },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => loaded,
  useLocation: () => "",
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { GLOSSARY } from "../lib/tax-glossary";
import { Route } from "./expenses";

// What the loader returns; a test may give it rows.
const loaded: { expenses: unknown[]; profile: unknown; linkCounts: Record<string, number> } = {
  expenses: [],
  profile: null,
  linkCounts: {},
};

const ExpensesPage = Route.options.component!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("expense amount", () => {
  const submit = (amount: string) => {
    render(<ExpensesPage />);
    const input = screen.getByLabelText("Amount");
    fireEvent.change(input, { target: { value: amount } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    return input;
  };

  it.each([
    ["-50", "Enter an amount, like 12.50"],
    ["0", "Must be more than $0"],
    ["1e3", "Enter an amount, like 12.50"],
    ["12.345", "Use 2 decimals at most"],
    ["999999999999", "Too large"],
  ])("does not save %j and says what is allowed", async (amount, message) => {
    const input = submit(amount);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(create).not.toHaveBeenCalled();
  });

  it("shows the message as soon as focus leaves the field", async () => {
    render(<ExpensesPage />);
    const input = screen.getByLabelText("Amount");
    fireEvent.change(input, { target: { value: "-50" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Enter an amount, like 12.50")).toBeInTheDocument();
  });

  it("saves a plain amount in cents", async () => {
    submit("12.50");
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 1250 })),
    );
  });
});

describe("expense form choice cards", () => {
  it("names each checkbox by its card text, without the info button", () => {
    render(<ExpensesPage />);
    expect(
      screen.getByRole("checkbox", {
        name: "§179 candidate Equipment you'd like to fully expense this year rather than depreciate.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /^Startup expense \(Section 195\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More info about §179 candidate" }),
    ).toBeInTheDocument();
  });

  it("ticks a checkbox when its card title is clicked", () => {
    render(<ExpensesPage />);
    fireEvent.click(screen.getByText("§179 candidate"));
    expect(screen.getByRole("checkbox", { name: /^§179 candidate/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Startup expense/ })).not.toBeChecked();
  });

  it("gives every element a unique id", () => {
    render(<ExpensesPage />);
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

describe("adding a run of expenses", () => {
  const row = {
    id: "ex_demo",
    date: "2026-03-05",
    amountCents: 12000,
    category: "travel",
    clientId: null,
    description: "Demo conference travel",
    reason: null,
    flagForSection179: false,
    startupExpense: false,
    notes: null,
    deletedAt: null,
  };
  const addCard = () => screen.getByText("Add expense").closest("[data-slot=card]") as HTMLElement;

  afterEach(() => {
    loaded.expenses = [];
  });

  it("Duplicate fills the form; after Add the date and category stay, the rest clears, Amount has focus", async () => {
    loaded.expenses = [row];
    render(<ExpensesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    const card = within(addCard());
    expect(card.getByLabelText("Amount")).toHaveValue("120.00");
    expect(card.getByLabelText("Description (optional)")).toHaveValue("Demo conference travel");
    await waitFor(() => expect(card.getByLabelText("Date")).toHaveFocus());

    fireEvent.click(card.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ date: "2026-03-05", amountCents: 12000 }),
      ),
    );
    await waitFor(() => expect(card.getByLabelText("Amount")).toHaveValue(""));
    expect(card.getByLabelText("Description (optional)")).toHaveValue("");
    expect(card.getByLabelText("Date")).toHaveTextContent("Mar 5, 2026");
    expect(card.getByRole("combobox", { name: "Category" })).toHaveTextContent("Travel");
    await waitFor(() => expect(card.getByLabelText("Amount")).toHaveFocus());
  });

  it("links the basis hint (Pub 946) to Placed in service on the add form", () => {
    // Demo: Duplicate an equipment row, so the add form shows the field.
    loaded.expenses = [
      { ...row, id: "ex_demo_eq", category: "equipment", placedInServiceDate: null },
    ];
    render(<ExpensesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    const field = within(addCard()).getByRole("button", { name: /Placed in service/ });
    expect(field).toHaveAccessibleDescription(GLOSSARY.placedInService);
  });

  it("labels Placed in service as optional, and turns the startup box off for Equipment with the reason linked", () => {
    loaded.expenses = [
      { ...row, id: "ex_demo_eq", category: "equipment", placedInServiceDate: null },
    ];
    render(<ExpensesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    const card = within(addCard());
    const field = card.getByRole("button", { name: /Placed in service/ });
    expect(field.closest('[data-slot="form-item"]')).toHaveTextContent(
      "Placed in service (optional)",
    );
    const box = card.getByRole("checkbox", { name: /Startup expense/ });
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).toHaveAccessibleDescription("Equipment uses its placed-in-service date instead.");
  });

  it("leaves the startup box on, with no reason, for other categories", () => {
    render(<ExpensesPage />);
    const box = within(addCard()).getByRole("checkbox", { name: /Startup expense/ });
    expect(box).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByText("Equipment uses its placed-in-service date instead."),
    ).not.toBeInTheDocument();
  });

  it("clears a startup tick when Category becomes Equipment, so it is not saved disabled", async () => {
    render(<ExpensesPage />);
    const card = within(addCard());
    const box = () => card.getByRole("checkbox", { name: /Startup expense/ });
    fireEvent.click(box());
    expect(box()).toBeChecked();

    // A Base UI Select with a value takes the pick by keyboard in jsdom.
    const category = card.getByRole("combobox", { name: "Category" });
    category.focus();
    fireEvent.keyDown(category, { key: "ArrowDown" });
    const equipment = await screen.findByRole("option", { name: "Equipment" });
    equipment.focus();
    fireEvent.keyDown(equipment, { key: "Enter" });
    await waitFor(() => expect(category).toHaveTextContent("Equipment"));

    expect(box()).not.toBeChecked();
    expect(box()).toHaveAttribute("aria-disabled", "true");
    // The reason is the box's description, not part of its name.
    expect(box()).toHaveAccessibleName(
      "Startup expense (Section 195) Bought in anticipation of 1099 work — count it in the year even if dated before your SE start date.",
    );
  });

  it("says why on a row already ticked as both Startup and Equipment", () => {
    loaded.expenses = [
      {
        ...row,
        id: "ex_demo_both",
        date: "2025-12-15",
        category: "equipment",
        startupExpense: true,
        placedInServiceDate: null,
      },
    ];
    // Demo profile: SE start Feb 1, 2026, so the Dec 2025 laptop is before it.
    loaded.profile = { seStartDate: "2026-02-01" };
    render(<ExpensesPage />);
    const cell = screen
      .getByText("Equipment uses its placed-in-service date instead.")
      .closest("td")!;
    expect(cell).toHaveAttribute("data-label", "Category");
    expect(screen.queryByText("Startup §195")).not.toBeInTheDocument();
    loaded.profile = null;
  });
});
