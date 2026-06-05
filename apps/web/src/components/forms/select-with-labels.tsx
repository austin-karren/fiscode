import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fiscode/ui/components/select";
import type { ReactNode } from "react";

// Common Select wrapper that displays labels (not raw enum values) in the trigger.
// `items` maps value → human label; the trigger renders the label, the popup
// renders both. Pass `value: ""` to model an unset state.
export function SelectWithLabels({
  value,
  onValueChange,
  items,
  placeholder = "—",
  triggerClassName,
  disabledValues,
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: Array<{ value: string; label: string }>;
  placeholder?: ReactNode;
  triggerClassName?: string;
  disabledValues?: ReadonlyArray<string>;
}) {
  const labels = Object.fromEntries(items.map((i) => [i.value, i.label]));
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v ?? "")}>
      <SelectTrigger className={triggerClassName ?? "w-full"}>
        <SelectValue placeholder={placeholder}>
          {(v: string | null) => (v && labels[v]) || placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value} disabled={disabledValues?.includes(i.value)}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
