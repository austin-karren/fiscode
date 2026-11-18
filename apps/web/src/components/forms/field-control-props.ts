import type { AriaAttributes } from "react";

// What `FormControl` hands its child through the Slot, plus the blur hook
// the field needs. A control that takes these must put them on the element
// the user focuses, so the label, the error ring and screen readers all
// agree on which element is the field.
//
// `onBlur` means "the user is done with this control": focus left it, or a
// picker committed a value. Opening a picker's own popup is not a blur.
export type FieldControlProps = Pick<AriaAttributes, "aria-invalid" | "aria-describedby"> & {
  id?: string;
  onBlur?: () => void;
};
