import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@fiscode/ui/components/dialog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

// jsdom has no layout: the measured check (the footer inside the viewport at
// 1280x720 and 390x664, with home office set to Actual) is in the PR walk.
// This pins the contract that keeps it there.
describe("dialog footer", () => {
  it("stays in view: the dialog fits the viewport and scrolls, the footer is sticky and opaque", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Demo edit</DialogTitle>
          <form>
            <input aria-label="Demo field" />
            <DialogFooter>
              <button type="submit">Save</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>,
    );
    const content = screen.getByRole("dialog");
    expect(content).toHaveClass("max-h-[calc(100dvh-2rem)]", "overflow-y-auto", "scroll-pb-32");
    const footer = screen
      .getByRole("button", { name: "Save" })
      .closest('[data-slot="dialog-footer"]');
    expect(footer).toHaveClass("sticky", "-bottom-4", "z-10");
    // Opaque: no translucent fill that fields would show through.
    expect(footer?.className).not.toMatch(/\bbg-muted\/50\b/);
  });
});
