import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";

import { documentLinkRepo } from "@fiscode/db";
import type { DocumentLinkRow } from "@fiscode/csv";
import { softDeleteWithUndo } from "../../lib/soft-delete";
import type { LinkableRecordType } from "../../lib/documents-links";

type Linked = Awaited<ReturnType<typeof documentLinkRepo.forRecord>>[number];

// The documents attached to one row, in its Edit dialog. Each opens on the Documents screen, and
// Unlink takes the link away (the document stays) with Undo.
export function LinkedDocuments({
  recordType,
  recordId,
  onChanged,
}: {
  recordType: LinkableRecordType;
  recordId: string;
  onChanged: () => void;
}) {
  const [links, setLinks] = useState<Linked[]>();
  const id = useId();

  const load = useCallback(
    () => documentLinkRepo.forRecord(recordType, recordId).then(setLinks),
    [recordType, recordId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const unlink = async (l: Linked) => {
    const { document: doc, ...row } = l;
    await softDeleteWithUndo<DocumentLinkRow>({
      repo: { softDelete: documentLinkRepo.unlink, revertTo: documentLinkRepo.revertTo },
      row,
      message: `Unlinked ${doc.name}.`,
      undoneMessage: `Attached ${doc.name} again.`,
      onChange: () => {
        void load();
        onChanged();
      },
    });
  };

  if (links === undefined) return null;
  return (
    <section aria-labelledby={`${id}-docs`} className="mt-4 grid gap-1">
      <h3 id={`${id}-docs`} className="text-sm font-medium">
        Documents
      </h3>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None attached. Use Attach on the row to add one.
        </p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {links.map((l) => (
            <li key={l.id} className="flex min-w-0 items-center justify-between gap-2">
              <Link
                to="/documents"
                search={{ folder: l.document.folderId ?? undefined, doc: l.document.id }}
                className="min-w-0 truncate underline-offset-4 hover:underline"
              >
                {l.document.name}
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => void unlink(l)}
              >
                Unlink <span className="sr-only">{l.document.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
