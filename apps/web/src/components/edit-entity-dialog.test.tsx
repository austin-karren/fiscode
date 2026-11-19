import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EntityOverlapError } from "@fiscode/core";
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
  "This overlaps your Sole proprietor period that started Jan 1, 2024 and is still open. End that period first, or change these dates.";

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
});
