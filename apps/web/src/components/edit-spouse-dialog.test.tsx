import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// SQLite over OPFS does not exist in jsdom; the repo is replaced at the
// package boundary.
const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("@fiscode/db", () => ({ spouseRepo: { update } }));

import { EnterToSubmitForm } from "./forms/enter-to-submit-form";
import { EditSpouseDialog } from "./edit-spouse-dialog";

const FIXED = "2026-06-04T12:00:00.000Z";

const spouse = {
  id: "sp_demo",
  startDate: "2026-01-01",
  endDate: null,
  annualW2WagesCents: 5_000_000,
  annualFederalWithholdingCents: 400_000,
  annualStateWithholdingCents: 150_000,
  notes: null,
  deletedAt: null,
  createdAt: FIXED,
  updatedAt: FIXED,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// On the profile page the Edit button sits inside the add-spouse form, and a
// React submit event bubbles out of the dialog's portal to that form.
function renderInsideAddForm() {
  const outerSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
  const onSaved = vi.fn();
  render(
    <EnterToSubmitForm onSubmit={outerSubmit}>
      <EditSpouseDialog spouse={spouse as never} onSaved={onSaved} />
    </EnterToSubmitForm>,
  );
  return { outerSubmit, onSaved };
}

describe("edit spouse dialog", () => {
  it("saves with the Save button and does not submit the form behind it", async () => {
    update.mockResolvedValueOnce(spouse);
    const { outerSubmit, onSaved } = renderInsideAddForm();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledTimes(1);
    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it("saves on Enter in a field and does not submit the form behind it", async () => {
    update.mockResolvedValueOnce(spouse);
    const { outerSubmit, onSaved } = renderInsideAddForm();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const wages = await screen.findByLabelText("Annual W-2 wages (optional)");
    fireEvent.keyDown(wages, { key: "Enter" });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledTimes(1);
    expect(outerSubmit).not.toHaveBeenCalled();
  });
});
