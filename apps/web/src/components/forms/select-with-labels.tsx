import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fiscode/ui/components/select";
import { useRef, type ReactNode } from "react";

import type { FieldControlProps } from "./field-control-props";

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
  id,
  onBlur,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-required": ariaRequired,
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: Array<{ value: string; label: string }>;
  placeholder?: ReactNode;
  triggerClassName?: string;
  disabledValues?: ReadonlyArray<string>;
} & FieldControlProps) {
  const labels = Object.fromEntries(items.map((i) => [i.value, i.label]));
  // Focus moves from the trigger into the popup while it is open; that is
  // not the user leaving the field.
  const openRef = useRef(false);
  return (
    <Select
      value={value}
      onOpenChange={(open) => {
        openRef.current = open;
      }}
      onValueChange={(v) => {
        onValueChange(v ?? "");
        onBlur?.();
      }}
    >
      <SelectTrigger
        id={id}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-required={ariaRequired}
        onBlur={() => {
          if (!openRef.current) onBlur?.();
        }}
        className={triggerClassName ?? "w-full"}
      >
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
