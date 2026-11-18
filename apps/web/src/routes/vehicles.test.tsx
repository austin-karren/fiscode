import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

// Demo data: one live vehicle with mileage, one archived vehicle.
const liveVehicle = {
  id: "v_live",
  make: "Demo",
  model: "Wagon",
  year: 2022,
  mpg: 28,
  method: "standard_mileage",
  inServiceDate: null,
  notes: null,
  deletedAt: null,
};
const archivedVehicle = {
  ...liveVehicle,
  id: "v_arch",
  model: "Coupe",
  deletedAt: "2026-02-01T00:00:00.000Z",
};

const { softDelete, revertTo, invalidate } = vi.hoisted(() => ({
  softDelete: vi.fn(async () => true),
  revertTo: vi.fn(async () => undefined),
  invalidate: vi.fn(),
}));

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({
  vehicleRepo: {
    list: async () => [],
    listIncludingDeleted: async () => [],
    create: vi.fn(),
    update: vi.fn(),
    softDelete,
    revertTo,
  },
  mileageRepo: { list: async () => [] },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({
    vehicles: [liveVehicle, archivedVehicle],
    mileage: [
      { id: "m_1", vehicleId: "v_live" },
      { id: "m_2", vehicleId: "v_arch" },
    ],
  }),
  useRouter: () => ({ invalidate }),
}));

import { Route } from "./vehicles";

const VehiclesPage = Route.options.component!;

const renderPage = () =>
  render(
    <>
      <VehiclesPage />
      <Toaster />
    </>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("archiving a vehicle", () => {
  it("asks first with the mileage count, then archives and offers Undo", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Archive Demo Wagon?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("1 mileage entry references it.");
    expect(softDelete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(softDelete).toHaveBeenCalledWith("v_live"));

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(revertTo).toHaveBeenCalledWith("v_live", liveVehicle));
  });

  it("shows archived vehicles on request and un-archives one", async () => {
    renderPage();
    expect(screen.queryByText("Coupe")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show archived (1)" }));

    const row = screen.getByText("Coupe").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Un-archive" }));
    await waitFor(() =>
      expect(revertTo).toHaveBeenCalledWith("v_arch", { ...archivedVehicle, deletedAt: null }),
    );
  });
});
