import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fiscode/ui/components/dialog";
import { Button } from "@fiscode/ui/components/button";
import { Label } from "@fiscode/ui/components/label";

import type { FolderNode, RunHooks } from "@fiscode/db";
import { errorLine, flattenTree, folderPath } from "../../lib/documents-view";
import { SelectWithLabels } from "../forms/select-with-labels";
import { guardClose, RunCancelButton, TreeRunLine, useTreeRun, type TreeRun } from "./tree-run";

const TOP = "__top__";

// Pick where a folder or document goes. Folders that can't take it (a folder itself and
// everything inside it) are left out; anything else the repo refuses shows as one line.
export function MoveDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  tree: FolderNode[];
  exclude: Set<string>;
  /** The choice for no folder: "Top level" for a folder, "Unfiled" for a document. */
  topLabel: string;
  current: string | null;
  onMove: (folderId: string | null, hooks: RunHooks) => Promise<void>;
  /** Show progress and Cancel while the move runs (a folder moves every file in it). */
  progress?: boolean;
  /** Where focus goes on close, as Base UI's finalFocus (the default returns it to the opener). */
  finalFocus?: React.ComponentProps<typeof DialogContent>["finalFocus"];
}) {
  const run = useTreeRun();
  return (
    <Dialog open={props.open} onOpenChange={guardClose(run, props.onOpenChange)}>
      <DialogContent finalFocus={props.finalFocus} showCloseButton={!run.running}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        {/* Mounted each time it opens, so it starts from where the item is now. */}
        {props.open ? <MoveForm {...props} run={run} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({
  onOpenChange,
  tree,
  exclude,
  topLabel,
  current,
  onMove,
  progress = false,
  run,
}: {
  run: TreeRun;
  onOpenChange: (open: boolean) => void;
  tree: FolderNode[];
  exclude: Set<string>;
  topLabel: string;
  current: string | null;
  onMove: (folderId: string | null, hooks: RunHooks) => Promise<void>;
  /** Show progress and Cancel while the move runs (a folder moves every file in it). */
  progress?: boolean;
}) {
  const [target, setTarget] = useState(current ?? TOP);
  const [error, setError] = useState<string>();
  const busy = run.running;
  const id = useId();
  const rows = flattenTree(tree);
  const folders = rows.map((r) => r.folder);
  // Each option is its full path ("2026 / Expenses"), so nesting reads without indentation.
  const items = [
    { value: TOP, label: topLabel },
    ...rows
      .filter((f) => !exclude.has(f.folder.id))
      .map((f) => ({ value: f.folder.id, label: folderPath(folders, f.folder.id) })),
  ];
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-to`}>Move to</Label>
        <SelectWithLabels
          id={`${id}-to`}
          value={target}
          onValueChange={(v) => {
            setTarget(v);
            setError(undefined);
          }}
          items={items}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {progress ? <TreeRunLine run={run} /> : null}
      <DialogFooter>
        <RunCancelButton run={run} cancellable={progress} />
        <Button
          disabled={busy}
          onClick={async () => {
            const hooks = run.start();
            try {
              await onMove(target === TOP ? null : target, hooks);
              run.finish();
              onOpenChange(false);
            } catch (err) {
              run.finish();
              // FolderFixedError, OperationCancelledError ("Nothing was changed.") and the rest.
              setError(errorLine(err));
            }
          }}
        >
          Move
        </Button>
      </DialogFooter>
    </>
  );
}
