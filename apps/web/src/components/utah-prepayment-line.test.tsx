import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cents, isoDate } from "@fiscode/core";

import { UtahPrepaymentLine } from "./utah-prepayment-line";

afterEach(cleanup);

const prepayment = (minimum: number) => ({
  state: "UT" as const,
  dueDate: isoDate("2027-04-15"),
  minimum: cents(minimum),
  basis: "currentYear90" as const,
});

describe("UtahPrepaymentLine", () => {
  it("names the amount and the date when a prepayment is due", () => {
    render(<UtahPrepaymentLine prepayment={prepayment(999_00)} />);
    expect(
      screen.getByText(
        "Utah: pay at least $999.00 by Apr 15, 2027 (90% of this year's Utah tax, less Utah withholding).",
      ),
    ).toBeInTheDocument();
  });

  it("says no prepayment is due when the minimum is $0 (TC-546 line 8)", () => {
    render(<UtahPrepaymentLine prepayment={prepayment(0)} />);
    expect(screen.getByText("Utah: no prepayment due by Apr 15, 2027.")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });
});

describe("UtahPrepaymentLine names the TC-546 line 5 basis it used (review #72 r2)", () => {
  it("last year's Utah tax (line 4) was lower: says so", () => {
    render(
      <UtahPrepaymentLine prepayment={{ ...prepayment(1_200_00), basis: "priorYear" as const }} />,
    );
    expect(
      screen.getByText(
        "Utah: pay at least $1,200.00 by Apr 15, 2027 (your 2025 Utah tax, which is less than 90% of this year's, less Utah withholding).",
      ),
    ).toBeInTheDocument();
  });

  it("90% of this year's (line 3): as before", () => {
    render(<UtahPrepaymentLine prepayment={prepayment(1_557_03)} />);
    expect(
      screen.getByText(/\(90% of this year's Utah tax, less Utah withholding\)\.$/),
    ).toBeInTheDocument();
  });
});
