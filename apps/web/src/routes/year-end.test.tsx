import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectNoRawValues } from "../test/raw-values";

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
// `db.bundle` stands in for buildBundle, which leaves archived rows out; the
// repos' listIncludingDeleted keep them, as the real ones do.
const { db } = vi.hoisted(() => ({
  db: {
    bundle: {} as Record<string, unknown>,
    clients: [] as unknown[],
    vehicles: [] as unknown[],
  },
}));

vi.mock("@fiscode/db", () => ({
  buildBundle: async () => db.bundle,
  clientRepo: { listIncludingDeleted: async () => db.clients },
  vehicleRepo: { listIncludingDeleted: async () => db.vehicles },
}));

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
    entityType: "sole_prop",
    entityUnsupported: false,
    seStartDate: "2026-01-01",
    excludedBeforeSeStart: { income: 0, expense: 0, mileage: 0 },
    startupCosts: { deductedThisYear: 0, total: 0, remainingAfterYear: 0 },
  },
  totalsByCategory: { software_subs: 8950 },
  names: {
    clients: [{ id: "c_demo", name: "Demo Client Co" }],
    vehicles: [{ id: "v_demo", year: 2020, make: "Demo", model: "Wagon" }],
  },
  lists: {
    income: [
      {
        id: "i1",
        date: "2026-03-02",
        clientId: "c_demo",
        kind: "consulting",
        description: "Demo engagement",
        amountCents: 100_000,
      },
      {
        id: "i2",
        date: "2026-04-01",
        clientId: null,
        kind: "bonus",
        description: null,
        amountCents: 50_000,
      },
    ],
    clientTotals: [
      { clientId: "c_demo", amountCents: 100_000 },
      { clientId: null, amountCents: 50_000 },
    ],
    mileage: [
      {
        id: "m1",
        date: "2026-07-15",
        vehicleId: "v_demo",
        purpose: "Demo client visit",
        businessMiles: 40,
        ratePerMile: 0.76,
      },
    ],
  },
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

