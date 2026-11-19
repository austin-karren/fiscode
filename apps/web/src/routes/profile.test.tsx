import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Toaster, toast } from "sonner";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The bug only shows west of UTC, where midnight UTC is still the day
// before. CI runs in UTC, so pin a western zone for this file.
const { upsert, invalidate, spouseSoftDelete, spouseRevertTo, originalTz } = vi.hoisted(() => {
  const originalTz = process.env.TZ;
  process.env.TZ = "America/Denver";
  return {
    upsert: vi.fn(async () => {}),
    invalidate: vi.fn(),
    spouseSoftDelete: vi.fn(async () => true),
    spouseRevertTo: vi.fn(async () => undefined),
    originalTz,
  };
});

// What the loader returns; a test may give it entity periods or spouse blocks.
const loaded: { profile: typeof profile; entities: unknown[]; spouses: unknown[] } = {
  get profile() {
    return profile;
  },
  entities: [],
  spouses: [],
};

// Demo profile, as the loader would return it. Dates are stored date-only.
const profile = {
  filingStatus: "single",
  state: "UT",
  seStartDate: "2026-03-02",
  dependents: 0,
  tracksRoth: false,
  usesRetirement: false,
  quarterlyMethod: "annualized",
  prepLeadDays: 14,
};

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({
  profileRepo: { get: async () => profile, upsert },
  entityRepo: { list: async () => [], create: vi.fn(), update: vi.fn() },
  spouseRepo: {
    list: async () => [],
    create: vi.fn(),
    update: vi.fn(),
    softDelete: spouseSoftDelete,
    revertTo: spouseRevertTo,
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => loaded,
  useRouter: () => ({ invalidate }),
}));

import { Route } from "./profile";
import { expectNoRawValues } from "../test/raw-values";

const ProfilePage = Route.options.component!;

afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.clearAllMocks();
});

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("profile form, west of UTC", () => {
  it("runs in a timezone behind UTC", () => {
    expect(new Date("2026-03-02").getDate()).toBe(1);
  });

  it("shows the stored self-employment start date", () => {
    render(<ProfilePage />);
    expect(screen.getByRole("button", { name: /Self-employment start date/ })).toHaveAccessibleName(
      expect.stringContaining("Mar 2, 2026"),
    );
  });

  it("saves an untouched profile without the scope confirm and keeps the stored date", async () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ seStartDate: "2026-03-02" }));
    expect(screen.queryByText("Save changes to scope-shifting fields?")).not.toBeInTheDocument();
  });
});

describe("profile period lists", () => {
  afterEach(() => {
    loaded.entities = [];
    loaded.spouses = [];
  });

  it("shows periods with readable dates and entity names, never stored values", () => {
    const FIXED = "2026-06-04T12:00:00.000Z";
    loaded.entities = [
      {
        id: "ent_demo",
        type: "single_member_llc",
        startDate: "2026-03-02",
        endDate: null,
        notes: null,
        deletedAt: null,
        createdAt: FIXED,
        updatedAt: FIXED,
      },
    ];
    loaded.spouses = [
      {
        id: "sp_demo",
        startDate: "2026-01-01",
        endDate: "2026-06-30",
        annualW2WagesCents: 4_500_000,
        annualFederalWithholdingCents: 0,
        annualStateWithholdingCents: 0,
        notes: null,
        deletedAt: null,
        createdAt: FIXED,
        updatedAt: FIXED,
      },
    ];
    render(<ProfilePage />);
    const lists = screen.getAllByRole("list");
    const text = lists.map((l) => l.textContent).join(" ");
    expect(text).toContain("Mar 2, 2026 – open");
    expect(text).toContain("Single-member LLC");
    expect(text).toContain("Jan 1, 2026 – Jun 30, 2026");
    for (const list of lists) expectNoRawValues(list);
  });
});

describe("spouse income blocks", () => {
  const FIXED = "2026-06-04T12:00:00.000Z";
  const block = {
    id: "sp_demo",
    startDate: "2026-01-01",
    endDate: null,
    annualW2WagesCents: 4_500_000,
    annualFederalWithholdingCents: 0,
    annualStateWithholdingCents: 0,
    notes: null,
    deletedAt: null,
    createdAt: FIXED,
    updatedAt: FIXED,
  };
  const card = () =>
    screen.getByText("Spouse income blocks").closest("[data-slot=card]") as HTMLElement;
  const WHY = /Spouse income counts only on a joint return/;

  afterEach(() => {
    profile.filingStatus = "single";
    loaded.spouses = [];
  });

  it("takes new blocks when filing jointly", () => {
    profile.filingStatus = "mfj";
    render(<ProfilePage />);
    expect(within(card()).getByLabelText("Annual W-2 wages (optional)")).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(card()).not.toHaveTextContent(WHY);
  });

  it("says why, and takes no new block, under any other filing status", () => {
    render(<ProfilePage />);
    expect(card()).toHaveTextContent(WHY);
    expect(within(card()).queryByLabelText("Annual W-2 wages (optional)")).not.toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("keeps showing an existing block under another status, with Edit and Delete", () => {
    loaded.spouses = [block];
    render(<ProfilePage />);
    expect(card()).toHaveTextContent("Jan 1, 2026 – open");
    expect(within(card()).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("deletes a block at once, and Undo brings back the exact block", async () => {
    loaded.spouses = [block];
    render(
      <>
        <ProfilePage />
        <Toaster />
      </>,
    );
    fireEvent.click(within(card()).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(spouseSoftDelete).toHaveBeenCalledWith("sp_demo"));
    expect(invalidate).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(spouseRevertTo).toHaveBeenCalledWith("sp_demo", block));
  });
});
