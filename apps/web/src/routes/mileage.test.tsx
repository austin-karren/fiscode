import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// SQLite over OPFS and the router's history do not exist in jsdom; both are
// replaced at the package boundary. Demo data: no trips, no vehicles.
vi.mock("@fiscode/db", () => ({
  mileageRepo: { list: async () => [], create: vi.fn(), softDelete: vi.fn() },
  vehicleRepo: { listIncludingDeleted: async () => [] },
  profileRepo: { get: async () => null },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({ mileage: [], vehicles: [], profile: null }),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { Route } from "./mileage";

const MileagePage = Route.options.component!;

afterEach(cleanup);

describe("business miles hint", () => {
  it("comes after its field in Tab order, and the field still carries the hint", () => {
    render(<MileagePage />);
    const miles = screen.getByRole("textbox", { name: "Business miles" });
    const hint = screen.getByRole("button", { name: "More info" });
    // DOM order is Tab order: the field, then its hint.
    expect(miles.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(miles).toHaveAccessibleDescription(/./);
  });
});
