import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ErrorEmpty } from "./error";

afterEach(cleanup);

describe("ErrorEmpty", () => {
  it("shows an Error's message", () => {
    render(<ErrorEmpty error={new Error("The database is locked")} />);
    expect(screen.getByText("The database is locked")).toBeInTheDocument();
  });

  it("shows a thrown value that is not an Error", () => {
    render(<ErrorEmpty error="Quota exceeded" />);
    expect(screen.getByText("Quota exceeded")).toBeInTheDocument();
  });

  it("falls back to a general sentence when there is nothing to show", () => {
    render(<ErrorEmpty error={undefined} />);
    expect(screen.getByText("An unexpected error occurred.")).toBeInTheDocument();
  });
});
