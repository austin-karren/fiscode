import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoRawValues } from "../test/raw-values";

// The tax-data cache is SQLite over OPFS and the router needs a browser
// history; neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("../lib/tax-sync", () => ({
  statusForYear: vi.fn(),
  syncTaxYearData: vi.fn(),
  TaxSyncError: class extends Error {},
  yearsToTrack: () => [2025, 2026],
}));

const statuses = [
  {
    year: 2026,
    source: "remote",
    schemaVersion: "1",
    remoteSource: "fiscode 2026",
    sourceUrl: "/tax-data/v1/2026.json",
    fetchedAt: "2026-11-18T16:00:00.000Z",
    ageMs: 0,
    isStale: false,
  },
  {
    year: 2025,
    source: "hardcoded",
    schemaVersion: undefined,
    remoteSource: undefined,
    sourceUrl: "/tax-data/v1/2025.json",
    fetchedAt: undefined,
    ageMs: undefined,
    isStale: false,
  },
];

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({ statuses }),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { Route } from "./tax-data";

const TaxDataPage = Route.options.component!;

afterEach(cleanup);

const card = (year: number) =>
  screen.getByText(`Tax year ${year}`).closest("[data-slot=card]") as HTMLElement;

describe("tax data cards", () => {
  it("says a downloaded year was downloaded, and names its data file", () => {
    render(<TaxDataPage />);
    const c = within(card(2026));
    expect(c.getByText("Downloaded")).toBeInTheDocument();
    expect(c.getByText("fiscode 2026")).toBeInTheDocument();
    expect(c.queryByText("Remote")).not.toBeInTheDocument();
  });

  it("says a year not downloaded yet uses the figures built into the app", () => {
    render(<TaxDataPage />);
    const c = within(card(2025));
    expect(c.getByText("Built in")).toBeInTheDocument();
    expect(c.getByText("Built into the app (not downloaded yet)")).toBeInTheDocument();
  });

  it("shows when a year was fetched as a local date and time, not a stored timestamp", () => {
    render(<TaxDataPage />);
    expect(card(2026)).toHaveTextContent(/Nov 18, 2026, \d{1,2}:00 (AM|PM)/);
    for (const year of [2026, 2025]) expectNoRawValues(card(year));
  });

  it("uses one term for each source: downloaded, or built into the app", () => {
    render(<TaxDataPage />);
    expect(document.body).not.toHaveTextContent(/bundled/i);
    expect(document.body).toHaveTextContent("the figures built into the app are used");
  });
});
