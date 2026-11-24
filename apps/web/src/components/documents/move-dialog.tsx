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
import { Label } from "@fiscode/ui/components/label";

import type { FolderNode } from "@fiscode/db";
import { errorLine, flattenTree, folderPath } from "../../lib/documents-view";
import { SelectWithLabels } from "../forms/select-with-labels";

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
  onMove: (folderId: string | null) => Promise<void>;
  /** Where focus goes on close, as Base UI's finalFocus (the default returns it to the opener). */
  finalFocus?: React.ComponentProps<typeof DialogContent>["finalFocus"];
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent finalFocus={props.finalFocus}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        {/* Mounted each time it opens, so it starts from where the item is now. */}
        {props.open ? <MoveForm {...props} /> : null}
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
}: {
  onOpenChange: (open: boolean) => void;
  tree: FolderNode[];
  exclude: Set<string>;
  topLabel: string;
  current: string | null;
  onMove: (folderId: string | null) => Promise<void>;
}) {
  const [target, setTarget] = useState(current ?? TOP);
  const [error, setError] = useState<string>();
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
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button
          onClick={async () => {
            try {
              await onMove(target === TOP ? null : target);
              onOpenChange(false);
            } catch (err) {
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
