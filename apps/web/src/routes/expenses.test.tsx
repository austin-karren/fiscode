import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The database is SQLite over OPFS and the router needs a browser history;
// neither exists in jsdom. Both are replaced at the package boundary.
vi.mock("@fiscode/db", () => ({
  expenseRepo: { list: async () => [], create: vi.fn(), update: vi.fn(), softDelete: vi.fn() },
  profileRepo: { get: async () => null },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLoaderData: () => ({ expenses: [], profile: null }),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { Route } from "./expenses";

const ExpensesPage = Route.options.component!;

afterEach(cleanup);

describe("expense form choice cards", () => {
  it("names each checkbox by its card text, without the info button", () => {
    render(<ExpensesPage />);
    expect(
      screen.getByRole("checkbox", {
        name: "§179 candidate Equipment you'd like to fully expense this year rather than depreciate.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /^Startup expense \(Section 195\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More info about §179 candidate" }),
    ).toBeInTheDocument();
  });

  it("ticks a checkbox when its card title is clicked", () => {
    render(<ExpensesPage />);
    fireEvent.click(screen.getByText("§179 candidate"));
    expect(screen.getByRole("checkbox", { name: /^§179 candidate/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Startup expense/ })).not.toBeChecked();
  });

  it("gives every element a unique id", () => {
    render(<ExpensesPage />);
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});
