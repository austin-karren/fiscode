import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({ buildBundle: async () => ({}) }));

const loaderData = {
  profile: { filingStatus: "single", state: "UT" },
  year: 2026,
  result: {
    estimate: {
      netProfit: 141050,
      se: { totalSeTax: 19930 },
      federal: { qbiDeduction: 0, federalIncomeTax: 0 },
      state: { stateIncomeTax: 0 },
      totalLiability: 19930,
      spouseWithholding: 0,
      remainingOwed: 19930,
    },
  },
  derived: {
    gross1099: 150000,
    directExpenses: 8950,
    mileageDeduction: 0,
    homeOfficeDeduction: 0,
    activeEntityType: "sole_prop",
    seStartDate: "2026-01-01",
    excludedBeforeSeStart: { income: 0, expense: 0, mileage: 0 },
  },
  totalsByCategory: { software_subs: 8950 },
};

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => loaderData,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { Route } from "./year-end";

const YearEndPage = Route.options.component!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 18, 9, 0));
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const printHeader = () => screen.getByTestId("print-header");

describe("year-end packet", () => {
  it("prints the page from the Print button", () => {
    render(<YearEndPage />);
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("carries a print-only header with the tax year and the print date", () => {
    render(<YearEndPage />);
    const header = within(printHeader());
    expect(header.getByText("fiscode year-end summary")).toBeInTheDocument();
    expect(header.getByText("Tax year 2026")).toBeInTheDocument();
    expect(header.getByText("Printed November 18, 2026")).toBeInTheDocument();
    expect(printHeader()).toHaveClass("hidden", "print:block");
  });

  it("dates the header on the day it is printed, not the day the page was opened", () => {
    render(<YearEndPage />);
    vi.setSystemTime(new Date(2026, 10, 20, 9, 0));
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(within(printHeader()).getByText("Printed November 20, 2026")).toBeInTheDocument();
  });

  it("tells the reader to confirm tax figures and links to Tax data, with no developer copy", () => {
    render(<YearEndPage />);
    expect(
      screen.getByText(/Confirm them against the IRS and SSA before filing/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tax data" })).toHaveAttribute("href", "/tax-data");
    expect(document.body).not.toHaveTextContent(/todo: verify/i);
    expect(document.body).not.toHaveTextContent(/tax package source/i);
  });
});
