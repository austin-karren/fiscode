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

  it("says the period stays, without a box, when the move would end before it starts", async () => {
    // Review r1 demo B: sole prop Jan 5 – Feb 28 (closed), LLC Mar 1 – open, new start Mar 2.
    loaded.entities = [
      { ...soleProp, startDate: "2026-01-05", endDate: "2026-02-28" },
      { ...soleProp, id: "ent_2", type: "single_member_llc", startDate: "2026-03-01" },
    ];
    render(<ProfilePage />);
    await changeStartTo("03/03/2026");

    expect(moveBox()).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Your first entity period ends Feb 28, 2026, before Mar 3, 2026, so it stays as it is. Edit it under Entity periods if you need to.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(moveFirstStart).not.toHaveBeenCalled();
  });

  it("r2 demo C: a stored overlap the move would grow is not offered, and says why", async () => {
    loaded.entities = [
      { ...soleProp, startDate: "2026-03-01" },
      { ...soleProp, id: "ent_2", type: "single_member_llc", startDate: "2026-06-01" },
    ];
    render(<ProfilePage />);
    await changeStartTo("02/02/2026");
    expect(moveBox()).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /^Your first entity period stays as it is\. This period already overlaps your Single-member LLC period that started Jun 1, 2026/,
      ),
    ).toBeInTheDocument();
  });

  it("r2 demo D: shrinking out of one stored overlap is offered, ticked", async () => {
    loaded.entities = [
      { ...soleProp, startDate: "2026-01-05", endDate: "2026-12-31" },
      {
        ...soleProp,
        id: "ent_2",
        type: "single_member_llc",
        startDate: "2026-02-01",
        endDate: "2026-02-28",
      },
      { ...soleProp, id: "ent_3", type: "single_member_llc", startDate: "2026-06-01" },
    ];
    render(<ProfilePage />);
    await changeStartTo("03/01/2026");
    expect(moveBox()).toBeChecked();
  });

  it("does not claim nothing changes while the box is shown", async () => {
    loaded.entities = [soleProp];
    render(<ProfilePage />);
    await changeStartTo("01/15/2026");
    expect(screen.queryByText(/The underlying data is unchanged/)).not.toBeInTheDocument();
    expect(screen.getByText(/Your rows are unchanged\./)).toBeInTheDocument();
  });

  it("ticks the box again each time the dialog opens", async () => {
    loaded.entities = [soleProp];
    render(<ProfilePage />);
    await changeStartTo("01/15/2026");
    fireEvent.click(moveBox()!);
    expect(moveBox()).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("Save changes to scope-shifting fields?")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Save changes to scope-shifting fields?");
    expect(moveBox()).toBeChecked();
  });

  it("offers nothing when the first period already starts on the new date", async () => {
    loaded.entities = [{ ...soleProp, startDate: "2026-01-15" }];
    render(<ProfilePage />);
    await changeStartTo("01/15/2026");
    expect(moveBox()).not.toBeInTheDocument();
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
    expect(within(card()).getByLabelText("Annual W-2 wages")).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(card()).not.toHaveTextContent(WHY);
  });

  it("says why, and takes no new block, under any other filing status", () => {
    render(<ProfilePage />);
    expect(card()).toHaveTextContent(WHY);
    expect(within(card()).queryByLabelText("Annual W-2 wages")).not.toBeInTheDocument();
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
