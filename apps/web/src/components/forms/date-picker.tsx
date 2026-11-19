import { Button } from "@fiscode/ui/components/button";
import { Calendar } from "@fiscode/ui/components/calendar";
import { Input } from "@fiscode/ui/components/input";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@fiscode/ui/components/popover";
import { cn } from "@fiscode/ui/lib/utils";
import { CalendarIcon } from "lucide-react";
import { useId, useRef, useState, type Ref } from "react";

import type { FieldControlProps } from "./field-control-props";

// Calendar-driven date picker. Takes/returns a JS `Date | undefined` so it
// works directly with `z.date()` field validators. Form `onSubmit` handlers
// convert Date → ISO string at save time via `dateToIso` below.

const displayFormat = (d: Date): string =>
  d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** Entry dates (income, expense, mileage, time) reach this many years back. */
export const ENTRY_YEARS_BACK = 10;
/** Start and end dates of long-lived things: self-employment, an entity, a spouse's job, a home office. */
export const CONFIG_YEARS_BACK = 50;

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * The first and last day the picker offers. A stored value outside the range
 * widens it to that value's year, so an old row still shows and can be edited.
 */
export function pickableRange({
  yearsBack,
  disableFuture,
  value,
  today = new Date(),
}: {
  yearsBack: number;
  disableFuture: boolean;
  value?: Date;
  today?: Date;
}): { min: Date; max: Date } {
  let min = new Date(today.getFullYear() - yearsBack, 0, 1);
  // Period-end fields may run to the end of this year, as before.
  let max = disableFuture ? startOfDay(today) : new Date(today.getFullYear(), 11, 31);
  // Days are compared, not instants: a form's default of "now" has a time of
  // day and must not count as later than today.
  const day = value ? startOfDay(value) : undefined;
  if (day && day < min) min = new Date(day.getFullYear(), 0, 1);
  if (day && day > max) max = new Date(day.getFullYear(), 11, 31);
  return { min, max };
}

/** Reads `MM/DD/YYYY` or `YYYY-MM-DD`; anything else, or a day that does not exist, is undefined. */
export function parseTypedDate(text: string): Date | undefined {
  const t = text.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const [y, m, d] = us
    ? [Number(us[3]), Number(us[1]), Number(us[2])]
    : iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [NaN, NaN, NaN];
  const date = new Date(y!, m! - 1, d!);
  // `new Date(2025, 1, 30)` rolls over to March; that is not what was typed.
  if (date.getFullYear() !== y || date.getMonth() !== m! - 1 || date.getDate() !== d) {
    return undefined;
  }
  return date;
}

const typedFormat = (d: Date): string =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

