import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  const list = useRef<HTMLElement>(null);

  const load = useCallback(
    () => documentLinkRepo.forRecord(recordType, recordId).then(setLinks),
    [recordType, recordId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // After Unlink, focus moves to the next Unlink button (or the previous), else the heading.
  const focusAfter = (index: number) => {
    const buttons = list.current?.querySelectorAll<HTMLElement>("button[data-unlink]") ?? [];
    const next = buttons[Math.min(index, buttons.length - 1)];
    (next ?? list.current?.querySelector<HTMLElement>("h3"))?.focus();
  };

  // Focus moves once the list has re-rendered without (or with) the row.
  const focusPending = useRef<number | null>(null);
  useEffect(() => {
    if (focusPending.current === null) return;
    focusAfter(focusPending.current);
    focusPending.current = null;
  });

  const unlink = async (l: Linked, index: number) => {
    const { document: doc, ...row } = l;
    await softDeleteWithUndo<DocumentLinkRow>({
      repo: { softDelete: documentLinkRepo.unlink, revertTo: documentLinkRepo.revertTo },
      row,
      message: `Unlinked ${doc.name}.`,
      undoneMessage: `Attached ${doc.name} again.`,
      onChange: () => {
        focusPending.current = index;
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
                data-unlink
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
