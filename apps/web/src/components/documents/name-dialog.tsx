import { useId, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fiscode/ui/components/dialog";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";

import { errorLine } from "../../lib/documents-view";
import { EnterToSubmitForm } from "../forms/enter-to-submit-form";

// One name, for a new folder or a rename. The repo's typed error (a taken name, too deep) shows
// as one line under the field, linked to it.
export function NameDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  /** Why a name can't be used, checked on blur and on submit (documents: validDocumentName). */
  validate?: (name: string) => string | undefined;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        {/* Mounted each time the dialog opens, so it starts from `initial` (the current name for a
            rename, blank for a new folder), never from what was typed last time. */}
        {props.open ? <NameForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({
  onOpenChange,
  label,
  initial = "",
  submitLabel,
  onSubmit,
  validate,
}: {
  onOpenChange: (open: boolean) => void;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  validate?: (name: string) => string | undefined;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <EnterToSubmitForm
      onSubmit={async (e) => {
        e.preventDefault();
        const problem = validate?.(name);
        if (problem) return setError(problem);
        setBusy(true);
        try {
          await onSubmit(name);
          onOpenChange(false);
        } catch (err) {
          setError(errorLine(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>{label}</Label>
        <Input
          id={`${id}-name`}
          value={name}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
          onBlur={() => setError(validate?.(name))}
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-4">
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={busy || !name.trim()}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </EnterToSubmitForm>
  );
}
