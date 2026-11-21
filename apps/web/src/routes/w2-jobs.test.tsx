import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { loaded } = vi.hoisted(() => ({ loaded: { jobs: [] as unknown[] } }));

// The router's history doesn't exist in jsdom: it is replaced at the package boundary. The rows
// come from the DF-07 stub's in-memory repo.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({ jobs: loaded.jobs, year: 2026 }),
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

  it("names a job's dates without '?' when one end is blank", async () => {
    await w2JobRepo.create({
      taxYear: 2026,
      employer: "Demo Open Co",
      startDate: "2026-01-01",
      endDate: null,
      wagesCents: 0,
      federalWithholdingCents: 0,
      ssWagesCents: 0,
      ssTipsCents: 0,
      ssTaxWithheldCents: 0,
      medicareWagesCents: 0,
      stateWagesCents: 0,
      stateWithholdingCents: 0,
      notes: null,
    });
    const jobs = await w2JobRepo.list();
    loaded.jobs = jobs;
    render(<W2JobsPage />);
    const row = screen.getByText("Demo Open Co").closest("tr")!;
    expect(row).toHaveTextContent("From Jan 1, 2026");
    expect(row).not.toHaveTextContent("?");
    loaded.jobs = [];
  });
});
