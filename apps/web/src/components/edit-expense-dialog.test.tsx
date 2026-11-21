import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// SQLite over OPFS does not exist in jsdom; the repo is replaced at the
// package boundary.
vi.mock("@fiscode/db", () => ({
  expenseRepo: { update: vi.fn() },
  documentLinkRepo: { forRecord: async () => [], countsFor: async () => ({}) },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { expenseRepo } from "@fiscode/db";

import { GLOSSARY } from "../lib/tax-glossary";
import { EditExpenseDialog } from "./edit-expense-dialog";

const FIXED = "2026-06-04T12:00:00.000Z";
const CATEGORIES = [
  ["equipment", "Equipment"],
  ["software_subs", "Software & subscriptions"],
] as const;

// Demo: a $3,000 laptop bought before a Feb 1, 2026 start.
const laptop = {
  id: "ex_demo_laptop",
  date: "2025-11-20",
  amountCents: 300_000,
  category: "equipment",
  clientId: null,
  description: "Demo laptop",
  reason: null,
  notes: null,
  flagForSection179: false,
  startupExpense: false,
  placedInServiceDate: null as string | null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const openAndSave = async (expense: typeof laptop) => {
  render(
    <EditExpenseDialog
      expense={expense}
      categories={CATEGORIES}
      onSaved={vi.fn()}
      seStartDate="2026-02-01"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Edit\b/ }));
  await screen.findByRole("dialog");
  return screen.getByRole("button", { name: /Placed in service/ });
};

describe("edit expense: equipment placed in service", () => {
  it("shows the SE start for equipment bought before it, and saves it untouched", async () => {
    const field = await openAndSave(laptop);
    expect(field).toHaveAccessibleName(expect.stringContaining("Feb 1, 2026"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(expenseRepo.update).toHaveBeenCalledWith(
        "ex_demo_laptop",
        expect.objectContaining({ placedInServiceDate: "2026-02-01" }),
      ),
    );
  });

  it("an untouched row that already has its date writes nothing", async () => {
    await openAndSave({ ...laptop, placedInServiceDate: "2026-02-01" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(expenseRepo.update).not.toHaveBeenCalled();
  });

  it("links the basis hint (Pub 946) to the field, and keeps the hint button", async () => {
    const field = await openAndSave(laptop);
    expect(GLOSSARY.placedInService).toBe(
      "For equipment you owned before using it for the business, the basis is the lower of its value then or what you paid (Pub 946).",
    );
    expect(field).toHaveAccessibleDescription(GLOSSARY.placedInService);
    const item = field.closest<HTMLElement>('[data-slot="form-item"]')!;
    expect(within(item).getByRole("button", { name: "More info" })).toBeInTheDocument();
  });

  it("labels Placed in service as optional", async () => {
    const field = await openAndSave(laptop);
    const item = field.closest<HTMLElement>('[data-slot="form-item"]')!;
    expect(item).toHaveTextContent("Placed in service (optional)");
  });

  it("turns the startup box off for Equipment, with the reason linked", async () => {
    await openAndSave(laptop);
    const box = screen.getByRole("checkbox", { name: /Startup expense/ });
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).toHaveAccessibleDescription("Equipment uses its placed-in-service date instead.");
  });

  it("leaves the startup box on, with no reason, for other categories", async () => {
    render(
      <EditExpenseDialog
        expense={{ ...laptop, category: "software_subs" }}
        categories={CATEGORIES}
        onSaved={vi.fn()}
        seStartDate="2026-02-01"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Edit\b/ }));
    await screen.findByRole("dialog");
    const box = screen.getByRole("checkbox", { name: /Startup expense/ });
    expect(box).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByText("Equipment uses its placed-in-service date instead."),
    ).not.toBeInTheDocument();
  });

  it("clears the startup tick when the category is changed to Equipment", async () => {
    render(
      <EditExpenseDialog
        expense={{ ...laptop, category: "software_subs", startupExpense: true }}
        categories={CATEGORIES}
        onSaved={vi.fn()}
        seStartDate="2026-02-01"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Edit\b/ }));
    await screen.findByRole("dialog");
    const box = () => screen.getByRole("checkbox", { name: /Startup expense/ });
    expect(box()).toBeChecked();

    // A Base UI Select with a value takes the pick by keyboard in jsdom.
    const category = screen.getByRole("combobox", { name: "Category" });
    category.focus();
    fireEvent.keyDown(category, { key: "ArrowDown" });
    const equipment = await screen.findByRole("option", { name: "Equipment" });
    equipment.focus();
    fireEvent.keyDown(equipment, { key: "Enter" });
    await waitFor(() => expect(category).toHaveTextContent("Equipment"));

    expect(box()).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(expenseRepo.update).toHaveBeenCalledWith(
        "ex_demo_laptop",
        expect.objectContaining({ category: "equipment", startupExpense: false }),
      ),
    );
  });

  it("leaves a row already ticked as equipment and startup as it is (waits on d-data)", async () => {
    await openAndSave({ ...laptop, startupExpense: true });
    expect(screen.getByRole("checkbox", { name: /Startup expense/ })).toBeChecked();
  });
});
