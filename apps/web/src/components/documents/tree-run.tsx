import { useRef, useState } from "react";
import { Button } from "@fiscode/ui/components/button";
import { DialogClose } from "@fiscode/ui/components/dialog";
import type { RunHooks, TreeProgress } from "@fiscode/db";

// Progress and Cancel for a folder rename or move (ADR 0001 § 11.3): file ops done of total, then
// the commit. A cancel before the commit leaves everything as it was (OperationCancelledError,
// "Cancelled. Nothing was changed."); once saving starts, Cancel is off and the change finishes.

/** "Moving files (3 of 40)", "Saving", or "Updating file names (2 of 5)". */
export const treeProgressLine = (p: TreeProgress): string => {
  if (p.phase === "saving" || p.phase === "done") return "Saving";
  const what = p.phase === "repathing" ? "Updating file names" : "Moving files";
  return p.total > 0 ? `${what} (${Math.min(p.done, p.total)} of ${p.total})` : what;
};

/** After the commit point the change can't be cancelled. */
export const pastCommit = (p: TreeProgress | undefined): boolean =>
  p?.phase === "saving" || p?.phase === "done";

export type TreeRun = ReturnType<typeof useTreeRun>;

/**
 * A dialog's save: whether it is running, its progress, and a cancel. Held by the dialog, not its
 * form, so the dialog can refuse to close while it runs (REVIEW #116 r1 F1).
 */
export function useTreeRun() {
  const [progress, setProgress] = useState<TreeProgress>();
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const start = (): RunHooks => {
    controller.current = new AbortController();
    setProgress(undefined);
    setRunning(true);
    return { signal: controller.current.signal, onProgress: setProgress };
  };
  const finish = () => {
    controller.current = null;
    setRunning(false);
    setProgress(undefined);
  };
  const cancel = () => controller.current?.abort();
  return { progress, running, start, finish, cancel };
}

/** Closing (X, Escape, the overlay) does nothing while a save runs: Cancel is the way out. */
export const guardClose =
  (run: TreeRun, onOpenChange: (open: boolean) => void) => (open: boolean) => {
    if (!open && run.running) return;
    onOpenChange(open);
  };

/** The progress line while a save that moves files runs. */
export function TreeRunLine({ run }: { run: TreeRun }) {
  if (!run.running) return null;
  return (
    <p role="status" className="mt-4 text-sm">
      {run.progress ? treeProgressLine(run.progress) : "Starting"}…
    </p>
  );
}

/**
 * The footer's one Cancel. Idle, it closes the dialog. While a save that can be cancelled runs,
 * it cancels it, until the commit point; then it is off and says the change finishes. A save that
 * can't be cancelled (`cancellable` false) turns it off while it runs.
 */
export function RunCancelButton({ run, cancellable }: { run: TreeRun; cancellable: boolean }) {
  if (!run.running) {
    return <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>;
  }
  const off = !cancellable || pastCommit(run.progress);
  return (
    <Button type="button" variant="outline" disabled={off} onClick={run.cancel}>
      Cancel
      {cancellable && off ? <span className="sr-only"> (saving, it finishes now)</span> : null}
    </Button>
  );
}
