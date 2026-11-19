import { cleanup, render, screen } from "@testing-library/react";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@fiscode/ui/components/form";
import { TooltipProvider } from "@fiscode/ui/components/tooltip";
import { afterEach, describe, expect, it } from "vitest";

import { LabelWithTooltip } from "./labeled";

afterEach(cleanup);

function Field({
  requirement,
  errors = [],
  hint,
}: {
  requirement?: "required" | "optional";
  errors?: string[];
  hint?: string;
}) {
  return (
    <TooltipProvider>
      <FormField name="demo" errors={errors} requirement={requirement}>
        <FormItem>
          {hint ? (
            <LabelWithTooltip tooltip={hint}>Demo</LabelWithTooltip>
          ) : (
            <FormLabel>Demo</FormLabel>
          )}
          <FormControl>
            <input />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>
    </TooltipProvider>
  );
}

describe("form slots", () => {
  it("keeps a message line under a field before any error, so an error moves nothing", () => {
    const { container, rerender } = render(<Field />);
    const slot = container.querySelector("[data-slot=form-message]");
    expect(slot).toBeInTheDocument();
    expect(slot).toHaveClass("min-h-5");
    expect(slot).toBeEmptyDOMElement();

    rerender(<Field errors={["Enter a demo value"]} />);
    expect(container.querySelector("[data-slot=form-message]")).toHaveTextContent(
      "Enter a demo value",
    );
  });

  it("marks a required field aria-required, with no marker in its label", () => {
    render(<Field requirement="required" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("Demo").closest("label")).not.toHaveTextContent("(optional)");
  });

  it("says '(optional)' in the label of an optional field, and does not mark it required", () => {
    render(<Field requirement="optional" />);
    expect(screen.getByRole("textbox", { name: "Demo (optional)" })).not.toHaveAttribute(
      "aria-required",
    );
  });

  it("leaves a field that states neither (a checkbox) unmarked", () => {
    render(<Field />);
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-required");
    expect(screen.getByText("Demo").closest("label")).not.toHaveTextContent("(optional)");
  });

  it("links a label's info hint to its field, so the field announces it", () => {
    render(<Field hint="Demo hint text." />);
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("Demo hint text.");
  });
});
