import { cleanup, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Date-only strings must show as the same day west of UTC too; pin a western
// zone for this file (CI runs in UTC).
const { originalTz } = vi.hoisted(() => {
  const originalTz = process.env.TZ;
  process.env.TZ = "America/Denver";
  return { originalTz };
});

import { expectNoRawValues } from "../test/raw-values";

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({
  buildBundle: async () => ({}),
  importBundle: vi.fn(),
  profileRepo: { get: async () => null },
}));

const payment = (quarter: number, start: string, end: string, due: string) => ({
  quarter,
  periodStart: start,
  periodEnd: end,
  dueDate: due,
  amount: 50_000,
});

// Demo figures in the loader's shape: only what the page reads.
const loaderData = {
  profile: {
    filingStatus: "single",
    state: "UT",
    quarterlyMethod: "annualized",
    prepLeadDays: 14,
  },
  year: 2026,
  hasExact: true,
  result: {
    estimate: {
      totalLiability: 200_000,
      se: { totalSeTax: 100_000 },
      federal: { federalIncomeTax: 80_000, qbiDeduction: 0 },
      state: { stateIncomeTax: 20_000 },
      netProfit: 900_000,
    },
    quarterly: {
      payments: [
        payment(1, "2026-01-01", "2026-03-31", "2026-04-15"),
        payment(2, "2026-04-01", "2026-05-31", "2026-06-15"),
        payment(3, "2026-06-01", "2026-08-31", "2026-09-15"),
        payment(4, "2026-09-01", "2026-12-31", "2027-01-15"),
      ],
    },
    safeHarbor: { currentYearTarget: 0, firstYear: true, floor: 0 },
  },
  derived: {
    gross1099: 1_000_000,
    directExpenses: 100_000,
    mileageDeduction: 0,
    homeOfficeDeduction: 0,
    seStartDate: "2026-03-02",
    excludedBeforeSeStart: { income: 1, expense: 0, mileage: 0 },
  },
};

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => loaderData,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { Route } from "./index";

const Dashboard = Route.options.component!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 1, 9, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("dashboard text", () => {
  it("describes the profile in words", () => {
    render(<Dashboard />);
    expect(screen.getByText("Single filer · Utah · annualized installments")).toBeInTheDocument();
  });

  it("dates the quarters in words, marks the next one, and leaves no stored value", () => {
    render(<Dashboard />);
    const q3 = screen.getByText(/^Q3 ·/).parentElement!.parentElement!;
    expect(q3).toHaveTextContent("Q3 · Jun 1, 2026 – Aug 31, 2026");
    expect(within(q3).getByText("Next")).toBeInTheDocument();
    expect(q3).toHaveTextContent("Due Sep 15, 2026");
    const q1 = screen.getByText(/^Q1 ·/).parentElement!.parentElement!;
    expect(q1).toHaveTextContent("Was due Apr 15, 2026");
    expect(q1).toHaveClass("text-muted-foreground");
    expect(screen.getByText(/dated before Mar 2, 2026 are not counted/)).toBeInTheDocument();
    expectNoRawValues(document.body, ["SINGLE", "UT"]);
  });
});

describe("dashboard hierarchy", () => {
  it("shows one primary figure, the total, with the three taxes receding beside it", () => {
    render(<Dashboard />);
    const value = (label: string) =>
      screen.getByText(label).closest("[data-slot=card-content]")!.querySelector("p + p")!;
    expect(value("Total liability")).toHaveClass("text-4xl");
    for (const label of ["Self-employment tax", "Federal income tax", "State income tax"]) {
      expect(value(label)).not.toHaveClass("text-4xl");
      expect(value(label)).toHaveClass("text-lg");
    }
  });
});

describe("dashboard titles and warnings", () => {
  const quarterly = loaderData.result.quarterly as { noInstallmentsRequired?: boolean };

  afterEach(() => {
    delete quarterly.noInstallmentsRequired;
  });

  it("says 'No payment required' instead of a date to prepare for under the $1,000 rule", () => {
    quarterly.noInstallmentsRequired = true;
    render(<Dashboard />);
    expect(screen.getByText("No payment required")).toBeInTheDocument();
    expect(screen.queryByText(/Start preparing/)).not.toBeInTheDocument();
  });

  it("names the next due date and when to start preparing when a payment is required", () => {
    render(<Dashboard />);
    expect(screen.getByText(/Next due Sep 15, 2026\. Start preparing around/)).toBeInTheDocument();
    expect(screen.queryByText("No payment required")).not.toBeInTheDocument();
  });

  it("labels the safe harbor figures as federal", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: /Safe harbor \(federal\)/ })).toBeInTheDocument();
  });

  it("shows the first-year note as a warning alert, not as coloured text", () => {
    render(<Dashboard />);
    const note = screen.getByText("First-year filing").closest("[role=alert]");
    expect(note).toHaveTextContent(/pay-as-you-go target is 90% of current-year tax/);
  });

  it("titles each section with the same tracked, muted label", () => {
    render(<Dashboard />);
    for (const name of [/IRS quarterly payments/, /Safe harbor/, /Year-to-date inputs/i]) {
      expect(screen.getByRole("heading", { name })).toHaveClass("uppercase", "tracking-wide");
    }
  });
});
