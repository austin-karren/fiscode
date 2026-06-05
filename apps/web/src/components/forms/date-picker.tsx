import { Button } from "@fiscode/ui/components/button";
import { Calendar } from "@fiscode/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@fiscode/ui/components/popover";
import { cn } from "@fiscode/ui/lib/utils";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

// Calendar-driven date picker. Takes/returns a JS `Date | undefined` so it
// works directly with `z.date()` field validators. Form `onSubmit` handlers
// convert Date → ISO string at save time via `dateToIso` below.

const displayFormat = (d: Date): string =>
  d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export function DatePicker({
  value,
  onValueChange,
  placeholder = "Pick a date…",
  disabled,
  className,
}: {
  value: Date | undefined;
  onValueChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              className,
            )}
          >
            {value ? displayFormat(value) : placeholder}
            <CalendarIcon className="ml-2 size-4 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start" side="bottom" sideOffset={4}>
        <Calendar
          mode="single"
          selected={value}
          // `dropdown` caption surfaces month + year dropdowns inline so the
          // user can jump to e.g. an SE start date five years ago without
          // sixty clicks on the chevron.
          captionLayout="dropdown"
          onSelect={(d) => {
            onValueChange(d ?? undefined);
            if (d) setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
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
