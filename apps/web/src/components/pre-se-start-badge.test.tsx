import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PreSeStartBadge } from "./pre-se-start-badge";

afterEach(cleanup);

describe("PreSeStartBadge says why a row is not counted", () => {
  it("names the start date (demo: expense Jan 20, start Mar 2)", () => {
    render(<PreSeStartBadge rowDate="2026-01-20" seStartDate="2026-03-02" />);
    expect(
      screen.getByLabelText(
        "Not counted in the tax estimate: dated before your start date, Mar 2, 2026.",
      ),
    ).toBeInTheDocument();
  });

  it("adds the startup hint on expenses", () => {
    render(<PreSeStartBadge rowDate="2026-01-20" seStartDate="2026-03-02" startupHint />);
    expect(
      screen.getByLabelText(
        "Not counted in the tax estimate: dated before your start date, Mar 2, 2026. Tick Startup expense if it was a startup cost.",
      ),
    ).toBeInTheDocument();
  });

  it("shows nothing on or after the start date", () => {
    const { container } = render(<PreSeStartBadge rowDate="2026-03-02" seStartDate="2026-03-02" />);
    expect(container).toBeEmptyDOMElement();
  });
});
