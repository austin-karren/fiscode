import { useId, useRef, useState } from "react";
import type { RunHooks } from "@fiscode/db";
import { VaultPathTooLongError } from "@fiscode/core";
import {
  Dialog,
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
import { previewLine, type PathPreview } from "../../lib/path-preview";
import { guardClose, RunCancelButton, TreeRunLine, useTreeRun, type TreeRun } from "./tree-run";

type Props = {
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
};

// One name, for a new folder or a rename. The repo's typed error (a taken name, too deep) shows
// as one line under the field, linked to it.
export function NameDialog(props: Props) {
  const run = useTreeRun();
  return (
    <Dialog open={props.open} onOpenChange={guardClose(run, props.onOpenChange)}>
      <DialogContent showCloseButton={!run.running}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.note ? <DialogDescription>{props.note}</DialogDescription> : null}
        </DialogHeader>
        {/* Mounted each time the dialog opens, so it starts from `initial` (the current name for a
            rename, blank for a new folder), never from what was typed last time. */}
        {props.open ? <NameForm {...props} run={run} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** What the line under the field says about the path: where it saves, or why it can't. */
type Shown = { key: string; preview?: PathPreview; problem?: string };

function NameForm({
  onOpenChange,
  label,
  initial = "",
  submitLabel,
  onSubmit,
  places,
  validate,
  preview,
  progress: showProgress = false,
  run,
}: Props & { run: TreeRun }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<{ line: string; tooLong?: boolean }>();
  const [where, setWhere] = useState(places?.[0]?.id ?? null);
  const id = useId();
  const busy = run.running;

  // The path as you type, asked from the input's own events (no effect): debounced, and kept with
  // the input it answers, so a slow answer for an older name is never shown for the current one.
  const [shown, setShown] = useState<Shown>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The input last asked about: an answer for any other is dropped, so it can't replace a newer one.
  const asked = useRef<string>(undefined);
  const keyOf = (n: string, w: string | null) => `${w ?? ""}\u0000${n}`;
  const key = keyOf(name, where);
  const ask = (n: string, w: string | null) => {
    if (!preview) return;
    clearTimeout(timer.current);
    asked.current = undefined;
    if (!n.trim()) return setShown(undefined);
    // A name the field refuses has no path: say why here, as you type (REVIEW #116 r1 F6).
    const problem = validate?.(n);
    if (problem) return setShown({ key: keyOf(n, w), problem });
    const k = keyOf(n, w);
    asked.current = k;
    timer.current = setTimeout(() => {
      preview(n, w)
        .then((p) => asked.current === k && setShown({ key: k, preview: p }))
        .catch(
          (err: unknown) => asked.current === k && setShown({ key: k, problem: errorLine(err) }),
        );
    }, 150);
  };
  const current = shown?.key === key ? shown : undefined;
  const tooLong = current?.preview?.fits === false;
  // When the save's own VaultPathTooLongError and the preview both say "too long", show the
  // preview's line only (REVIEW #116 r1 F4).
  const errorShown = error && !(error.tooLong && tooLong) ? error : undefined;
  const invalid = !!errorShown || tooLong;

  return (
    <EnterToSubmitForm
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const problem = validate?.(name);
        if (problem) return setError({ line: problem });
        // Blocked before the save when the preview says it won't fit; its line already says why
        // (the save's VaultPathTooLongError stays the fallback).
        if (tooLong) {
          document.getElementById(`${id}-name`)?.focus();
          return;
        }
        const hooks = run.start();
        try {
          await onSubmit(name, where, hooks);
          run.finish();
          onOpenChange(false);
        } catch (err) {
          run.finish();
          // FolderFixedError, FolderNameTakenError, OperationCancelledError ("Cancelled. Nothing
          // was changed.") and the rest: their own message.
          setError({ line: errorLine(err), tooLong: err instanceof VaultPathTooLongError });
        }
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>{label}</Label>
        <Input
          id={`${id}-name`}
          value={name}
          autoFocus
          // Read-only, not disabled, while a save runs: disabling the focused field drops focus
          // to the page body and fires a blur that cleared the save's error (REVIEW #116 r2).
          readOnly={busy}
          aria-busy={busy || undefined}
          // Read-only only while a save runs: it looks off too, like a disabled field.
          className="read-only:bg-muted read-only:text-muted-foreground"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={
            [errorShown ? `${id}-error` : "", preview ? `${id}-path` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
          // Focus comes first (autoFocus): a rename shows where the current name saves.
          onFocus={() => {
            if (!shown) ask(name, where);
          }}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
            ask(e.target.value, where);
          }}
          onBlur={() => {
            if (busy) return;
            const problem = validate?.(name);
            setError(problem ? { line: problem } : undefined);
          }}
        />
        {errorShown ? (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {errorShown.line}
          </p>
        ) : null}
        {preview ? (
          <p
            id={`${id}-path`}
            aria-live="polite"
            className={`min-h-5 text-xs break-all ${
              tooLong || current?.problem ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {current?.preview
              ? previewLine(current.preview)
              : current?.problem && !errorShown
                ? current.problem
                : null}
          </p>
        ) : null}
      </div>
      {places && places.length > 1 ? (
        <fieldset className="mt-4 grid min-w-0 gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Where</legend>
          {places.map((p) => (
            // A long folder name wraps instead of widening the dialog (REVIEW #116 r1 F5).
            <label key={p.id ?? "top"} className="flex min-w-0 items-start gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-where`}
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={where === p.id}
                disabled={busy}
                onChange={() => {
                  setWhere(p.id);
                  setError(undefined);
                  ask(name, p.id);
                }}
              />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{p.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {showProgress ? <TreeRunLine run={run} /> : null}
      <DialogFooter className="mt-4">
        <RunCancelButton run={run} cancellable={showProgress} />
        {/* Enabled for any name: pressing it says why a name can't be used (blank included),
            rather than a disabled button that gives no reason. */}
        {/* aria-disabled, not disabled, while it runs: a disabled focused button drops focus. */}
        <Button type="submit" aria-disabled={busy || undefined}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </EnterToSubmitForm>
  );
}
