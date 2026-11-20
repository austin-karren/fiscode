import { Checkbox } from "@fiscode/ui/components/checkbox";

import type { FieldControlProps } from "./field-control-props";

// Checkbox for a form field. Ticking or clearing the box is the user's whole
// answer, so it counts as leaving the field: `onBlur` runs on every change as
// well as on focus loss, and a "must be ticked" error clears the moment the
// box is ticked.
export function FieldCheckbox({
  checked,
  onCheckedChange,
  onBlur,
  ...props
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
} & FieldControlProps) {
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={(v) => {
        onCheckedChange(v === true);
        onBlur?.();
      }}
      onBlur={() => onBlur?.()}
      {...props}
    />
  );
}
