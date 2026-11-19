import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataTable } from "./data-table";

afterEach(cleanup);

describe("DataTable", () => {
  it("is the positioning box for hidden text in its rows, so a phone does not scroll sideways", () => {
    render(
      <DataTable>
        <tbody>
          <tr>
            <td>
              <button type="button">
                Delete <span className="sr-only">demo record</span>
              </button>
            </td>
          </tr>
        </tbody>
      </DataTable>,
    );
    // jsdom has no layout: the measured check (scrollWidth = 390 on every
    // data page) is in the PR walk; this keeps the wrapper positioned.
    const wrapper = screen.getByRole("table").parentElement!;
    expect(wrapper).toHaveClass("relative", "overflow-x-auto");
  });

  function DemoTable() {
    return (
      <DataTable>
        <DataTable.Head>
          <DataTable.Row>
            <DataTable.HeaderCell>Date</DataTable.HeaderCell>
            <DataTable.HeaderCell align="right">Amount</DataTable.HeaderCell>
            <DataTable.HeaderCell />
          </DataTable.Row>
        </DataTable.Head>
        <DataTable.Body>
          <DataTable.Row>
            <DataTable.Cell label="Date">Jan 5, 2026</DataTable.Cell>
            <DataTable.Cell label="Amount" align="right">
              $120.00
            </DataTable.Cell>
            <DataTable.Cell align="right">
              <button type="button">Edit</button>
            </DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable>
    );
  }

  it("labels each stacked cell with its column, hidden from screen readers so it is not read twice", () => {
    render(<DemoTable />);
    const [date, amount] = screen.getAllByRole("cell");
    expect(date).toHaveAttribute("data-label", "Date");
    expect(amount).toHaveAttribute("data-label", "Amount");
    const label = date!.querySelector("[aria-hidden='true']");
    expect(label).toHaveTextContent("Date");
    expect(date).toHaveTextContent("DateJan 5, 2026");
  });

  it("gives the actions cell no label", () => {
    render(<DemoTable />);
    const actions = screen.getByRole("button", { name: "Edit" }).closest("td")!;
    expect(actions).not.toHaveAttribute("data-label");
    expect(actions.querySelector("[aria-hidden='true']")).toBeNull();
  });

  it("keeps table semantics when rows stack: explicit roles, header row visually hidden not removed", () => {
    render(<DemoTable />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Date",
      "Amount",
      "",
    ]);
    const head = screen.getAllByRole("rowgroup")[0]!;
    expect(head).toHaveClass("@max-2xl:sr-only");
    expect(head).not.toHaveClass("@max-2xl:hidden");
  });
});
