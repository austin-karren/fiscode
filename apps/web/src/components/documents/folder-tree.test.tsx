import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The router isn't needed to test the tree: its links render as plain anchors.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search: _s,
    from: _f,
    ...rest
  }: Record<string, unknown> & { children: React.ReactNode }) => (
    <a href="#" {...rest}>
      {children}
    </a>
  ),
}));

import { MAIN_ID } from "../../lib/nav";
import { FolderTree } from "./folder-tree";

afterEach(cleanup);

const FIXED = "2026-06-04T12:00:00.000Z";
const folder = (id: string, name: string, parentId: string | null = null) => ({
  id,
  name,
  parentId,
  taxYear: 2026,
  sortOrder: 0,
  defaultKey: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});
const tree = [
  {
    folder: folder("y", "2026"),
    documentCount: 0,
    children: [{ folder: folder("e", "Expenses", "y"), documentCount: 2, children: [] }],
  },
];

describe("folder tree on a phone (REVIEW #83 r3 F3)", () => {
  it("closes the disclosure after a pick and moves focus to main, not the page body", () => {
    render(
      <main id={MAIN_ID} tabIndex={-1}>
        <FolderTree tree={tree} selected="y" trash={false} />
      </main>,
    );
    const details = document.querySelector("details")!;
    details.open = true;
    const inDisclosure = details.querySelectorAll("a");
    fireEvent.click([...inDisclosure].find((a) => a.textContent?.startsWith("Expenses"))!);
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(document.getElementById(MAIN_ID));
  });

  it("names each folder's count as documents", () => {
    render(<FolderTree tree={tree} selected="y" trash={false} />);
    const names = screen.getAllByRole("link", { hidden: true }).map((a) => a.textContent);
    expect(names).toContain("Expenses2 documents");
  });
});
