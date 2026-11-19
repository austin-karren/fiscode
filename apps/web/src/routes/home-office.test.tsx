import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  useLoaderData: () => loaded,
  useRouter: () => ({ invalidate }),
}));

import { Route } from "./home-office";

// What the loader returns; a test may give it rows or this year's limits.
const NONE = { homeOfficeAreaRejected: 0, homeOfficeCarryover: 0, homeOfficeLost: 0 };
const loaded: { rows: unknown[]; year: number; derived: typeof NONE } = {
  rows: [],
  year: 2026,
  derived: NONE,
};

const HomeOfficePage = Route.options.component!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  loaded.rows = [];
  loaded.derived = NONE;
});

const saveButton = () => screen.getByRole("button", { name: "Save" });
const ackBox = () => screen.getByRole("checkbox");
const ackError = "Acknowledge regular & exclusive use";

describe("home office form", () => {
  it("ticks the acknowledgement when its label is clicked", () => {
    render(<HomeOfficePage />);
    fireEvent.click(screen.getByText("Regular & exclusive use"));
    expect(ackBox()).toBeChecked();
  });

  it("names the acknowledgement by its card text, without the info button", () => {
    render(<HomeOfficePage />);
    expect(ackBox()).toHaveAccessibleName(
      "Regular & exclusive use I acknowledge the home office is used regularly and exclusively for business.",
    );
    expect(screen.getByRole("button", { name: "More info about Regular & exclusive use" }));
  });

  it("gives every element a unique id", () => {
    render(<HomeOfficePage />);
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
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

const FIXED = "2026-06-04T12:00:00.000Z";
const simplified2026 = {
  id: "ho_demo",
  startDate: "2026-01-01",
  endDate: null,
  method: "simplified",
  officeSqft: 100,
  homeSqft: 1000,
  monthlyRentMortgageCents: null,
  monthlyUtilitiesCents: null,
  monthlyInsuranceCents: null,
  regularExclusiveAck: true,
  notes: null,
  deletedAt: null,
  createdAt: FIXED,
  updatedAt: FIXED,
};

const addCard = () => screen.getByText("Add config").closest("[data-slot=card]") as HTMLElement;
const typeInto = (label: string, value: string) => {
  const input = within(addCard()).getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
const pickMethod = async (name: string) => {
  // By keyboard: a select that already holds a value ignores a synthetic click
  // on another option.
  const trigger = within(addCard()).getByRole("combobox", { name: "Method" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name });
  option.focus();
  fireEvent.keyDown(option, { key: "Enter" });
  fireEvent.click(option);
};

describe("home office: Actual method and its rules", () => {
  it("refuses an office larger than the home on blur, in one short line", async () => {
    render(<HomeOfficePage />);
    typeInto("Home sqft (optional)", "100");
    typeInto("Office sqft (optional)", "5000");
    expect(await within(addCard()).findByText("Larger than the home")).toBeInTheDocument();
  });

  it("asks for the monthly costs only under Actual, and saves them in cents", async () => {
    render(<HomeOfficePage />);
    expect(screen.queryByTestId("actual-costs")).not.toBeInTheDocument();
    await pickMethod("Actual expenses");
    await screen.findByTestId("actual-costs");
    typeInto("Office sqft (optional)", "96");
    typeInto("Home sqft (optional)", "1220");
    typeInto("Rent or mortgage interest, monthly (optional)", "1375");
    typeInto("Utilities, monthly (optional)", "175");
    fireEvent.click(ackBox());
    fireEvent.click(saveButton());

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "actual",
        officeSqft: 96,
        homeSqft: 1220,
        monthlyRentMortgageCents: 137500,
        monthlyUtilitiesCents: 17500,
        monthlyInsuranceCents: null,
      }),
    );
  });

  it("tells an owner to enter mortgage interest, not the full payment, on the rent field", async () => {
    render(<HomeOfficePage />);
    await pickMethod("Actual expenses");
    await screen.findByTestId("actual-costs");
    expect(
      within(addCard()).getByLabelText("Rent or mortgage interest, monthly (optional)"),
    ).toHaveAccessibleDescription(/mortgage interest, not the full payment/);
  });

  it("blocks a second simplified home in a year that has one, with the reason", async () => {
    loaded.rows = [simplified2026];
    render(<HomeOfficePage />);
    fireEvent.click(ackBox());
    fireEvent.click(saveButton());
    expect(await within(addCard()).findByText("One simplified home a year")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("says when a config's office is larger than its home", () => {
    loaded.derived = { ...NONE, homeOfficeAreaRejected: 1 };
    render(<HomeOfficePage />);
    expect(screen.getByText(/A config has an office larger than the home/)).toBeInTheDocument();
    expect(screen.getByText(/deducts \$0 in 2026/)).toBeInTheDocument();
  });

  it("shows an Actual carryover and a Simplified loss apart, each labelled", () => {
    loaded.derived = { ...NONE, homeOfficeCarryover: 12_345, homeOfficeLost: 6_789 };
    render(<HomeOfficePage />);
    expect(screen.getByText("Carries to your 2027 return: $123.45")).toBeInTheDocument();
    expect(screen.getByText(/Actual method: .* carries over on Form 8829/)).toBeInTheDocument();
    expect(screen.getByText("Not deductible: $67.89")).toBeInTheDocument();
    expect(screen.getByText(/Simplified method: .* can.t be carried over/)).toBeInTheDocument();
  });
});
