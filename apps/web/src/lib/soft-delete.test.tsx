import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Toaster, toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { restoreRow, softDeleteWithUndo } from "./soft-delete";

type DemoRow = { id: string; name: string; deletedAt: string | null };

const demoRow: DemoRow = { id: "row_1", name: "Demo row", deletedAt: null };

const makeRepo = () => ({
  softDelete: vi.fn(async (_id: string) => true),
  revertTo: vi.fn(async (_id: string, snapshot: DemoRow) => snapshot),
});

// Sonner keeps toasts in a module-wide store that outlives the Toaster, so a
// later test would otherwise see (and click) an earlier test's Undo.
afterEach(() => {
  cleanup();
  toast.dismiss();
});

describe("softDeleteWithUndo", () => {
  it("deletes the row at once and tells the caller", async () => {
    const repo = makeRepo();
    const onChange = vi.fn();
    render(<Toaster />);

    await softDeleteWithUndo({ repo, row: demoRow, message: "Demo row deleted.", onChange });

    expect(repo.softDelete).toHaveBeenCalledWith("row_1");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Demo row deleted.")).toBeInTheDocument();
  });

  it("restores the exact row when Undo is clicked", async () => {
    const repo = makeRepo();
    const onChange = vi.fn();
    render(<Toaster />);

    await softDeleteWithUndo({ repo, row: demoRow, message: "Demo row deleted.", onChange });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(repo.revertTo).toHaveBeenCalledTimes(1));
    expect(repo.revertTo).toHaveBeenCalledWith("row_1", demoRow);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
  });
});

describe("restoreRow", () => {
  it("brings back a deleted row with deletedAt cleared", async () => {
    const repo = makeRepo();
    const onChange = vi.fn();
    render(<Toaster />);

    await restoreRow({
      repo,
      row: { ...demoRow, deletedAt: "2026-01-05T00:00:00.000Z" },
      message: "Demo row un-archived.",
      onChange,
    });

    expect(repo.revertTo).toHaveBeenCalledWith("row_1", demoRow);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Demo row un-archived.")).toBeInTheDocument();
  });
});
