import { useId, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
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
  onSubmit: (name: string, where: string | null) => Promise<void>;
  /** Where a new folder goes: each choice is a parent id (null is the top level). First is the default. */
  places?: { id: string | null; label: string }[];
  /** Why a name can't be used, checked on blur and on submit (documents: validDocumentName). */
  validate?: (name: string) => string | undefined;
  /** One line under the title about what the change touches ("Only 2026: ..."). */
  note?: string;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.note ? <DialogDescription>{props.note}</DialogDescription> : null}
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
  places,
  validate,
}: {
  onOpenChange: (open: boolean) => void;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string, where: string | null) => Promise<void>;
  places?: { id: string | null; label: string }[];
  validate?: (name: string) => string | undefined;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState(places?.[0]?.id ?? null);
  const id = useId();
  return (
    <EnterToSubmitForm
      onSubmit={async (e) => {
        e.preventDefault();
        const problem = validate?.(name);
        if (problem) return setError(problem);
        setBusy(true);
        try {
          await onSubmit(name, where);
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
      {places && places.length > 1 ? (
        <fieldset className="mt-4 grid gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Where</legend>
          {places.map((p) => (
            <label key={p.id ?? "top"} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-where`}
                className="size-4 accent-primary"
                checked={where === p.id}
                onChange={() => {
                  setWhere(p.id);
                  setError(undefined);
                }}
              />
              {p.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <DialogFooter className="mt-4">
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        {/* Enabled for any name: pressing it says why a name can't be used (blank included),
            rather than a disabled button that gives no reason. */}
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </EnterToSubmitForm>
  );
}
