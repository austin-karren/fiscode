import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EntityDatesError, EntityOverlapError } from "@fiscode/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// SQLite over OPFS does not exist in jsdom; the repo is replaced at the
// package boundary. The error type and its message are the real ones.
const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("@fiscode/db", () => ({ entityRepo: { update } }));

import { EditEntityDialog } from "./edit-entity-dialog";

const FIXED = "2026-06-04T12:00:00.000Z";

const llc = {
  id: "ent_llc",
  type: "single_member_llc",
  startDate: "2026-11-02",
  endDate: null,
  notes: null,
  deletedAt: null,
  createdAt: FIXED,
  updatedAt: FIXED,
};

const soleProp = { ...llc, id: "ent_sole", type: "sole_prop", startDate: "2024-01-01" };

const MESSAGE =
  "This overlaps your Sole proprietor period that started Jan 1, 2024 and is still open. End that period first, or change these dates. A period may start on the day the other one ends.";

// The form control whose aria-describedby names this message.
const fieldDescribedBy = (message: HTMLElement) =>
  document.querySelector(`[aria-describedby~="${message.id}"]`);

// The form control a field label points at.
const controlLabelled = (label: string) => {
  const el = screen.getByText(label, { selector: "label" });
  return document.getElementById(el.getAttribute("for")!);
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("edit entity dialog", () => {
  it("shows why a save was blocked and keeps the dialog open", async () => {
    update.mockRejectedValueOnce(new EntityOverlapError(soleProp));
    const onSaved = vi.fn();
    render(<EditEntityDialog entity={llc} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGE);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("clears the message once a save goes through", async () => {
    update.mockRejectedValueOnce(new EntityOverlapError(soleProp));
    update.mockResolvedValueOnce(llc);
    const onSaved = vi.fn();
    render(<EditEntityDialog entity={llc} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the reason when the end date is before the start date", async () => {
    update.mockRejectedValueOnce(
      new EntityDatesError({ startDate: "2026-11-02", endDate: "2023-01-01" }),
    );
    render(<EditEntityDialog entity={llc} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The end date (Jan 1, 2023) is before the start date (Nov 2, 2026).",
    );
  });

  it("puts an overlap on the Start field", async () => {
    update.mockRejectedValueOnce(new EntityOverlapError(soleProp));
    render(<EditEntityDialog entity={llc} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    const message = await screen.findByText(MESSAGE);
    expect(fieldDescribedBy(message)).toHaveAttribute("aria-invalid", "true");
    expect(fieldDescribedBy(message)).toBe(controlLabelled("Start"));
  });

  it("puts an end date before the start on the End field", async () => {
    update.mockRejectedValueOnce(
      new EntityDatesError({ startDate: "2026-11-02", endDate: "2023-01-01" }),
    );
    render(<EditEntityDialog entity={llc} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    const message = await screen.findByText(/is before the start date/);
    expect(fieldDescribedBy(message)).toBe(controlLabelled("End (optional)"));
  });

  it("opens on the saved period again after a refused end date and Escape", async () => {
    update.mockRejectedValueOnce(
      new EntityDatesError({ startDate: "2026-11-02", endDate: "2023-01-01" }),
    );
    render(<EditEntityDialog entity={llc} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog");

    // Type an End before the Start; the save is refused.
    fireEvent.click(controlLabelled("End (optional)")!);
    const typed = await screen.findByLabelText("Type a date");
    fireEvent.change(typed, { target: { value: "01/01/2023" } });
    fireEvent.keyDown(typed, { key: "Enter" });
    await waitFor(() => expect(controlLabelled("End (optional)")).toHaveTextContent("2023"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/is before the start date/);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog");

    expect(controlLabelled("End (optional)")).not.toHaveTextContent("2023");
    expect(controlLabelled("End (optional)")).toHaveTextContent("Pick a date");
    expect(screen.queryByText(/is before the start date/)).not.toBeInTheDocument();
  });

  it("does not submit a form the dialog's trigger sits in", async () => {
    // On the profile page the Edit button is inside the add-period form, and a
    // React submit event bubbles out of the dialog's portal to that form.
    update.mockResolvedValueOnce(llc);
    const outerSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    const onSaved = vi.fn();
    render(
      <form onSubmit={outerSubmit}>
        <EditEntityDialog entity={llc} onSaved={onSaved} />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(outerSubmit).not.toHaveBeenCalled();
  });
});
