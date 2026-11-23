import { Button } from "@fiscode/ui/components/button";
import { vaultFolderRules } from "@fiscode/core";
import type { DocumentFolderRow } from "@fiscode/csv";

// The open folder's actions. Year folders are fixed; a year's default folders can be renamed but
// stay in their year; user folders are free (ADR 0001 § 5, D5). Delete is not part of those rules.
export function FolderActions(props: {
  folder: DocumentFolderRow;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const rules = vaultFolderRules(props.folder.defaultKey);
  return (
    <>
      {rules.rename ? (
        <Button variant="ghost" onClick={props.onRename}>
          Rename folder
        </Button>
      ) : null}
      {rules.move ? (
        <Button variant="ghost" onClick={props.onMove}>
          Move folder
        </Button>
      ) : null}
      <Button
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={props.onDelete}
      >
        Delete folder
      </Button>
    </>
  );
}
