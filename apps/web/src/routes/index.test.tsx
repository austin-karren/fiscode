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
  // The vault migration is done: every write is on (vault PR 9).
  getVaultMigrationState: (
    (done) => () =>
      done
  )({ phase: "done" }),
  onVaultMigrationState: () => () => {},
  // The vault settings banner and card (ADR 0001 § 11): nothing picked, nothing to reconnect.
  onVaultChange: () => () => {},
  vaultPermissionState: async () => "opfs",
  requestVaultPermission: async () => "opfs",
  canPickFolder: () => false,
  pickedFolderName: () => undefined,
  pendingVaultSwitch: async () => undefined,
  switchVaultToFolder: vi.fn(),
  switchVaultToOpfs: vi.fn(),

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
function emptyPayments() {
  const q = (quarter: 1 | 2 | 3 | 4, dueDate: string) => ({
    quarter,
    dueDate,
    requiredThrough: 0,
    paidByDueDate: 0,
    shortfall: 0,
    paidAppliedHere: 0,
  });
  return {
    federal: {
      withholding: 0,
      estimates: 0,
      totalPaid: 0,
      target: 0,
      remaining: 0,
      quarters: [q(1, "2026-04-15"), q(2, "2026-06-15"), q(3, "2026-09-15"), q(4, "2027-01-15")],
      safeHarborMet: true,
    },
    state: undefined,
  };
}

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
    priorYearNotFiled: null,
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
  // DF-07: nothing paid, no return entered.
  payments: emptyPayments() as PaymentsResult,
  priorYearBasis: "not_entered" as "entered" | "not_entered" | "not_filed",
};

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => loaderData,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { exampleBundle } from "@fiscode/csv";
import { estimateBundleYear, type PaymentsResult } from "@fiscode/tax";

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

  it("has no first-year warning and no interrupting alert in the safe harbor card", () => {
    // Demo loader data: SE start Mar 2, 2026, no prior-year figures.
    render(<Dashboard />);
    expect(screen.getByText("not entered")).toBeInTheDocument();
    expect(screen.queryByText("First-year filing")).not.toBeInTheDocument();
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

  it("figures missing or from another year: asks for a 2025 return, with a link to Profile", () => {
    derived.priorYearFiguresApplied = false;
    render(<Dashboard />);
    const line = screen.getByText(/Filed a 2025 return/).closest("[data-slot=alert]")!;
    expect(line).toHaveTextContent(
      "Filed a 2025 return (W-2 or otherwise)? Enter it on Profile to use the prior-year safe harbor.",
    );
    expect(within(line as HTMLElement).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });

  it("2025 figures applied: says nothing", () => {
    derived.priorYearFiguresApplied = true;
    render(<Dashboard />);
    expect(screen.queryByText(/Filed a 2025 return/)).not.toBeInTheDocument();
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
  // Engine output for demo data, SE start and 2025 return per the case.
  const run = (seStartDate: string, priorYearTotalTaxCents: number | null) => {
    const b = exampleBundle();
    b.profile = {
      ...b.profile!,
      seStartDate,
      priorYearTotalTaxCents,
      priorYearAgiCents: null,
      priorYearStateTaxCents: null,
      priorYearFiguresYear: priorYearTotalTaxCents === null ? null : 2025,
    };
    const { result, derived } = estimateBundleYear(b, 2026);
    const saved = { harbor: loaderData.result.safeHarbor, se: loaderData.derived.seStartDate };
    const d = loaderData.derived as { priorYearFiguresApplied?: boolean };
    (loaderData.result as { safeHarbor: unknown }).safeHarbor = result.safeHarbor;
    loaderData.derived.seStartDate = derived.seStartDate;
    d.priorYearFiguresApplied = derived.priorYearFiguresApplied;
    return () => {
      loaderData.result.safeHarbor = saved.harbor;
      loaderData.derived.seStartDate = saved.se;
      delete d.priorYearFiguresApplied;
    };
  };
  const PROMPT =
    "Filed a 2025 return (W-2 or otherwise)? Enter it on Profile to use the prior-year safe harbor.";

  it("says 'not entered', with no first-year alert, for a business started years earlier", () => {
    const restore = run("2024-01-01", null);
    try {
      render(<Dashboard />);
      expect(screen.getByText("not entered")).toBeInTheDocument();
      expect(screen.queryByText("First-year filing")).not.toBeInTheDocument();
      // The page notice asks for the return, once.
      expect(screen.getAllByText(/Filed a 2025 return/)).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("SE start this year, figures blank: 'not entered', and the request for a 2025 return once, never 'first year'", () => {
    const restore = run("2026-03-02", null);
    try {
      render(<Dashboard />);
      expect(screen.getByText("not entered")).toBeInTheDocument();
      expect(screen.queryByText(/first year/i)).not.toBeInTheDocument();
      expect(screen.queryByText("First-year filing")).not.toBeInTheDocument();
      expect(screen.queryByText(/90% of current-year tax/)).not.toBeInTheDocument();
      const asks = screen.getAllByText(/Filed a 2025 return/);
      expect(asks).toHaveLength(1);
      const notice = asks[0]!.closest("[data-slot=alert]") as HTMLElement;
      expect(notice).toHaveTextContent(PROMPT);
      expect(within(notice).getByRole("link", { name: "Profile" })).toHaveAttribute(
        "href",
        "/profile",
      );
    } finally {
      restore();
    }
  });

  it("SE start this year with a 2025 return entered: the prior-year safe harbor shows", () => {
    const restore = run("2026-03-02", 150_000);
    try {
      render(<Dashboard />);
      const field = screen.getByText("110% of prior year").parentElement!;
      expect(field).toHaveTextContent("$1,650.00");
      expect(screen.queryByText("not entered")).not.toBeInTheDocument();
      expect(screen.queryByText(/Filed a 2025 return/)).not.toBeInTheDocument();
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

describe("paid so far (DF-07, from engine output)", () => {
  // The brief's demo: a W-2 Jan 1 - Feb 18 (Demo Corp: $8,500 wages, $950.50 federal and $380
  // Utah withheld), $1,200 federal on Apr 10 and Jun 10, $300 to Utah on Jun 10. `moreIncome`
  // adds a demo 1099 row so installments are required.
  const FIXED = "2026-06-04T12:00:00.000Z";
  const dated = { createdAt: FIXED, updatedAt: FIXED, deletedAt: null };
  const pay = (id: string, date: string, amountCents: number, jurisdiction: string) => ({
    ...dated,
    id,
    date,
    amountCents,
    jurisdiction,
    taxYear: 2026,
    appliedQuarter: null,
    notes: null,
  });
  const engine = (moreIncome: boolean) => {
    const b = exampleBundle();
    b.w2Jobs = [
      {
        ...dated,
        id: "w2_demo",
        taxYear: 2026,
        employer: "Demo Corp",
        startDate: "2026-01-01",
        endDate: "2026-02-18",
        wagesCents: 850_000,
        federalWithholdingCents: 95_050,
        ssWagesCents: 850_000,
        ssTaxWithheldCents: 52_700,
        medicareWagesCents: 850_000,
        ssTipsCents: 0,
        stateWagesCents: 850_000,
        stateWithholdingCents: 38_000,
        notes: null,
      },
    ];
    b.estimatedPayments = [
      pay("p1", "2026-04-10", 120_000, "federal"),
      pay("p2", "2026-06-10", 120_000, "federal"),
      pay("p3", "2026-06-10", 30_000, "UT"),
    ];
    if (moreIncome) {
      b.income = [...b.income, { ...b.income[0]!, id: "in_demo_big", amountCents: 6_000_000 }];
    }
    return estimateBundleYear(b, 2026).result;
  };
  const usd = (c: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
  const withResult = (result: ReturnType<typeof engine>, run: () => void) => {
    const saved = { payments: loaderData.payments, quarterly: loaderData.result.quarterly };
    loaderData.payments = result.payments;
    (loaderData.result as { quarterly: unknown }).quarterly = result.quarterly;
    try {
      run();
    } finally {
      loaderData.payments = saved.payments;
      (loaderData.result as { quarterly: unknown }).quarterly = saved.quarterly;
    }
  };

  it("shows each quarter's due-by, paid-by and shortfall, and the federal and Utah totals", () => {
    const result = engine(true);
    const { federal, state } = result.payments;
    expect(result.quarterly.noInstallmentsRequired).not.toBe(true);
    expect(federal.estimates).toBe(240_000);
    withResult(result, () => {
      render(<Dashboard />);
      for (const q of federal.quarters) {
        const row = screen.getByText(new RegExp(`^Q${q.quarter}, due`)).closest("tr")!;
        expect(row).toHaveTextContent(usd(q.requiredThrough));
        expect(row).toHaveTextContent(usd(q.paidByDueDate));
        expect(row).toHaveTextContent(q.shortfall > 0 ? usd(q.shortfall) : "—");
      }
      expect(screen.getByText(/^Federal:/).closest("p")).toHaveTextContent(
        `Federal: ${usd(federal.totalPaid)} paid of ${usd(federal.target)} (${usd(federal.withholding)} withheld, ${usd(federal.estimates)} in payments). ${usd(federal.remaining)} still due.`,
      );
      expect(screen.getByText(/^Utah:/).closest("p")).toHaveTextContent(
        `Utah: ${usd(state!.totalPaid)} paid (${usd(state!.withholding)} withheld, ${usd(state!.estimates)} in payments).`,
      );
      expect(screen.getByText(/doesn't calculate an underpayment penalty yet/)).toBeInTheDocument();
    });
  });

  it("mutes quarters already past", () => {
    withResult(engine(true), () => {
      render(<Dashboard />);
      // This file runs on July 1, 2026: Q1 (Apr 15) and Q2 (Jun 15) are past; Q3 is not.
      expect(screen.getByText(/^Q1, due/).closest("tr")).toHaveClass("text-muted-foreground");
      expect(screen.getByText(/^Q2, due/).closest("tr")).toHaveClass("text-muted-foreground");
      expect(screen.getByText(/^Q3, due/).closest("tr")).not.toHaveClass("text-muted-foreground");
    });
  });

  it("agrees with the quarterly card under the $1,000 rule: 'No payment required', no shortfall", () => {
    const result = engine(false);
    expect(result.quarterly.noInstallmentsRequired).toBe(true);
    expect(result.payments.federal.target).toBe(0);
    withResult(result, () => {
      render(<Dashboard />);
      expect(screen.getByText(/^Federal:/).closest("p")).toHaveTextContent(
        "No payment required: under $1,000 owed after withholding.",
      );
      expect(screen.queryByText(/still due\./)).not.toBeInTheDocument();
      expect(screen.getByText("On track")).toBeInTheDocument();
      for (const n of [1, 2, 3, 4]) {
        expect(screen.getByText(new RegExp(`^Q${n}, due`)).closest("tr")).toHaveTextContent(/—$/);
      }
    });
  });
});

describe("didn't file a 2025 return (DF-07)", () => {
  it("shows the 90% alert, and not the request for a return", () => {
    const saved = loaderData.priorYearBasis;
    const d = loaderData.derived as { priorYearFiguresApplied?: boolean };
    loaderData.priorYearBasis = "not_filed";
    d.priorYearFiguresApplied = false;
    try {
      render(<Dashboard />);
      const alert = screen.getByText("No 2025 return filed").closest("[data-slot=alert]");
      expect(alert).toHaveTextContent(/target is 90% of this year's tax/);
      expect(screen.queryByText(/Filed a 2025 return/)).not.toBeInTheDocument();
    } finally {
      loaderData.priorYearBasis = saved;
      delete d.priorYearFiguresApplied;
    }
  });

  it("shows no 90% alert when the return is just not entered", () => {
    render(<Dashboard />);
    expect(screen.queryByText("No 2025 return filed")).not.toBeInTheDocument();
  });
});

describe("safe harbor card when the return wasn't filed (REVIEW #80 r1 F2)", () => {
  it("says 'not filed', not 'not entered'", () => {
    const saved = loaderData.priorYearBasis;
    loaderData.priorYearBasis = "not_filed";
    try {
      render(<Dashboard />);
      expect(screen.getByText("not filed")).toBeInTheDocument();
      expect(screen.queryByText("not entered")).not.toBeInTheDocument();
    } finally {
      loaderData.priorYearBasis = saved;
    }
  });
});
