import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The bug only shows west of UTC, where midnight UTC is still the day
// before. CI runs in UTC, so pin a western zone for this file.
const { upsert, invalidate, originalTz } = vi.hoisted(() => {
  const originalTz = process.env.TZ;
  process.env.TZ = "America/Denver";
  return { upsert: vi.fn(async () => {}), invalidate: vi.fn(), originalTz };
});

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
  spouseRepo: { list: async () => [], create: vi.fn(), update: vi.fn() },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({ profile, entities: [], spouses: [] }),
  useRouter: () => ({ invalidate }),
}));

import { Route } from "./profile";

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
