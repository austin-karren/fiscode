import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn(async () => undefined) }));

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({
  timeRepo: { list: async () => [], create, update: vi.fn(), softDelete: vi.fn() },
  clientRepo: { listIncludingDeleted: async () => [] },
  profileRepo: { get: async () => null },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({ entries: [], clients: [], profile: null }),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { Route } from "./time";

const TimePage = Route.options.component!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("time entry hours", () => {
  const submit = (hours: string) => {
    render(<TimePage />);
    const input = screen.getByLabelText("Hours");
    fireEvent.change(input, { target: { value: hours } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    return input;
  };

  it.each([
    ["1.33", "Enter hours in quarter-hour steps, like 1.25"],
    ["30", "Enter 24 hours or fewer for one day"],
    ["0", "Enter hours greater than 0, like 1.5"],
    ["abc", "Enter hours greater than 0, like 1.5"],
  ])("does not save %j and says why inline", async (hours, message) => {
    const input = submit(hours);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(create).not.toHaveBeenCalled();
  });

  it("leaves the step rule to the form, not the browser", () => {
    render(<TimePage />);
    const input = screen.getByLabelText("Hours");
    expect(input).not.toHaveAttribute("step");
    expect(input).toHaveAttribute("inputmode", "decimal");
  });

  it("saves quarter hours as minutes", async () => {
    submit("1.25");
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ minutes: 75 })),
    );
  });
});
