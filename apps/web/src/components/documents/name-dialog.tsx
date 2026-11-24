import { useEffect, useEffectEvent, useId, useState } from "react";
import type { RunHooks } from "@fiscode/db";
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
import { previewLine, tooLongLine, type PathPreview } from "../../lib/path-preview";
import { TreeRunStatus, useTreeRun } from "./tree-run";

// One name, for a new folder or a rename. The repo's typed error (a taken name, too deep) shows
// as one line under the field, linked to it.
export function NameDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  /** `hooks` carry progress and Cancel for a change that moves files (a folder rename). */
  onSubmit: (name: string, where: string | null, hooks: RunHooks) => Promise<void>;
  /** The path the save would write, by the save's own rules (vault PR 8b), shown as you type. */
  preview?: (name: string, where: string | null) => Promise<PathPreview>;
  /** Show progress and Cancel while the save runs (a folder rename moves every file in it). */
  progress?: boolean;
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
  preview,
  progress: showProgress,
}: {
  onOpenChange: (open: boolean) => void;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string, where: string | null, hooks: RunHooks) => Promise<void>;
  places?: { id: string | null; label: string }[];
  validate?: (name: string) => string | undefined;
  preview?: (name: string, where: string | null) => Promise<PathPreview>;
  progress?: boolean;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState(places?.[0]?.id ?? null);
  const id = useId();
  const run = useTreeRun();
  // The path as you type, from the repo (an async read): kept with the input it answers, so a
  // slow answer for an older name is never shown for the current one.
  const [shown, setShown] = useState<{ key: string; preview: PathPreview }>();
  const key = `${where ?? ""}\u0000${name}`;
  // The prop is a new function each render; read it from an effect event so only the input
  // (name, where) re-runs the preview.
  const ask = useEffectEvent((n: string, w: string | null) => preview?.(n, w));
  const wants = !!preview;
  useEffect(() => {
    if (!wants || !name.trim()) return;
    let live = true;
    const t = setTimeout(() => {
      ask(name, where)
        ?.then((p) => live && setShown({ key, preview: p }))
        // An invalid name has no path; the field's own check says why, on blur or submit.
        .catch(() => live && setShown(undefined));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [wants, name, where, key]);
  const current = shown?.key === key ? shown.preview : undefined;
  return (
    <EnterToSubmitForm
      onSubmit={async (e) => {
        e.preventDefault();
        const problem = validate?.(name);
        if (problem) return setError(problem);
        // Blocked before the save when the preview says it won't fit (the save would throw
        // VaultPathTooLongError, which stays the fallback).
        if (current && !current.fits) return setError(tooLongLine(current));
        setBusy(true);
        const hooks = run.start();
        try {
          await onSubmit(name, where, hooks);
          onOpenChange(false);
        } catch (err) {
          // FolderFixedError, FolderNameTakenError, OperationCancelledError ("Cancelled. Nothing
          // was changed.") and the rest: their own message.
          setError(errorLine(err));
        } finally {
          run.finish();
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
          aria-describedby={
            [error ? `${id}-error` : "", preview ? `${id}-path` : ""].filter(Boolean).join(" ") ||
            undefined
          }
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
        {preview ? (
          <p
            id={`${id}-path`}
            aria-live="polite"
            className="min-h-5 text-xs break-all text-muted-foreground"
          >
            {current ? previewLine(current) : null}
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
      {showProgress && run.running ? (
        <TreeRunStatus progress={run.progress} onCancel={run.cancel} />
      ) : null}
      <DialogFooter className="mt-4">
        <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
          Cancel
        </DialogClose>
        {/* Enabled for any name: pressing it says why a name can't be used (blank included),
            rather than a disabled button that gives no reason. */}
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </EnterToSubmitForm>
  );
}
