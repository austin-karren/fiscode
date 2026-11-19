import { toast } from "sonner";

// The two repo methods undo needs. Every crud repo in @fiscode/db has them.
type RestorableRepo<TRow> = {
  softDelete: (id: string) => Promise<boolean>;
  revertTo: (id: string, snapshot: TRow) => Promise<TRow | undefined>;
};

type SoftDeletableRow = { id: string; deletedAt?: string | null };

// Long enough to read the toast and reach the button; sonner's default is 4 s.
const UNDO_TOAST_MS = 8000;

// Soft-deletes `row` at once and shows a toast with Undo. Undo restores the
// row exactly as it was passed in, so pass the row as loaded, before any
// change. `onChange` runs after the delete and again after an undo; routes
// pass `router.invalidate`.
//
// Used for every row delete and for archiving a client or vehicle (there
// after its confirm dialog).
export async function softDeleteWithUndo<TRow extends SoftDeletableRow>({
  repo,
  row,
  message,
  undoneMessage = "Restored.",
  onChange,
}: {
  repo: RestorableRepo<TRow>;
  row: TRow;
  message: string;
  undoneMessage?: string;
  onChange: () => void;
}): Promise<void> {
  await repo.softDelete(row.id);
  onChange();
  toast(message, {
    duration: UNDO_TOAST_MS,
    action: {
      label: "Undo",
      onClick: () => void restoreRow({ repo, row, message: undoneMessage, onChange }),
    },
  });
}

// Brings a soft-deleted row back: the same row with `deletedAt` cleared.
export async function restoreRow<TRow extends SoftDeletableRow>({
  repo,
  row,
  message,
  onChange,
}: {
  repo: Pick<RestorableRepo<TRow>, "revertTo">;
  row: TRow;
  message: string;
  onChange: () => void;
}): Promise<void> {
  await repo.revertTo(row.id, { ...row, deletedAt: null });
  onChange();
  toast.success(message);
}

// Puts a row back to an earlier `snapshot` and shows a toast with Undo. Undo
// returns the row to `current`, the row as it was just before. A row that
// did not exist then cannot be removed again, so Undo deletes it instead.
//
// Used by the History screen's Restore.
export async function revertWithUndo<TRow extends SoftDeletableRow>({
  repo,
  snapshot,
  current,
  message,
  undoneMessage = "Undone.",
  onChange,
}: {
  repo: RestorableRepo<TRow>;
  snapshot: TRow;
  current: TRow | undefined;
  message: string;
  undoneMessage?: string;
  onChange: () => void;
}): Promise<void> {
  await repo.revertTo(snapshot.id, snapshot);
  onChange();
  toast(message, {
    duration: UNDO_TOAST_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        if (current) await repo.revertTo(current.id, current);
        else await repo.softDelete(snapshot.id);
        onChange();
        toast.success(undoneMessage);
      },
    },
  });
}