// Defaults to past-or-today because "when did this happen" fields
// (income, expenses, mileage, time, SE start) cannot legitimately be in
// the future. Period-end fields (entity end, spouse end, home-office end)
// opt out with `disableFuture={false}` so they can plan ahead.
export function DatePicker({
  value,
  onValueChange,
  placeholder = "Pick a date…",
  disabled,
  disableFuture = true,
  yearsBack = ENTRY_YEARS_BACK,
  className,
  id,
  onBlur,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-required": ariaRequired,
}: {
  value: Date | undefined;
  onValueChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  disableFuture?: boolean;
  /** How many calendar years back the picker reaches. */
  yearsBack?: number;
  className?: string;
} & FieldControlProps) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  return (
    // Tab stays inside the open picker. Left free, Tab from the day grid fell
    // out to the page, also to the page behind a dialog.
    <Popover open={open} onOpenChange={setOpen} modal="trap-focus">
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            id={id}
            // A button named by `<label for>` loses its own text, which here
            // is the picked date. Name it by the FormLabel (`<id>-label`)
            // and by its own text so both are announced.
            aria-labelledby={id ? `${id}-label ${id}-value` : undefined}
            aria-invalid={ariaInvalid}
            // A button cannot be aria-required; a required date says so in
            // its description instead.
            aria-describedby={
              [ariaDescribedBy, ariaRequired && id ? `${id}-required` : undefined]
                .filter(Boolean)
                .join(" ") || undefined
            }
            // Focus moves into the calendar while it is open; that is not
            // the user leaving the field.
            onBlur={() => {
              if (!open) onBlur?.();
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" || open) return;
              event.preventDefault();
              setOpen(true);
            }}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              className,
            )}
          >
            <span id={id ? `${id}-value` : undefined}>
              {value ? displayFormat(value) : placeholder}
            </span>
            <CalendarIcon className="ml-2 size-4 text-muted-foreground" />
            {ariaRequired && id ? (
              <span id={`${id}-required`} className="sr-only">
                Required
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent
        className="w-auto gap-0 p-0"
        align="start"
        side="bottom"
        sideOffset={4}
        // Into the day grid, on the selected day or today: the popover's own
        // default is its first control, the "previous month" button.
        initialFocus={() =>
          panel.current?.querySelector<HTMLElement>('button[data-day][tabindex="0"]') ?? true
        }
      >
        <DatePickerPanel
          ref={panel}
          value={value}
          {...pickableRange({ yearsBack, disableFuture, value })}
          onPick={(d) => {
            onValueChange(d);
            onBlur?.();
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

// Mounted only while the popover is open, so each opening starts from the
// field's value.
function DatePickerPanel({
  ref,
  value,
  min,
  max,
  onPick,
}: {
  ref: Ref<HTMLDivElement>;
  value: Date | undefined;
  min: Date;
  max: Date;
  onPick: (date: Date | undefined) => void;
}) {
  const [text, setText] = useState(value ? typedFormat(value) : "");
  const [error, setError] = useState<string>();
  const errorId = useId();

  const check = (): Date | undefined => {
    const typed = parseTypedDate(text);
    if (!typed) {
      setError("Enter a date like 03/14/2025 or 2025-03-14.");
      return undefined;
    }
    if (typed < min || typed > max) {
      setError(`Enter a date from ${displayFormat(min)} to ${displayFormat(max)}.`);
      return undefined;
    }
    setError(undefined);
    return typed;
  };

  return (
    <div ref={ref} className="flex flex-col">
      <div className="flex flex-col gap-1 p-2 pb-0">
        <Input
          aria-label="Type a date"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder="MM/DD/YYYY"
          inputMode="numeric"
          autoComplete="off"
          className="h-8"
          value={text}
          onChange={(event) => setText(event.target.value)}
          // Leaving the box only checks it. It must not save: Escape and a
          // click outside also blur it, and those cancel.
          onBlur={() => {
            if (text.trim() === "") setError(undefined);
            else check();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // The popover is portaled out of the form but React still bubbles
            // the key to it, where Enter in a text input submits.
            event.preventDefault();
            // An emptied box clears the field.
            if (text.trim() === "") return onPick(undefined);
            const typed = check();
            if (typed) onPick(typed);
          }}
        />
        {error ? (
          <p id={errorId} role="alert" className="max-w-56 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Calendar
        mode="single"
        // Picking the selected day again keeps it. Focus opens on that day,
        // so Enter there has to mean "this one", not "none".
        required
        selected={value}
        defaultMonth={value}
        startMonth={min}
        endMonth={max}
        disabled={[{ before: min }, { after: max }]}
        // `dropdown` caption surfaces month + year dropdowns inline so the
        // user can jump to e.g. an SE start date five years ago without
        // sixty clicks on the chevron.
        captionLayout="dropdown"
        onSelect={onPick}
      />
      {/* Last stop before Tab wraps to the text box; shown only when focused.
          It also lets a touch screen reader leave the trapped popover. */}
      <PopoverClose className="sr-only focus-visible:not-sr-only focus-visible:m-2 focus-visible:mt-0 focus-visible:rounded-md focus-visible:px-2 focus-visible:py-1 focus-visible:text-xs focus-visible:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
        Close
      </PopoverClose>
    </div>
  );
}

// Helpers for converting between Date (form state) and the ISO
// `YYYY-MM-DD` strings the DB schema and CSV layer expect. Use them in
// each form's `onSubmit` handler so the field can stay typed as `Date`.
export const dateToIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const isoToDate = (iso: string): Date | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
