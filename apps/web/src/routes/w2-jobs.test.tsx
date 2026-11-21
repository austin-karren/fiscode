import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The router's history doesn't exist in jsdom: it is replaced at the package boundary. The rows
// come from the DF-07 stub's in-memory repo.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({ jobs: [], year: 2026 }),
  useRouter: () => ({ invalidate: vi.fn(async () => {}) }),
}));

import { w2JobRepo } from "../lib/w2-payments-stub";
import { Route } from "./w2-jobs";

const W2JobsPage = Route.options.component!;

afterEach(cleanup);

describe("adding a W-2", () => {
  it("names each box in its hint, linked to the field", () => {
    render(<W2JobsPage />);
    expect(screen.getByLabelText(/^Wages/)).toHaveAccessibleDescription(/^Box 1:/);
    expect(screen.getByLabelText(/^Utah tax withheld/)).toHaveAccessibleDescription(/^Box 17\./);
    expect(screen.getByLabelText("Wages (optional)")).toBeInTheDocument();
  });

  it("needs the employer, then saves the boxes in cents", async () => {
    render(<W2JobsPage />);
    fireEvent.change(screen.getByLabelText(/^Wages/), { target: { value: "8500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Enter the employer")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Employer"), { target: { value: "Demo Corp" } });
    fireEvent.blur(screen.getByLabelText("Employer"));
    await waitFor(() => expect(screen.queryByText("Enter the employer")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(async () => expect(await w2JobRepo.list()).toHaveLength(1));
    expect((await w2JobRepo.list())[0]).toMatchObject({
      taxYear: 2026,
      employer: "Demo Corp",
      wagesCents: 850_000,
      federalWithholdingCents: 0,
    });
  });
});
