import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIG_YEARS_BACK, DatePicker, parseTypedDate, pickableRange } from "./date-picker";

const TODAY = new Date(2026, 10, 18, 9, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("pickableRange", () => {
  const range = (opts: { yearsBack?: number; disableFuture?: boolean; value?: Date }) =>
    pickableRange({ yearsBack: 10, disableFuture: true, today: TODAY, ...opts });

  it("runs an entry date from January 1 ten years back to today", () => {
    expect(range({})).toEqual({ min: new Date(2016, 0, 1), max: new Date(2026, 10, 18) });
  });

  it("runs a config date fifty years back", () => {
    expect(range({ yearsBack: CONFIG_YEARS_BACK }).min).toEqual(new Date(1976, 0, 1));
  });

  it("lets a period end run to the end of this year", () => {
    expect(range({ disableFuture: false }).max).toEqual(new Date(2026, 11, 31));
  });

  it("widens to the year of a stored value outside it", () => {
    expect(range({ value: new Date(2010, 4, 3) }).min).toEqual(new Date(2010, 0, 1));
    expect(range({ value: new Date(2028, 4, 3) }).max).toEqual(new Date(2028, 11, 31));
  });

  it("does not take a value with a time of day today as later than today", () => {
    expect(range({ value: new Date(2026, 10, 18, 23, 59) })).toEqual(range({}));
  });

  it("is not moved by a stored value inside it", () => {
    expect(range({ value: new Date(2020, 4, 3) })).toEqual(range({}));
  });
});

describe("parseTypedDate", () => {
  it.each([
    ["03/14/2025", new Date(2025, 2, 14)],
    ["3/4/2025", new Date(2025, 2, 4)],
    ["2025-03-14", new Date(2025, 2, 14)],
    ["  2025-03-14 ", new Date(2025, 2, 14)],
    ["02/29/2024", new Date(2024, 1, 29)],
  ])("reads %s", (text, date) => {
    expect(parseTypedDate(text)).toEqual(date);
  });

  it.each([
    "",
    "abc",
    "03/14/25",
    "14/03/2025",
    "02/30/2025",
    "02/29/2025",
    "2025-13-01",
    "2025-00-10",
    "03-14-2025",
    "2025/03/14",
    "03/14/2025 x",
    "1e3",
  ])("refuses %j", (text) => {
    expect(parseTypedDate(text)).toBeUndefined();
  });
});

const dayKey = (d: Date) => d.toLocaleDateString();
const trigger = () => screen.getByRole("button", { name: /Pick a date|\d{4}$/ });
const calendar = () => document.querySelector<HTMLElement>("[data-slot=calendar]")!;
const dayButton = (d: Date) =>
  calendar().querySelector<HTMLButtonElement>(`button[data-day="${dayKey(d)}"]`)!;
const yearOptions = () =>
  [...calendar().querySelectorAll("select")]
    .at(-1)!
    .querySelectorAll("option")
    .values()
    .map((o) => o.textContent)
    .toArray();
const focusedDay = () => (document.activeElement as HTMLElement | null)?.dataset.day;

function setup(props: Partial<Parameters<typeof DatePicker>[0]> = {}) {
  const onValueChange = vi.fn();
  const onBlur = vi.fn();
  render(<DatePicker value={undefined} onValueChange={onValueChange} onBlur={onBlur} {...props} />);
  return { onValueChange, onBlur };
}

async function openWithKeyboard() {
  trigger().focus();
  fireEvent.keyDown(trigger(), { key: "ArrowDown" });
  await waitFor(() => expect(calendar()).toBeInTheDocument());
}

describe("DatePicker range", () => {
  it("offers an entry date the last ten years and nothing after today", async () => {
    setup();
    await openWithKeyboard();
    const years = yearOptions();
    expect(years[0]).toBe("2016");
    expect(years.at(-1)).toBe("2026");
    expect(years).toHaveLength(11);
    expect(dayButton(new Date(2026, 10, 18))).toBeEnabled();
    expect(dayButton(new Date(2026, 10, 19))).toBeDisabled();
  });

  it("offers nothing after today when the value is now, with its time of day", async () => {
    setup({ value: new Date() });
    await openWithKeyboard();
    expect(dayButton(new Date(2026, 10, 18))).toBeEnabled();
    expect(dayButton(new Date(2026, 10, 19))).toBeDisabled();
    expect(yearOptions()).toHaveLength(11);

    fireEvent.change(screen.getByRole("textbox", { name: "Type a date" }), {
      target: { value: "11/19/2026" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Type a date" }), { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("to Nov 18, 2026.");
  });

  it("stops at January 1 of the first year", async () => {
    setup({ value: new Date(2016, 0, 1) });
    await openWithKeyboard();
    expect(dayButton(new Date(2016, 0, 1))).toBeEnabled();
    // Days before the first month are not drawn at all.
    expect(dayButton(new Date(2015, 11, 31))).toBeNull();
    expect(screen.getByRole("button", { name: /previous month/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("offers a config date fifty years", async () => {
    setup({ yearsBack: CONFIG_YEARS_BACK });
    await openWithKeyboard();
    const years = yearOptions();
    expect(years[0]).toBe("1976");
    expect(years.at(-1)).toBe("2026");
  });

  it("lets a period end be later this year", async () => {
    setup({ yearsBack: CONFIG_YEARS_BACK, disableFuture: false });
    await openWithKeyboard();
    expect(dayButton(new Date(2026, 10, 19))).toBeEnabled();
    expect(yearOptions().at(-1)).toBe("2026");
  });

  it("still shows a stored date older than the range and lets it be changed", async () => {
    const { onValueChange } = setup({ value: new Date(2010, 4, 3) });
    expect(trigger()).toHaveTextContent("May 3, 2010");

    await openWithKeyboard();
    expect(yearOptions()[0]).toBe("2010");
    expect(dayButton(new Date(2010, 4, 3))).toBeEnabled();
    await waitFor(() => expect(focusedDay()).toBe(dayKey(new Date(2010, 4, 3))));

    fireEvent.click(dayButton(new Date(2010, 4, 4)));
    expect(onValueChange).toHaveBeenCalledWith(new Date(2010, 4, 4));
  });
});

describe("DatePicker keyboard", () => {
  it("opens on today in the day grid when empty", async () => {
    setup();
    await openWithKeyboard();
    await waitFor(() => expect(focusedDay()).toBe(dayKey(new Date(2026, 10, 18))));
  });

  it("opens on the selected day, moves by arrow key and picks", async () => {
    const { onValueChange, onBlur } = setup({ value: new Date(2026, 9, 10) });
    await openWithKeyboard();
    await waitFor(() => expect(focusedDay()).toBe(dayKey(new Date(2026, 9, 10))));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    await waitFor(() => expect(focusedDay()).toBe(dayKey(new Date(2026, 9, 9))));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    await waitFor(() => expect(focusedDay()).toBe(dayKey(new Date(2026, 9, 2))));
    fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
    await waitFor(() => expect(focusedDay()).toBe(dayKey(new Date(2026, 8, 2))));

    // Enter on a button is a click.
    fireEvent.click(document.activeElement!);
    expect(onValueChange).toHaveBeenCalledWith(new Date(2026, 8, 2));
    expect(onBlur).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelector("[data-slot=calendar]")).toBeNull());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("keeps the day and closes when the selected day is picked again", async () => {
    const { onValueChange } = setup({ value: new Date(2026, 9, 10) });
    await openWithKeyboard();
    await waitFor(() => expect(focusedDay()).toBe(dayKey(new Date(2026, 9, 10))));

    fireEvent.click(document.activeElement!);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(new Date(2026, 9, 10));
    await waitFor(() => expect(document.querySelector("[data-slot=calendar]")).toBeNull());
  });

  it("does not let focus rest on a day after today", async () => {
    setup({ value: new Date() });
    await openWithKeyboard();
    await waitFor(() => expect(focusedDay()).toBe(dayKey(new Date(2026, 10, 18))));
    for (const key of ["ArrowRight", "ArrowDown", "End", "PageDown"]) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(document.activeElement).toBeEnabled();
      expect(new Date(focusedDay()!) <= new Date(2026, 10, 18)).toBe(true);
    }
  });

  it("ends the picker's tab order with a Close button that changes nothing", async () => {
    const { onValueChange, onBlur } = setup({ value: new Date(2026, 9, 10) });
    await openWithKeyboard();
    const popup = calendar().closest<HTMLElement>("[data-slot=popover-content]")!;
    const stops = popup.querySelectorAll("input, select, button:not([tabindex='-1'])");
    const close = within(popup).getByRole("button", { name: "Close" });
    expect(stops[stops.length - 1]).toBe(close);

    fireEvent.click(close);

    await waitFor(() => expect(document.querySelector("[data-slot=calendar]")).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();
  });

  it("closes on Escape without a change or a blur, with focus back on the field", async () => {
    const { onValueChange, onBlur } = setup({ value: new Date(2026, 9, 10) });
    await openWithKeyboard();
    await waitFor(() => expect(focusedDay()).toBeDefined());

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    await waitFor(() => expect(document.querySelector("[data-slot=calendar]")).toBeNull());
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();
  });
});

describe("DatePicker typed date", () => {
  const typed = () => screen.getByRole("textbox", { name: "Type a date" });
  const type = (text: string) => fireEvent.change(typed(), { target: { value: text } });
  const enter = () => fireEvent.keyDown(typed(), { key: "Enter" });

  it("starts from the field's value", async () => {
    setup({ value: new Date(2026, 9, 10) });
    await openWithKeyboard();
    expect(typed()).toHaveValue("10/10/2026");
  });

  it("selects the date on focus, so typing replaces it", async () => {
    setup({ value: new Date(2026, 9, 10) });
    await openWithKeyboard();
    const box = typed() as HTMLInputElement;
    fireEvent.focus(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, "10/10/2026".length]);
  });

  it.each(["03/14/2025", "2025-03-14"])("takes %s on Enter and closes", async (text) => {
    const { onValueChange, onBlur } = setup();
    await openWithKeyboard();
    type(text);
    enter();
    expect(onValueChange).toHaveBeenCalledWith(new Date(2025, 2, 14));
    expect(onBlur).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelector("[data-slot=calendar]")).toBeNull());
  });

  it("clears the field when the box is emptied and Enter is pressed", async () => {
    const { onValueChange } = setup({ value: new Date(2026, 9, 10) });
    await openWithKeyboard();
    type("");
    enter();
    expect(onValueChange).toHaveBeenCalledWith(undefined);
    await waitFor(() => expect(document.querySelector("[data-slot=calendar]")).toBeNull());
  });

  it("does not hand Enter on to the form around the field", async () => {
    const onSubmitKey = vi.fn();
    const onValueChange = vi.fn();
    render(
      // The form's own handler sees keys from the portaled popover.
      // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={(e) => onSubmitKey(e.defaultPrevented)}>
        <DatePicker value={undefined} onValueChange={onValueChange} />
      </div>,
    );
    await openWithKeyboard();
    type("abc");
    enter();
    expect(onSubmitKey).toHaveBeenCalledWith(true);
  });

  it("says what a date looks like when the text is not one", async () => {
    const { onValueChange } = setup();
    await openWithKeyboard();
    type("02/30/2025");
    enter();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a date like 03/14/2025 or 2025-03-14.",
    );
    expect(typed()).toHaveAttribute("aria-invalid", "true");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(calendar()).toBeInTheDocument();
  });

  it.each(["12/31/2015", "11/19/2026"])("refuses %s as outside the range", async (text) => {
    const { onValueChange } = setup();
    await openWithKeyboard();
    type(text);
    enter();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a date from Jan 1, 2016 to Nov 18, 2026.",
    );
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("checks on blur but does not save, so Escape still cancels", async () => {
    const { onValueChange } = setup();
    await openWithKeyboard();
    type("03/14/2025");
    fireEvent.blur(typed());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();

    type("nope");
    fireEvent.blur(typed());
    expect(within(calendar().parentElement!).getByRole("alert")).toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
