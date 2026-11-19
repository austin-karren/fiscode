import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Page } from "./page";

afterEach(cleanup);

const pageOf = (title: string) =>
  screen.getByRole("heading", { name: title }).closest(".\\@container")!;

describe("Page width", () => {
  it.each([
    [undefined, "max-w-6xl"],
    ["form", "max-w-2xl"],
    ["narrow", "max-w-md"],
  ] as const)("width %s runs at %s, and lays its cards out by its own width", (width, cls) => {
    render(
      <Page title="Demo" width={width}>
        <p>Demo content</p>
      </Page>,
    );
    expect(pageOf("Demo")).toHaveClass(cls);
  });

  it("keeps the description to a readable measure", () => {
    render(
      <Page title="Demo" description="Demo description">
        <p>Demo content</p>
      </Page>,
    );
    expect(screen.getByText("Demo description")).toHaveClass("max-w-prose");
  });
});
