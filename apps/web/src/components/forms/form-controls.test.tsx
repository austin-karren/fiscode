import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@fiscode/ui/components/form";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatePicker } from "./date-picker";
import { FieldCheckbox } from "./field-checkbox";
import { SelectWithLabels } from "./select-with-labels";
import { StateCombobox } from "./state-combobox";

// Each control is rendered the way every route renders it: inside
// FormField > FormItem > FormControl, with a FormLabel beside it.
function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <FormField name="field" errors={error ? [error] : []}>
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>{children}</FormControl>
        <FormMessage />
      </FormItem>
    </FormField>
  );
}

const noop = () => {};

afterEach(cleanup);

describe("DatePicker inside a form field", () => {
  it("is named by its label and the picked date", () => {
    render(
      <Field label="Start date">
        <DatePicker value={new Date(2025, 2, 14)} onValueChange={noop} />
      </Field>,
    );
    expect(screen.getByRole("button", { name: "Start date Mar 14, 2025" })).toBeInTheDocument();
  });
});

describe("FieldCheckbox inside a form field", () => {
  it("is marked invalid and described by the error message", () => {
    render(
      <Field label="Demo box" error="Tick the box">
        <FieldCheckbox checked={false} onCheckedChange={noop} />
      </Field>,
    );
    const box = screen.getByRole("checkbox");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription("Tick the box");
  });

  it("reports the new value, then blur, when toggled", () => {
    const calls: string[] = [];
    render(
      <Field label="Demo box">
        <FieldCheckbox
          checked={false}
          onCheckedChange={(v) => calls.push(`change:${v}`)}
          onBlur={() => calls.push("blur")}
        />
      </Field>,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(calls).toEqual(["change:true", "blur"]);
  });

  it("reports blur when focus leaves it", () => {
    const onBlur = vi.fn();
    render(
      <Field label="Demo box">
        <FieldCheckbox checked={false} onCheckedChange={noop} onBlur={onBlur} />
      </Field>,
    );
    const box = screen.getByRole("checkbox");
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

const controls: Array<[name: string, control: (onBlur?: () => void) => ReactNode]> = [
  [
    "SelectWithLabels",
    (onBlur) => (
      <SelectWithLabels
        value=""
        onValueChange={noop}
        onBlur={onBlur}
        items={[{ value: "single", label: "Single" }]}
      />
    ),
  ],
  ["DatePicker", (onBlur) => <DatePicker value={undefined} onValueChange={noop} onBlur={onBlur} />],
  ["StateCombobox", (onBlur) => <StateCombobox value="" onValueChange={noop} onBlur={onBlur} />],
];

describe.each(controls)("%s inside a form field", (_name, control) => {
  it("is the element its label points at, so a label click focuses it", () => {
    render(<Field label="Demo field">{control()}</Field>);
    const label = screen.getByText("Demo field");
    const target = screen.getByLabelText("Demo field");
    expect(target.id).toBe(label.getAttribute("for"));
    expect(target.matches("button, input")).toBe(true);
  });

  it("is marked invalid and described by the error message", () => {
    render(
      <Field label="Demo field" error="Pick something">
        {control()}
      </Field>,
    );
    const target = screen.getByLabelText("Demo field");
    expect(target).toHaveAttribute("aria-invalid", "true");
    expect(target).toHaveAccessibleDescription("Pick something");
  });

  it("is not marked invalid without an error", () => {
    render(<Field label="Demo field">{control()}</Field>);
    expect(screen.getByLabelText("Demo field")).toHaveAttribute("aria-invalid", "false");
  });

  it("reports blur", () => {
    const onBlur = vi.fn();
    render(<Field label="Demo field">{control(onBlur)}</Field>);
    const target = screen.getByLabelText("Demo field");
    fireEvent.focus(target);
    fireEvent.blur(target);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
