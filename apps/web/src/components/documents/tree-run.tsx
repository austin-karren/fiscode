import { useRef, useState } from "react";
import { Button } from "@fiscode/ui/components/button";
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

/** A run's hooks, its progress, and a cancel. `start` gives fresh hooks for each run. */
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

/** The progress line and Cancel, shown while a run is going. */
export function TreeRunStatus({
  progress,
  onCancel,
}: {
  progress: TreeProgress | undefined;
  onCancel: () => void;
}) {
  const committed = pastCommit(progress);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <p role="status" className="text-sm">
        {progress ? treeProgressLine(progress) : "Starting"}…
      </p>
      <Button type="button" variant="outline" size="sm" disabled={committed} onClick={onCancel}>
        Cancel {committed ? <span className="sr-only">(saving, it finishes now)</span> : null}
      </Button>
    </div>
  );
}
