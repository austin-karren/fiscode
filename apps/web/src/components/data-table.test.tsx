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
});
