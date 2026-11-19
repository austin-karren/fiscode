import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// SQLite over OPFS does not exist in jsdom; the repo is replaced at the
// package boundary.
vi.mock("@fiscode/db", () => ({ incomeRepo: { update: vi.fn() } }));

import { EditIncomeDialog } from "./edit-income-dialog";

const FIXED = "2026-06-04T12:00:00.000Z";

const income = {
  id: "in_demo",
  date: "2026-03-02",
  clientId: null,
  amountCents: 150_000,
  sourceType: "1099",
  kind: "consulting",
  description: "Demo consulting",
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
};

afterEach(cleanup);

const openDialog = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  return screen.findByRole("dialog");
};

const closeWithEscape = async () => {
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
};

describe("edit income dialog", () => {
  it("drops values typed and abandoned with Escape", async () => {
    render(<EditIncomeDialog income={income as never} clients={[]} onSaved={vi.fn()} />);
    await openDialog();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "999" } });
    await closeWithEscape();

    await openDialog();
    expect(screen.getByLabelText("Amount")).toHaveValue("1500.00");
  });

  it("opens on the record as saved now, after it changed", async () => {
    const { rerender } = render(
      <EditIncomeDialog income={income as never} clients={[]} onSaved={vi.fn()} />,
    );
    await openDialog();
    await closeWithEscape();

    rerender(
      <EditIncomeDialog
        income={{ ...income, amountCents: 175_000 } as never}
        clients={[]}
        onSaved={vi.fn()}
      />,
    );
    await openDialog();
    expect(screen.getByLabelText("Amount")).toHaveValue("1750.00");
  });
});