import { exampleBundle } from "@fiscode/csv";

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

  it("names the settings and categories in words, never stored keys", () => {
    render(<YearEndPage />);
    const packet = document.body;
    expect(packet).toHaveTextContent("Single");
    expect(packet).toHaveTextContent("Utah");
    expect(packet).toHaveTextContent("Sole proprietor");
    expect(packet).toHaveTextContent("Software & subscriptions");
    expectNoRawValues(packet, ["UT", "SINGLE"]);
  });

  it("dates the before-start notice in words", () => {
    loaderData.derived.excludedBeforeSeStart = { income: 1, expense: 0, mileage: 0 };
    loaderData.derived.seStartDate = "2026-03-02";
    try {
      render(<YearEndPage />);
      expect(screen.getByText(/dated before\s+Mar 2, 2026 are not counted/)).toBeInTheDocument();
      expectNoRawValues(document.body);
    } finally {
      loaderData.derived.excludedBeforeSeStart = { income: 0, expense: 0, mileage: 0 };
      loaderData.derived.seStartDate = "2026-01-01";
    }
  });

  it("hides the left-to-amortize row when nothing is left (demo $3,000, all deducted)", () => {
    loaderData.derived.startupCosts = {
      deductedThisYear: 300_000,
      total: 300_000,
      remainingAfterYear: 0,
    };
    try {
      render(<YearEndPage />);
      expect(screen.getByText(/Startup costs \(Section 195\)/)).toBeInTheDocument();
      expect(screen.queryByText(/left to amortize/)).not.toBeInTheDocument();
    } finally {
      loaderData.derived.startupCosts = { deductedThisYear: 0, total: 0, remainingAfterYear: 0 };
    }
  });

  it("shows §195 startup costs: deducted this year, of the total paid (demo $12,000, start Mar 2)", () => {
    loaderData.derived.startupCosts = {
      deductedThisYear: 538_889,
      total: 1_200_000,
      remainingAfterYear: 661_111,
    };
    try {
      render(<YearEndPage />);
      const row = screen.getByText(/Startup costs \(Section 195\)/).closest("tr")!;
      expect(row).toHaveTextContent("of $12,000.00 paid before the business began");
      expect(row).toHaveTextContent("$5,388.89");
      const left = screen.getByText("Startup costs left to amortize after 2026").closest("tr")!;
      expect(left).toHaveTextContent("$6,611.11");
    } finally {
      loaderData.derived.startupCosts = { deductedThisYear: 0, total: 0, remainingAfterYear: 0 };
    }
  });

  it("lists 1099 income per client, every income row, and the mileage log", () => {
    render(<YearEndPage />);
    const card = (title: string) =>
      screen.getByRole("heading", { name: title }).closest("[data-slot=card]") as HTMLElement;

    const byClient = card("1099 income by client");
    expect(byClient).toHaveTextContent("Demo Client Co$1,000.00");
    expect(byClient).toHaveTextContent("No client$500.00");
    expect(byClient).toHaveTextContent("Total 1099 income$1,500.00");

    const income = card("1099 income");
    expect(income).toHaveTextContent("Mar 2, 2026Demo Client CoConsultingDemo engagement$1,000.00");
    expect(income).toHaveTextContent("Apr 1, 2026No clientBonus—$500.00");

    const log = card("Mileage log");
    expect(log).toHaveTextContent("Jul 15, 20262020 Demo WagonDemo client visit40$0.760/mi");
    expect(log).toHaveTextContent("Total ($0.00 deduction)40");

    for (const c of [byClient, income, log]) expectNoRawValues(c);
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

describe("year-end loader", () => {
  it("names an archived client and vehicle in the lists, not 'Unknown'", async () => {
    const example = exampleBundle();
    const [archivedClient, ...liveClients] = example.clients;
    const ARCHIVED = "2026-10-01T00:00:00.000Z";
    db.bundle = { ...example, clients: liveClients, vehicles: [] };
    db.clients = [{ ...archivedClient!, deletedAt: ARCHIVED }, ...liveClients];
    db.vehicles = example.vehicles.map((v) => ({ ...v, deletedAt: ARCHIVED }));

    const loader = Route.options.loader as unknown as () => Promise<{ names: unknown }>;
    const data = await loader();
    expect(data.names).toEqual({ clients: db.clients, vehicles: db.vehicles });
  });

  it("shows self-employed health insurance as a Schedule 1 line 17 adjustment, from engine output", async () => {
    // Demo data plus a $6,000 premium paid in 2026.
    const example = exampleBundle();
    const base = example.expenses[0]!;
    db.bundle = {
      ...example,
      expenses: [
        ...example.expenses,
        {
          ...base,
          id: "exp_demo_hi",
          date: "2026-03-01",
          category: "health_insurance",
          amountCents: 600_000,
          startupExpense: false,
        },
      ],
    };
    db.clients = example.clients;
    db.vehicles = example.vehicles;
    const loader = Route.options.loader as unknown as () => Promise<typeof loaderData>;
    const data = await loader();
    const allowed = (
      data.result as unknown as { estimate: { selfEmployedHealthInsurance: number } }
    ).estimate.selfEmployedHealthInsurance;
    expect(allowed).toBeGreaterThan(0);
    expect(data.totalsByCategory).not.toHaveProperty("health_insurance");

    const saved = { ...loaderData };
    Object.assign(loaderData, data);
    try {
      render(<YearEndPage />);
      const line17 = screen.getByText(
        "Self-employed health insurance, deductible (Schedule 1 line 17)",
      );
      expect(line17.closest("div")).toHaveTextContent(
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
          allowed / 100,
        ),
      );
      const paid = screen
        .getByText(/premiums paid: not Schedule C; an adjustment on Schedule 1 line 17/)
        .closest("tr")!;
      expect(paid).toHaveTextContent("$6,000.00");
    } finally {
      Object.assign(loaderData, saved);
    }
  });

  it("says the deduction is capped when the premium is over net profit minus half the SE tax", async () => {
    // Demo data plus a $50,000 premium: more than the year's net profit allows.
    const example = exampleBundle();
    const base = example.expenses[0]!;
    db.bundle = {
      ...example,
      expenses: [
        ...example.expenses,
        {
          ...base,
          id: "exp_demo_hi",
          date: "2026-03-01",
          category: "health_insurance",
          amountCents: 5_000_000,
          startupExpense: false,
        },
      ],
    };
    db.clients = example.clients;
    db.vehicles = example.vehicles;
    const loader = Route.options.loader as unknown as () => Promise<typeof loaderData>;
    const data = await loader();
    const estimate = (
      data.result as unknown as {
        estimate: {
          selfEmployedHealthInsurance: number;
          netProfit: number;
          se: { totalSeTax: number };
        };
      }
    ).estimate;
    const allowed = estimate.selfEmployedHealthInsurance;
    expect(allowed).toBeLessThan(5_000_000);
    expect(allowed).toBe(estimate.netProfit - Math.round(estimate.se.totalSeTax / 2));

    const saved = { ...loaderData };
    Object.assign(loaderData, data);
    try {
      render(<YearEndPage />);
      const usd = (c: number) =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
      const deductible = screen.getByText(
        "Self-employed health insurance, deductible (Schedule 1 line 17)",
      );
      expect(deductible.closest("div")).toHaveTextContent(usd(allowed));
      const paid = screen.getByText(/premiums paid/).closest("tr")!;
      expect(paid).toHaveTextContent("$50,000.00");
      expect(paid).toHaveTextContent(
        `The deduction is limited to net profit minus half the SE tax: ${usd(allowed)}.`,
      );
    } finally {
      Object.assign(loaderData, saved);
    }
  });

  it("adds no limit note when the whole premium is deductible", async () => {
    const example = exampleBundle();
    const base = example.expenses[0]!;
    db.bundle = {
      ...example,
      expenses: [
        ...example.expenses,
        {
          ...base,
          id: "exp_demo_hi",
          date: "2026-03-01",
          category: "health_insurance",
          amountCents: 100_000,
          startupExpense: false,
        },
      ],
    };
    const loader = Route.options.loader as unknown as () => Promise<typeof loaderData>;
    const data = await loader();
    const saved = { ...loaderData };
    Object.assign(loaderData, data);
    try {
      render(<YearEndPage />);
      expect(screen.queryByText(/The deduction is limited/)).not.toBeInTheDocument();
    } finally {
      Object.assign(loaderData, saved);
    }
  });

  it("shows what is left to amortize, from engine output (demo $20,000 startup, SE start Jul 1, 2026)", async () => {
    const example = exampleBundle();
    const base = example.expenses[0]!;
    db.bundle = {
      ...example,
      profile: { ...example.profile!, seStartDate: "2026-07-01" },
      expenses: [
        ...example.expenses,
        {
          ...base,
          id: "exp_demo_su",
          date: "2026-03-01",
          category: "software_subs",
          amountCents: 2_000_000,
          startupExpense: true,
        },
      ],
    };
    const loader = Route.options.loader as unknown as () => Promise<typeof loaderData>;
    const data = await loader();
    expect(data.derived.startupCosts).toMatchObject({
      deductedThisYear: 550_000,
      remainingAfterYear: 1_450_000,
    });

    const saved = { ...loaderData };
    Object.assign(loaderData, data);
    try {
      render(<YearEndPage />);
      const left = screen.getByText("Startup costs left to amortize after 2026").closest("tr")!;
      expect(left).toHaveTextContent("$14,500.00");
    } finally {
      Object.assign(loaderData, saved);
    }
  });

  it("notes equipment ticked Startup, from engine output, and prints it", async () => {
    const example = exampleBundle();
    const base = example.expenses[0]!;
    db.bundle = {
      ...example,
      profile: { ...example.profile!, seStartDate: "2026-02-01" },
      expenses: [
        ...example.expenses,
        {
          ...base,
          id: "ex_demo_laptop",
          date: "2026-01-10",
          category: "equipment",
          amountCents: 120_000,
          startupExpense: true,
        },
      ],
    };
    const loader = Route.options.loader as unknown as () => Promise<typeof loaderData>;
    const data = await loader();
    const saved = { ...loaderData };
    Object.assign(loaderData, data);
    try {
      render(<YearEndPage />);
      const notice = screen
        .getByText(/1 equipment expense is ticked Startup/)
        .closest("[data-slot=alert]");
      expect(notice).toHaveClass("print:break-inside-avoid");
      expect(notice).not.toHaveClass("print:hidden");
    } finally {
      Object.assign(loaderData, saved);
    }
  });
});
