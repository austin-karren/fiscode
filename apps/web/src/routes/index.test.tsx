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
    priorYearTotalTaxCents: null,
    priorYearAgiCents: null,
    priorYearStateTaxCents: null,
    priorYearFiguresYear: null,
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

import { exampleBundle } from "@fiscode/csv";
import { estimateBundleYear } from "@fiscode/tax";

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
    expect(screen.getByText(/dated before Mar 2, 2026 is not counted/)).toBeInTheDocument();
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

  it("under the $1,000 rule: upcoming tiles say 'No payment required', none is Next, no prep date", () => {
    quarterly.noInstallmentsRequired = true;
    render(<Dashboard />);
    const tile = (q: number) =>
      screen.getByText(new RegExp(`^Q${q} ·`)).parentElement!.parentElement!;
    // Today is Jul 1, 2026 (fake clock): Q1 and Q2 are past, Q3 and Q4 upcoming.
    expect(tile(1)).toHaveTextContent("Was due Apr 15, 2026");
    for (const q of [3, 4]) {
      expect(tile(q)).toHaveTextContent("No payment required");
      expect(tile(q)).not.toHaveTextContent(/Due /);
    }
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
    expect(screen.queryByText(/Start preparing/)).not.toBeInTheDocument();
  });

  it("states the $1,000 rule once, as its own sentence", () => {
    quarterly.noInstallmentsRequired = true;
    render(<Dashboard />);
    expect(screen.getAllByText(/less than \$1,000 after federal withholding/)).toHaveLength(1);
    const line = screen.getByText(/less than \$1,000/).closest("p")!;
    expect(line).toHaveTextContent(/^No payment required\. You owe the IRS less than \$1,000/);
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

  it("shows the first-year note as a warning box, static: not an interrupting alert", () => {
    render(<Dashboard />);
    const note = screen.getByText("First-year filing").closest("[data-slot=alert]");
    expect(note).toHaveTextContent(/pay-as-you-go target is 90% of current-year tax/);
    expect(note).not.toHaveAttribute("role");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("titles each section with the same tracked, muted label", () => {
    render(<Dashboard />);
    for (const name of [/IRS quarterly payments/, /Safe harbor/, /Year-to-date inputs/i]) {
      expect(screen.getByRole("heading", { name })).toHaveClass("uppercase", "tracking-wide");
    }
  });
});

describe("dashboard home office warning", () => {
  const derived = loaderData.derived as { homeOfficeAreaRejected?: number };

  afterEach(() => {
    delete derived.homeOfficeAreaRejected;
  });

  it("warns, in one line with a link to Home office, when a config's office is larger than its home", () => {
    derived.homeOfficeAreaRejected = 1;
    render(<Dashboard />);
    const line = screen.getByText(/office larger than the home/).closest("[data-slot=alert]")!;
    expect(line).toHaveTextContent(/deducts \$0/);
    expect(within(line as HTMLElement).getByRole("link", { name: /Home office/ })).toHaveAttribute(
      "href",
      "/home-office",
    );
  });

  it("says nothing when every config's area is fine", () => {
    render(<Dashboard />);
    expect(screen.queryByText(/office larger than the home/)).not.toBeInTheDocument();
  });
});

describe("dashboard Section 179 notice (equipment over $2,500, unflagged)", () => {
  const derived = loaderData.derived as { equipmentAssumedSection179?: number };

  afterEach(() => {
    delete derived.equipmentAssumedSection179;
  });

  it("says the full deduction assumes a §179 election, with a link to Expenses", () => {
    derived.equipmentAssumedSection179 = 1;
    render(<Dashboard />);
    const line = screen.getByText(/assumes a Section 179/).closest("[data-slot=alert]")!;
    expect(line).toHaveTextContent(
      "An equipment expense over $2,500 is deducted in full this year, which assumes a Section 179 election.",
    );
    expect(within(line as HTMLElement).getByRole("link", { name: "Expenses" })).toHaveAttribute(
      "href",
      "/expenses",
    );
  });

  it("says nothing when there is none", () => {
    render(<Dashboard />);
    expect(screen.queryByText(/assumes a Section 179/)).not.toBeInTheDocument();
  });
});

describe("dashboard banner for rows before the SE start: the verb agrees with the count", () => {
  const derived = loaderData.derived as {
    excludedBeforeSeStart: { income: number; expense: number; mileage: number };
  };
  const original = { ...derived.excludedBeforeSeStart };

  afterEach(() => {
    derived.excludedBeforeSeStart = { ...original };
  });

  it("one row: '1 expense ... is not counted ... It stays'", () => {
    derived.excludedBeforeSeStart = { income: 0, expense: 1, mileage: 0 };
    render(<Dashboard />);
    expect(
      screen.getByText(
        /^1 expense dated before Mar 2, 2026 is not counted in this estimate\. It stays/,
      ),
    ).toBeInTheDocument();
  });

  it("several rows: '2 expenses ... are not counted ... They stay'", () => {
    derived.excludedBeforeSeStart = { income: 0, expense: 2, mileage: 0 };
    render(<Dashboard />);
    expect(
      screen.getByText(
        /^2 expenses dated before Mar 2, 2026 are not counted in this estimate\. They stay/,
      ),
    ).toBeInTheDocument();
  });

  it("one of each kind is three rows: 'are'", () => {
    derived.excludedBeforeSeStart = { income: 1, expense: 1, mileage: 1 };
    render(<Dashboard />);
    expect(
      screen.getByText(
        /^1 income entry, 1 expense, 1 mileage trip dated before .* are not counted/,
      ),
    ).toBeInTheDocument();
  });
});

describe("dashboard: asks for last year's return when the prior-year safe harbor can't apply", () => {
  const derived = loaderData.derived as { priorYearFiguresApplied?: boolean };
  afterEach(() => {
    delete derived.priorYearFiguresApplied;
  });

  it("figures missing or from another year: 'Enter your 2025 return', with a link to Profile", () => {
    derived.priorYearFiguresApplied = false;
    render(<Dashboard />);
    const line = screen.getByText(/Enter your 2025 return/).closest("[data-slot=alert]")!;
    expect(line).toHaveTextContent("Enter your 2025 return to use the prior-year safe harbor.");
    expect(within(line as HTMLElement).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });

  it("2025 figures applied: says nothing", () => {
    derived.priorYearFiguresApplied = true;
    render(<Dashboard />);
    expect(screen.queryByText(/Enter your 2025 return/)).not.toBeInTheDocument();
  });
});

describe("why 110% of the prior year", () => {
  // Demo data plus a 2025 return: $1,500 total tax, AGI per the case.
  const harborFor = (agiCents: number | null) => {
    const b = exampleBundle();
    b.profile = {
      ...b.profile!,
      priorYearTotalTaxCents: 150_000,
      priorYearAgiCents: agiCents,
      priorYearStateTaxCents: null,
      priorYearFiguresYear: 2025,
    };
    return estimateBundleYear(b, 2026).result.safeHarbor;
  };
  const withHarbor = (harbor: unknown, run: () => void) => {
    const saved = loaderData.result.safeHarbor;
    (loaderData.result as { safeHarbor: unknown }).safeHarbor = harbor;
    try {
      run();
    } finally {
      loaderData.result.safeHarbor = saved;
    }
  };

  it("says AGI was not entered when it is blank, from engine output", () => {
    const harbor = harborFor(null);
    expect(harbor.multiplierReason).toBe("agi_not_entered");
    withHarbor(harbor, () => {
      render(<Dashboard />);
      expect(screen.getByText("110% of prior year")).toBeInTheDocument();
      expect(screen.getByText("AGI not entered, so 110%.")).toBeInTheDocument();
    });
  });

  it("adds no reason when AGI is entered", () => {
    const harbor = harborFor(5_000_000);
    expect(harbor.multiplierReason).toBe("agi_not_over_threshold");
    withHarbor(harbor, () => {
      render(<Dashboard />);
      expect(screen.getByText("100% of prior year")).toBeInTheDocument();
      expect(screen.queryByText(/AGI not entered/)).not.toBeInTheDocument();
    });
  });
});

describe("safe harbor without last year's return", () => {
  // Engine output for demo data with no prior-year figures, SE start per the case.
  const run = (seStartDate: string) => {
    const b = exampleBundle();
    b.profile = { ...b.profile!, seStartDate };
    const { result, derived } = estimateBundleYear(b, 2026);
    const saved = { harbor: loaderData.result.safeHarbor, se: loaderData.derived.seStartDate };
    (loaderData.result as { safeHarbor: unknown }).safeHarbor = result.safeHarbor;
    loaderData.derived.seStartDate = derived.seStartDate;
    return () => {
      loaderData.result.safeHarbor = saved.harbor;
      loaderData.derived.seStartDate = saved.se;
    };
  };

  it("says 'not entered', with no first-year alert, for a business started years earlier", () => {
    const restore = run("2024-01-01");
    try {
      render(<Dashboard />);
      expect(screen.getByText("not entered")).toBeInTheDocument();
      expect(screen.queryByText("n/a (first year)")).not.toBeInTheDocument();
      expect(screen.queryByText("First-year filing")).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("says 'n/a (first year)' with the first-year alert when self-employment began this year", () => {
    const restore = run("2026-03-02");
    try {
      render(<Dashboard />);
      expect(screen.getByText("n/a (first year)")).toBeInTheDocument();
      expect(screen.getByText("First-year filing")).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

describe("equipment ticked Startup", () => {
  it("shows a one-line notice from engine output (demo laptop ticked Startup before the SE start)", () => {
    const b = exampleBundle();
    b.profile = { ...b.profile!, seStartDate: "2026-02-01" };
    const base = b.expenses[0]!;
    b.expenses = [
      ...b.expenses,
      {
        ...base,
        id: "ex_demo_laptop",
        date: "2026-01-10",
        category: "equipment",
        amountCents: 120_000,
        startupExpense: true,
      },
    ];
    const { derived } = estimateBundleYear(b, 2026);
    expect(derived.startupIgnoredForEquipment).toBe(1);
    const d = loaderData.derived as { startupIgnoredForEquipment?: number };
    d.startupIgnoredForEquipment = derived.startupIgnoredForEquipment;
    try {
      render(<Dashboard />);
      expect(
        screen.getByText(/1 equipment expense is ticked Startup\. Equipment isn't a startup cost/),
      ).toBeInTheDocument();
    } finally {
      delete d.startupIgnoredForEquipment;
    }
  });

  it("shows nothing when no equipment is ticked Startup", () => {
    render(<Dashboard />);
    expect(screen.queryByText(/ticked Startup/)).not.toBeInTheDocument();
  });
});
