import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The router's history doesn't exist in jsdom: it is replaced at the package boundary. The
// payment rows come from the DF-07 stub's in-memory repo.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({ payments: [] }),
  useRouter: () => ({ invalidate: vi.fn(async () => {}) }),
}));

import { estimatedPaymentRepo } from "../lib/w2-payments-stub";
import { Route } from "./payments";

const PaymentsPage = Route.options.component!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 1, 9, 0)); // Jun 1, 2026
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("adding a payment", () => {
  it("defaults the quarter from the date (Jun 1: Q2) and saves it as 'from the date'", async () => {
    render(<PaymentsPage />);
    expect(screen.getByRole("combobox", { name: /Applied to/ })).toHaveTextContent(
      "Q2 (from the date)",
    );
    expect(screen.getByRole("combobox", { name: /For tax year/ })).toHaveTextContent("2026");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(async () => expect(await estimatedPaymentRepo.list()).toHaveLength(1));
    const [saved] = await estimatedPaymentRepo.list();
    expect(saved).toMatchObject({
      date: "2026-06-01",
      amountCents: 120_000,
      jurisdiction: "federal",
      taxYear: 2026,
      appliedQuarter: null,
    });
  });

  it("refuses a blank amount, with the message on the field", async () => {
    render(<PaymentsPage />);
    fireEvent.blur(screen.getByLabelText("Amount"));
    expect(await screen.findByText("Enter an amount, like 12.50")).toBeInTheDocument();
  });
});
