import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The bug only shows west of UTC, where midnight UTC is still the day
// before. CI runs in UTC, so pin a western zone for this file.
const { upsert, invalidate, originalTz } = vi.hoisted(() => {
  const originalTz = process.env.TZ;
  process.env.TZ = "America/Denver";
  return { upsert: vi.fn(async () => {}), invalidate: vi.fn(), originalTz };
});
const { moveFirstStart } = vi.hoisted(() => ({
  moveFirstStart: vi.fn(async () => ({ moved: true, id: "ent_1", from: "2026-11-02" })),
}));

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
  entityRepo: { list: async () => [], create: vi.fn(), update: vi.fn(), moveFirstStart },
  spouseRepo: { list: async () => [], create: vi.fn(), update: vi.fn() },
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

describe("changing the SE start offers to move the first entity period", () => {
  // Demo: the entity period was restored with a later start than the new SE start.
  const soleProp = {
    id: "ent_1",
    type: "sole_prop",
    startDate: "2026-11-02",
    endDate: null,
    notes: null,
    deletedAt: null,
    createdAt: "2026-06-04T12:00:00.000Z",
    updatedAt: "2026-06-04T12:00:00.000Z",
  };
  afterEach(() => {
    loaded.entities = [];
  });

  const changeStartTo = async (typedDate: string) => {
    fireEvent.click(screen.getByRole("button", { name: /Self-employment start date/ }));
    const typed = await screen.findByLabelText("Type a date");
    fireEvent.change(typed, { target: { value: typedDate } });
    fireEvent.keyDown(typed, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Save changes to scope-shifting fields?");
  };
  const moveBox = () =>
    screen.queryByRole("checkbox", { name: /Also move your first entity period/ });

  it("ticks the move by default and moves the period after saving the profile", async () => {
    loaded.entities = [soleProp];
    render(<ProfilePage />);
    await changeStartTo("01/15/2026");

    expect(moveBox()).toBeChecked();
    expect(moveBox()).toHaveAccessibleName(
      "Also move your first entity period (Sole proprietor) to start Jan 15, 2026, from Nov 2, 2026.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(moveFirstStart).toHaveBeenCalledWith("2026-01-15"));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ seStartDate: "2026-01-15" }));
  });

  it("saves the profile only when the box is cleared", async () => {
    loaded.entities = [soleProp];
    render(<ProfilePage />);
    await changeStartTo("01/15/2026");
    fireEvent.click(moveBox()!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(moveFirstStart).not.toHaveBeenCalled();
  });

  it("offers nothing when there is no entity period", async () => {
    render(<ProfilePage />);
    await changeStartTo("01/15/2026");
    expect(moveBox()).not.toBeInTheDocument();
  });

  it("offers nothing when the first period already starts on the new date", async () => {
    loaded.entities = [{ ...soleProp, startDate: "2026-01-15" }];
    render(<ProfilePage />);
    await changeStartTo("01/15/2026");
    expect(moveBox()).not.toBeInTheDocument();
  });
});
