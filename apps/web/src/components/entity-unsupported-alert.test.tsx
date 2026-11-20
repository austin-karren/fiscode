import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EntityUnsupportedAlert } from "./entity-unsupported-alert";

afterEach(cleanup);

describe("EntityUnsupportedAlert", () => {
  it("says an S corp is estimated as a sole proprietorship", () => {
    render(<EntityUnsupportedAlert derived={{ entityType: "s_corp", entityUnsupported: true }} />);
    expect(screen.getByText("Estimated as a sole proprietorship")).toBeInTheDocument();
    expect(screen.getByText(/Your entity this year is S corp\./)).toBeInTheDocument();
  });

  it("shows nothing for a sole proprietor", () => {
    const { container } = render(
      <EntityUnsupportedAlert derived={{ entityType: "sole_prop", entityUnsupported: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
