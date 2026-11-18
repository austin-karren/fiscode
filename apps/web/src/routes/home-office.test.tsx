import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
const { create, invalidate } = vi.hoisted(() => ({
  create: vi.fn(async () => {}),
  invalidate: vi.fn(),
}));

vi.mock("@fiscode/db", () => ({
  homeOfficeRepo: { list: async () => [], create },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({ rows: [] }),
  useRouter: () => ({ invalidate }),
}));

import { Route } from "./home-office";

const HomeOfficePage = Route.options.component!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const saveButton = () => screen.getByRole("button", { name: "Save" });
const ackBox = () => screen.getByRole("checkbox");
const ackError = "Acknowledge regular & exclusive use";

describe("home office form", () => {
  it("ticks the acknowledgement when its label is clicked", () => {
    render(<HomeOfficePage />);
    const label = screen.getByText("Regular & exclusive use");
    expect(label.tagName).toBe("LABEL");
    expect(document.getElementById(label.getAttribute("for")!)).not.toBeNull();

    fireEvent.click(label);
    expect(ackBox()).toBeChecked();
  });

  it("marks the acknowledgement invalid when submitted without it", async () => {
    render(<HomeOfficePage />);
    fireEvent.click(saveButton());

    await screen.findByText(ackError);
    expect(ackBox()).toHaveAttribute("aria-invalid", "true");
    expect(create).not.toHaveBeenCalled();
  });

  it("can be submitted once the acknowledgement is ticked after a failed submit", async () => {
    render(<HomeOfficePage />);
    fireEvent.click(saveButton());
    await screen.findByText(ackError);

    fireEvent.click(ackBox());

    await waitFor(() => expect(screen.queryByText(ackError)).not.toBeInTheDocument());
    expect(saveButton()).toBeEnabled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ method: "simplified", regularExclusiveAck: true }),
    );
  });
});
