import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@fiscode/ui/components/alert-dialog";
import { Button } from "@fiscode/ui/components/button";

// One kind of row that points at the item being archived.
export type ArchiveReference = { count: number; singular: string; plural: string };

const joinList = (parts: string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

// "3 income rows and 1 time entry reference it." Kinds with no rows are left
// out; with none at all it says so, so the user knows nothing else changes.
export const describeReferences = (references: ArchiveReference[]): string => {
  const used = references.filter((r) => r.count > 0);
  if (used.length === 0) return "Nothing references it.";
  const total = used.reduce((sum, r) => sum + r.count, 0);
  const parts = used.map((r) => `${r.count} ${r.count === 1 ? r.singular : r.plural}`);
  return `${joinList(parts)} ${total === 1 ? "references" : "reference"} it.`;
};

// "2 linked documents stay in Documents." Archiving leaves links alone; none, nothing said.
export const describeDocuments = (count: number): string =>
  count === 0
    ? ""
    : `${count} linked ${count === 1 ? "document stays" : "documents stay"} in Documents. `;

// Archive button for a parent row (client, vehicle). Archiving hides the item
// from pickers while other rows still point at it, which is hard to eyeball,
// so it asks first and says how many rows are affected.
export function ArchiveDialog({
  itemName,
  recordName,
  references,
  documents = 0,
  onConfirm,
}: {
  itemName: string;
  /** The record in the button's accessible name, as Edit and Delete name it ("client Acme"). */
  recordName: string;
  references: ArchiveReference[];
  /** Documents linked to the item, from documentLinkRepo.countsFor. */
  documents?: number;
  onConfirm: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const hasReferences = references.some((r) => r.count > 0);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Archive <span className="sr-only">{recordName}</span>
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {itemName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {describeReferences(references)}{" "}
            {hasReferences
              ? "Those rows stay as they are and keep showing its name, marked as archived. "
              : ""}
            {describeDocuments(documents)}It no longer appears in pickers. You can bring it back
            under “Show archived”.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={async () => {
              await onConfirm();
              setOpen(false);
            }}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
