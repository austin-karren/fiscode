import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";

import { documentLinkRepo } from "@fiscode/db";
import type { DocumentLinkRow } from "@fiscode/csv";
import { softDeleteWithUndo } from "../../lib/soft-delete";
import { ReadOnlyNote } from "../read-only-note";
import { useVaultReadOnly } from "../../lib/vault-migration";
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
  // Unlinking is a document write: off until the vault migration is done (§ 10).
  const readOnly = useVaultReadOnly();
  const [links, setLinks] = useState<Linked[]>();
  const id = useId();
  const list = useRef<HTMLElement>(null);

  const load = useCallback(
    () => documentLinkRepo.forRecord(recordType, recordId).then(setLinks),
    [recordType, recordId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // Before the row goes, focus moves to the next Unlink button (or the previous), else the
  // heading: the dialog takes focus back if the focused button is removed under it.
  const focusNeighbour = (index: number) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>("button[data-unlink]") ?? [])];
    const next = buttons[index + 1] ?? buttons[index - 1];
    (next ?? list.current?.querySelector<HTMLElement>("h3"))?.focus();
  };

  const unlink = async (l: Linked, index: number) => {
    const { document: doc, ...row } = l;
    focusNeighbour(index);
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
    <section ref={list} aria-labelledby={`${id}-docs`} className="mt-4 grid gap-1">
      <h3 id={`${id}-docs`} tabIndex={-1} className="text-sm font-medium outline-none">
        Documents
      </h3>
      {links.length > 0 ? <ReadOnlyNote reason={readOnly} /> : null}
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None attached. Use Attach on the row to add one.
        </p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {links.map((l, index) => (
            <li key={l.id} className="flex min-w-0 items-center justify-between gap-2">
              <Link
                to="/documents"
                search={{
                  folder: l.document.folderId ?? undefined,
                  unfiled: l.document.folderId === null ? true : undefined,
                  doc: l.document.id,
                }}
                className="min-w-0 truncate underline-offset-4 hover:underline"
              >
                {l.document.name}
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                data-unlink
                disabled={!!readOnly}
                onClick={() => void unlink(l, index)}
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
