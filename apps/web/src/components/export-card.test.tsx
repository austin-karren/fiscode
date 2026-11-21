import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exampleBundle } from "@fiscode/csv";

const { buildBundle } = vi.hoisted(() => ({ buildBundle: vi.fn() }));
vi.mock("@fiscode/db", () => ({ buildBundle }));

import { ExportCard } from "./export-card";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("export card: accountant summary", () => {
  it("downloads a second, summary file for the year, from live rows only", async () => {
    buildBundle.mockResolvedValue(exampleBundle());
    const blobs: Blob[] = [];
    const names: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blobs.push(b as Blob);
      return "blob:x";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    render(<ExportCard />);
    fireEvent.click(screen.getByRole("button", { name: /Download accountant summary/ }));

    await waitFor(() => expect(names).toHaveLength(1));
    expect(buildBundle).toHaveBeenCalledWith({});
    expect(names[0]).toMatch(/^fiscode-\d{4}-accountant-summary-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await blobs[0]!.text();
    expect(text).toContain("About this file,item,value");
  });
});
