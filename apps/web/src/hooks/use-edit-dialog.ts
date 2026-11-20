import { toast } from "sonner";
import { useState } from "react";

/**
 * Open state for an Edit dialog whose form lives outside the dialog content.
 *
 * Opening resets the form, so the dialog always starts from the record's saved
 * values (the form's current `defaultValues`), never from values typed earlier
 * and then refused or abandoned with Escape. The reset happens in the open
 * event itself; there is no effect syncing props into state.
 *
 * `onOpen` runs on the same event, for other per-open state (a refusal message).
 */
export function useEditDialog(form: { reset: () => void }, onOpen?: () => void) {
  const [open, setOpen] = useState(false);
  const onOpenChange = (next: boolean) => {
    if (next) {
      form.reset();
      onOpen?.();
    }
    setOpen(next);
  };
  return { open, setOpen, onOpenChange };
}

/**
 * A save with every field still at its saved value writes nothing (the repos
 * skip it), so it says so instead of "… updated." Returns true when the save
 * should stop there.
 */
export function noChangesToSave(form: { state: { isDefaultValue: boolean } }): boolean {
  if (!form.state.isDefaultValue) return false;
  toast("No changes to save.");
  return true;
}
