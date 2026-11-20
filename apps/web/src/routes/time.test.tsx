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
  useLoaderData: () => loaded,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { Route } from "./time";

// What the loader returns; a test may give it rows.
const loaded: { entries: unknown[]; clients: unknown[]; profile: null } = {
  entries: [],
  clients: [],
  profile: null,
};

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
    ["1.33", "Use quarter hours, like 1.25"],
    ["30", "24 hours at most"],
    ["0", "Must be more than 0"],
    ["abc", "Enter hours, like 1.5"],
  ])("does not save %j and says why inline", async (hours, message) => {
    const input = submit(hours);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(create).not.toHaveBeenCalled();
  });

  it("saves on Enter once a rejected value is corrected, without leaving the field", async () => {
    render(<TimePage />);
    const input = screen.getByLabelText("Hours");
    input.focus();
    fireEvent.change(input, { target: { value: "1.33" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Use quarter hours, like 1.25")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "1.25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ minutes: 75 })),
    );
    expect(screen.queryByText("Use quarter hours, like 1.25")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
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

describe("duplicating a time entry", () => {
  afterEach(() => {
    loaded.entries = [];
  });

  it("fills odd imported minutes exactly, never rounded to the quarter hour", () => {
    loaded.entries = [
      {
        id: "te_demo",
        date: "2026-03-02",
        clientId: null,
        minutes: 83,
        description: "Demo imported entry",
        notes: null,
        deletedAt: null,
      },
    ];
    render(<TimePage />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    // 83 minutes is off the form's quarter-hour step: shown as h:mm, which
    // saves back as the same 83 minutes.
    expect(screen.getAllByLabelText("Hours")[0]).toHaveValue("1:23");
  });
});
