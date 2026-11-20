import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// SQLite over OPFS does not exist in jsdom; the repo is replaced at the
// package boundary.
vi.mock("@fiscode/db", () => ({ timeRepo: { update: vi.fn() } }));

import { timeRepo } from "@fiscode/db";

import { EditTimeDialog } from "./edit-time-dialog";

const FIXED = "2026-06-04T12:00:00.000Z";

// Demo: an imported entry of 83 minutes, off the form's quarter-hour step.
const entry = {
  id: "te_demo",
  date: "2026-03-02",
  clientId: null,
  minutes: 83,
  description: "Demo workshop",
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("edit time dialog", () => {
  it("shows minutes off the quarter-hour step exactly, and saves them unrounded", async () => {
    render(<EditTimeDialog entry={entry as never} clients={[]} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit\b/ }));
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("Hours")).toHaveValue("1:23");

    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "Demo workshop 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(timeRepo.update).toHaveBeenCalled());
    expect(timeRepo.update).toHaveBeenCalledWith(
      "te_demo",
      expect.objectContaining({ minutes: 83 }),
    );
  });
});
