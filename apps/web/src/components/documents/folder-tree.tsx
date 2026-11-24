import { Link } from "@tanstack/react-router";
import { Folder, FolderOpen, Inbox, Trash2 } from "lucide-react";

import type { FolderNode } from "@fiscode/db";
import { flattenTree } from "../../lib/documents-view";
import { MAIN_ID } from "../../lib/nav";

// The folder tree: links, so Tab and Enter work without a mouse. On a phone it folds into a
// "Folders" disclosure above the list.
export function FolderTree({
  tree,
  selected,
  unfiled = false,
  unfiledCount = 0,
  trash,
}: {
  tree: FolderNode[];
  selected: string | null;
  /** The open list is the documents with no folder. */
  unfiled?: boolean;
  unfiledCount?: number;
  trash: boolean;
}) {
  const rows = flattenTree(tree);
  const unfiledOpen = !trash && unfiled;
  const list = (
    <nav aria-label="Folders" className="grid gap-0.5 text-sm">
      {/* Documents with no folder have no node of their own; this lists them. Hidden while there
          are none, unless it is the open list (its last document just moved out). */}
      {unfiledCount > 0 || unfiledOpen ? (
        <Link
          from="/documents"
          search={{ unfiled: true }}
          aria-current={unfiledOpen ? "page" : undefined}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted ${unfiledOpen ? "bg-muted font-medium" : ""}`}
        >
          <Inbox
            className={`size-4 shrink-0 ${unfiledOpen ? "" : "text-muted-foreground"}`}
            aria-hidden
          />
          <span className="truncate">Unfiled</span>
          {unfiledCount > 0 ? (
            <span className="ms-auto text-xs text-muted-foreground tabular-nums">
              {unfiledCount}
              <span className="sr-only"> {unfiledCount === 1 ? "document" : "documents"}</span>
            </span>
          ) : null}
        </Link>
      ) : null}
      {rows.map(({ folder, depth, documentCount }) => {
        const isSelected = !trash && !unfiled && folder.id === selected;
        return (
          <Link
            key={folder.id}
            from="/documents"
            search={{ folder: folder.id }}
            aria-current={isSelected ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted ${isSelected ? "bg-muted font-medium" : ""}`}
            style={{ paddingInlineStart: `${0.5 + depth}rem` }}
          >
            {isSelected ? (
              <FolderOpen className="size-4 shrink-0" aria-hidden />
            ) : (
              <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate">{folder.name}</span>
            {documentCount > 0 ? (
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                {documentCount}
                <span className="sr-only"> {documentCount === 1 ? "document" : "documents"}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
      <Link
        from="/documents"
        search={{ trash: true }}
        aria-current={trash ? "page" : undefined}
        className={`mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted ${trash ? "bg-muted font-medium" : ""}`}
      >
        <Trash2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Trash
      </Link>
    </nav>
  );
  return (
    <>
      {/* A pick closes it on a phone, so the folder's documents are in view, and focus moves to
          main (as the phone nav sheet does) rather than falling to the page body. */}
      <details
        className="relative rounded-md border border-border p-2 @3xl:hidden"
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("a")) return;
          e.currentTarget.open = false;
          document.getElementById(MAIN_ID)?.focus();
        }}
      >
        <summary className="cursor-pointer text-sm font-medium">Folders</summary>
        <div className="mt-2">{list}</div>
      </details>
      <div className="hidden @3xl:block">{list}</div>
    </>
  );
}
