import { useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { Input } from "@fiscode/ui/components/input";
import { ConfirmDialog } from "@fiscode/ui/components/confirm-dialog";
import { todayIso, yearOf } from "@fiscode/core";
import { FileText, Folder, Upload } from "lucide-react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { SectionTitle } from "../components/section-title";
import { NameDialog } from "../components/documents/name-dialog";
import { MoveDialog } from "../components/documents/move-dialog";
import { DocumentSheet } from "../components/documents/document-sheet";
import { FolderTree } from "../components/documents/folder-tree";
import { FolderActions } from "../components/documents/folder-actions";
import { ReadOnlyNote } from "../components/read-only-note";
import { useVaultReadOnly } from "../lib/vault-migration";
import { ALLOWED_DOCUMENT_MIMES, YEAR_ROOT_KEY, validDocumentName } from "@fiscode/core";
import {
  documentLinkRepo,
  documentRepo,
  folderRepo,
  readLastScanReport,
  scanReviewCount,
} from "@fiscode/db";
import { useFocusScan } from "../lib/focus-scan";
import { buttonVariants } from "@fiscode/ui/components/button";
import type { DocumentRow, DocumentFolderRow } from "@fiscode/csv";
import { openFolderId, parseDocumentsSearch, uploadLinesFor } from "../lib/documents-search";
import { errorLine, fileKind, folderPath, formatBytes, subtreeOf } from "../lib/documents-view";
import { softDeleteWithUndo } from "../lib/soft-delete";
import { uploadFiles, type UploadResult } from "../lib/documents-upload";
import { landedLine, restoreDocument } from "../lib/documents-restore";
import { focusAfterRemoval, targetAfterRemoval } from "../lib/focus-after-removal";
import { formatDate } from "../lib/format-date";

export const Route = createFileRoute("/documents")({
  validateSearch: parseDocumentsSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const year = yearOf(todayIso());
    // The year's folders, made once; a folder the user deleted stays deleted.
    await folderRepo.ensureYearDefaults(year);
    const [tree, folders, allFolders, allDocs, linkCounts, lastScan] = await Promise.all([
      folderRepo.tree(),
      folderRepo.list(),
      folderRepo.listIncludingDeleted(),
      documentRepo.listIncludingDeleted(),
      documentLinkRepo.countsByDocument(),
      readLastScanReport(),
    ]);
    // By default_key, so a renamed year folder is still the year's.
    const yearFolder = folders.find((f) => f.defaultKey === YEAR_ROOT_KEY && f.taxYear === year);
    const folderId = openFolderId(deps, yearFolder?.id);
    const docs = deps.q
      ? await documentRepo.search(deps.q)
      : await documentRepo.listInFolder(folderId);
    return {
      year,
      tree,
      folders,
      folderId,
      docs,
      linkCounts,
      allDocs,
      // The badge on Check folder: what the last scan (focus, boot or Check now) left to review.
      toReview: lastScan ? scanReviewCount(lastScan) : 0,
      unfiledCount: allDocs.filter((d) => d.deletedAt === null && d.folderId === null).length,
      trashFolders: allFolders.filter((f) => f.deletedAt !== null),
      trashDocs: allDocs.filter((d) => d.deletedAt !== null),
    };
  },
  component: DocumentsPage,
});

function DocumentsPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/documents" });
  const router = useRouter();
  useFocusScan();
  const refresh = () => router.invalidate();
  const { tree, folders, folderId, docs, linkCounts } = data;
  const current = folders.find((f) => f.id === folderId);
  // Read-only until the vault migration is done (§ 10): writes off, preview still works.
  const readOnly = useVaultReadOnly();
  const openDoc = data.allDocs.find((d) => d.id === search.doc && d.deletedAt === null);

  const [dialog, setDialog] = useState<
    | { kind: "new-folder" }
    | { kind: "rename-folder"; folder: DocumentFolderRow }
    | { kind: "move-folder"; folder: DocumentFolderRow }
    | { kind: "rename-doc"; doc: DocumentRow }
    | { kind: "move-doc"; doc: DocumentRow; from: HTMLElement }
    | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    folder: DocumentFolderRow;
    counts: { folders: number; documents: number };
  } | null>(null);
  // Upload lines belong to the list they were made in: another folder doesn't show them, and a
  // move clears them (they'd name where a file no longer is).
  const [uploaded, setUploaded] = useState<{ folderId: string | null; results: UploadResult[] }>({
    folderId: null,
    results: [],
  });
  // Leaving the list clears them, so coming back doesn't bring them back (React's "adjust state
  // when a prop changes": set during render, no effect).
  const [listedAt, setListedAt] = useState(folderId);
  if (listedAt !== folderId) {
    setListedAt(folderId);
    setUploaded({ folderId: null, results: [] });
  }
  const results = uploadLinesFor(uploaded, { folderId, q: search.q });
  // After a move, where focus lands (resolved as the dialog closes): set only when a move ran.
  const afterMove = useRef<(() => HTMLElement | null) | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    // A line per file; a duplicate's line names where the first copy is, with a link to it.
    const at = folderId;
    setUploaded({
      folderId: at,
      results: await uploadFiles(files, at, data.allDocs, (id) => folderPath(folders, id)),
    });
    await refresh();
  };

  const askDeleteFolder = async (folder: DocumentFolderRow) =>
    setConfirmDelete({ folder, counts: await folderRepo.countTree(folder.id) });

  const deleteFolder = async () => {
    if (!confirmDelete) return;
    const { folder } = confirmDelete;
    setConfirmDelete(null);
    const deleted = await showingError(() => folderRepo.softDeleteTree(folder.id));
    if (!deleted) return;
    await navigate({
      search: (s) => ({ ...s, folder: folder.parentId ?? undefined, unfiled: undefined }),
    });
    await refresh();
    toast(`Deleted ${folder.name}.`, {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () =>
          void showingError(async () => {
            const { shortened } = await folderRepo.restoreTree(deleted);
            toast(await landedLine(folder, shortened));
            await refresh();
          }),
      },
    });
  };

  const removeDoc = async (doc: DocumentRow, from: HTMLElement) => {
    const refocus = focusAfterRemoval(from);
    const done = await showingError(() =>
      softDeleteWithUndo({
        repo: documentRepo,
        row: doc,
        message: `Deleted ${doc.name}.`,
        undoneMessage: `Restored ${doc.name}.`,
        onChange: refresh,
      }).then(() => true),
    );
    if (!done) return;
    await refresh();
    refocus();
  };

  return (
    <Page
      title="Documents"
      description="Receipts, forms and statements, kept on this device and sorted by year."
      actions={
        <Link to="/documents/check" className={buttonVariants({ variant: "outline" })}>
          Check folder
          {data.toReview > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
              {data.toReview}
              <span className="sr-only"> to review</span>
            </span>
          ) : null}
        </Link>
      }
    >
      <div className="grid gap-4 @3xl:grid-cols-[16rem_1fr]">
        <FolderTree
          tree={tree}
          selected={folderId}
          unfiled={search.unfiled === true}
          unfiledCount={data.unfiledCount}
          trash={search.trash === true}
        />

        <div className="grid min-w-0 content-start gap-4">
          {search.trash ? (
            <TrashView
              folders={data.trashFolders}
              docs={data.trashDocs}
              allFolders={folders}
              readOnly={readOnly}
              onRestored={refresh}
            />
          ) : (
            <Card
              className={dragging ? "ring-2 ring-ring" : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                if (!readOnly) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!readOnly) void upload([...e.dataTransfer.files]);
              }}
            >
              <CardHeader>
                <CardTitle>
                  <SectionTitle ref={listHeading} tabIndex={-1} className="outline-none">
                    {search.q ? `Search: ${search.q}` : folderPath(folders, folderId)}
                  </SectionTitle>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <ReadOnlyNote reason={readOnly} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={!!readOnly} onClick={() => fileInput.current?.click()}>
                    <Upload />
                    Upload
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    accept={[...ALLOWED_DOCUMENT_MIMES, ".heic"].join(",")}
                    onChange={(e) => {
                      void upload([...(e.target.files ?? [])]);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={!!readOnly}
                    onClick={() => setDialog({ kind: "new-folder" })}
                  >
                    New folder
                  </Button>
                  {current ? (
                    <FolderActions
                      folder={current}
                      disabled={!!readOnly}
                      onRename={() => setDialog({ kind: "rename-folder", folder: current })}
                      onMove={() => setDialog({ kind: "move-folder", folder: current })}
                      onDelete={() => void askDeleteFolder(current)}
                    />
                  ) : null}
                  <form
                    role="search"
                    className="ms-auto"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
                      void navigate({ search: (s) => ({ ...s, q: q || undefined }) });
                    }}
                  >
                    <Input
                      name="q"
                      type="search"
                      aria-label="Search documents"
                      placeholder="Search documents"
                      defaultValue={search.q ?? ""}
                      className="w-56"
                    />
                  </form>
                </div>
                <p className="text-xs text-muted-foreground">
                  Drop files here, or use Upload. PDF, images or text, up to 25 MB each.
                </p>
                {results.length > 0 ? (
                  <ul role="status" aria-label="Upload results" className="grid gap-0.5 text-sm">
                    {results.map((r, i) => (
                      <li
                        key={`${r.name}-${i}`}
                        className={r.ok ? "text-foreground" : "text-destructive"}
                      >
                        {r.line}
                        {r.sameAs ? (
                          <>
                            {" "}
                            <Link
                              from="/documents"
                              search={(s) => ({ ...s, doc: r.sameAs!.id })}
                              className="underline underline-offset-2"
                            >
                              Open it
                            </Link>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {docs.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {search.q ? "No documents match." : "No documents in this folder yet."}
                  </p>
                ) : (
                  <DataTable>
                    <DataTable.Head>
                      <DataTable.Row>
                        <DataTable.HeaderCell>Name</DataTable.HeaderCell>
                        <DataTable.HeaderCell>Type</DataTable.HeaderCell>
                        <DataTable.HeaderCell align="right">Size</DataTable.HeaderCell>
                        <DataTable.HeaderCell>Added</DataTable.HeaderCell>
                        <DataTable.HeaderCell align="right">Links</DataTable.HeaderCell>
                        <DataTable.HeaderCell />
                      </DataTable.Row>
                    </DataTable.Head>
                    <DataTable.Body>
                      {docs.map((d) => (
                        <DataTable.Row key={d.id}>
                          <DataTable.Cell label="Name">
                            <Link
                              from="/documents"
                              search={(s) => ({ ...s, doc: d.id })}
                              className="inline-flex items-center gap-1.5 break-all underline-offset-2 hover:underline"
                            >
                              <FileText
                                className="size-4 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                              {d.name}
                            </Link>
                          </DataTable.Cell>
                          <DataTable.Cell label="Type">{fileKind(d.mime)}</DataTable.Cell>
                          <DataTable.Cell label="Size" align="right">
                            {formatBytes(d.sizeBytes)}
                          </DataTable.Cell>
                          <DataTable.Cell label="Added">
                            <span className="whitespace-nowrap">
                              {formatDate(new Date(d.addedAt))}
                            </span>
                          </DataTable.Cell>
                          <DataTable.Cell label="Links" align="right">
                            {linkCounts.get(d.id) ?? 0}
                          </DataTable.Cell>
                          <DataTable.Cell align="right">
                            <div className="inline-flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!!readOnly}
                                onClick={() => setDialog({ kind: "rename-doc", doc: d })}
                              >
                                Rename <span className="sr-only">{d.name}</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!!readOnly}
                                onClick={(e) =>
                                  setDialog({ kind: "move-doc", doc: d, from: e.currentTarget })
                                }
                              >
                                Move <span className="sr-only">{d.name}</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={!!readOnly}
                                onClick={(e) => void removeDoc(d, e.currentTarget)}
                              >
                                Delete <span className="sr-only">{d.name}</span>
                              </Button>
                            </div>
                          </DataTable.Cell>
                        </DataTable.Row>
                      ))}
                    </DataTable.Body>
                  </DataTable>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <NameDialog
        open={dialog?.kind === "new-folder"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="New folder"
        label="Folder name"
        submitLabel="Create"
        // The top level holds a folder per year; a past year's folder is made there directly.
        places={
          current
            ? [
                { id: current.id, label: `In ${folderPath(folders, current.id)}` },
                { id: null, label: "At the top level, beside the year folders" },
              ]
            : undefined
        }
        onSubmit={async (name, where) => {
          const made = await folderRepo.create({ name, parentId: where });
          await navigate({
            search: (s) => ({ ...s, folder: made.id, unfiled: undefined, q: undefined }),
          });
          await refresh();
        }}
      />
      <NameDialog
        open={dialog?.kind === "rename-folder"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Rename folder"
        label="Folder name"
        initial={dialog?.kind === "rename-folder" ? dialog.folder.name : ""}
        note={dialog?.kind === "rename-folder" ? renameNote(dialog.folder) : undefined}
        submitLabel="Rename"
        onSubmit={async (name) => {
          if (dialog?.kind !== "rename-folder") return;
          await folderRepo.rename(dialog.folder.id, name);
          await refresh();
        }}
      />
      <NameDialog
        open={dialog?.kind === "rename-doc"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Rename document"
        label="Name"
        validate={documentNameProblem}
        initial={dialog?.kind === "rename-doc" ? dialog.doc.name : ""}
        submitLabel="Rename"
        onSubmit={async (name) => {
          if (dialog?.kind !== "rename-doc") return;
          await documentRepo.rename(dialog.doc.id, name);
          await refresh();
        }}
      />
      <MoveDialog
        open={dialog?.kind === "move-folder"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "move-folder" ? `Move ${dialog.folder.name}` : "Move folder"}
        tree={tree}
        exclude={dialog?.kind === "move-folder" ? subtreeOf(folders, dialog.folder.id) : new Set()}
        topLabel="Top level"
        current={dialog?.kind === "move-folder" ? dialog.folder.parentId : null}
        onMove={async (to) => {
          if (dialog?.kind !== "move-folder") return;
          await folderRepo.move(dialog.folder.id, to);
          await refresh();
        }}
      />
      <MoveDialog
        open={dialog?.kind === "move-doc"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "move-doc" ? `Move ${dialog.doc.name}` : "Move document"}
        tree={tree}
        exclude={new Set()}
        topLabel="Unfiled"
        current={dialog?.kind === "move-doc" ? dialog.doc.folderId : null}
        onMove={async (to) => {
          if (dialog?.kind !== "move-doc") return;
          const target = targetAfterRemoval(dialog.from, () => listHeading.current);
          await documentRepo.move(dialog.doc.id, to);
          setUploaded({ folderId: null, results: [] });
          afterMove.current = target;
          await refresh();
        }}
        finalFocus={() => {
          const target = afterMove.current?.();
          afterMove.current = null;
          if (!target) return true;
          target.focus();
          return false;
        }}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={confirmDelete ? `Delete ${confirmDelete.folder.name}?` : "Delete folder?"}
        description={
          confirmDelete
            ? `This deletes ${n(confirmDelete.counts.folders, "folder")} and ${n(confirmDelete.counts.documents, "document")}. You can undo it, or restore them from Trash.`
            : ""
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => void deleteFolder()}
      />
      <DocumentSheet
        doc={openDoc}
        folderPath={openDoc ? folderPath(folders, openDoc.folderId) : ""}
        onClose={() => void navigate({ search: (s) => ({ ...s, doc: undefined }) })}
        onChanged={refresh}
      />
    </Page>
  );
}

// core's validDocumentName throws DocumentNameInvalidError; the dialog wants the reason as text.
const documentNameProblem = (name: string): string | undefined => {
  try {
    validDocumentName(name);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : "That name can't be used.";
  }
};

// A year's default folder is renamed in that year only: other years keep their own (§ 5, D5).
const renameNote = (folder: DocumentFolderRow): string | undefined =>
  folder.defaultKey !== null && folder.defaultKey !== YEAR_ROOT_KEY && folder.taxYear !== null
    ? `Only ${folder.taxYear}: other years keep their own ${folder.name} folder.`
    : undefined;

// A refused write (VaultMigratingError, a taken name...) shows its own message; undefined then.
const showingError = async <T,>(write: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await write();
  } catch (err) {
    toast.error(errorLine(err));
    return undefined;
  }
};

const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

// Deleted folders and documents, each with Restore.
function TrashView({
  folders,
  docs,
  allFolders,
  readOnly,
  onRestored,
}: {
  folders: DocumentFolderRow[];
  docs: DocumentRow[];
  allFolders: DocumentFolderRow[];
  readOnly: string | undefined;
  onRestored: () => Promise<void>;
}) {
  const restoreFolder = (f: DocumentFolderRow) =>
    showingError(async () => {
      await folderRepo.revertTo(f.id, { ...f, deletedAt: null });
      toast(await landedLine(f));
      await onRestored();
    });
  const restoreDoc = (d: DocumentRow) =>
    showingError(async () => {
      toast(await restoreDocument(d));
      await onRestored();
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <SectionTitle>Trash</SectionTitle>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ReadOnlyNote reason={readOnly} />
        {folders.length === 0 && docs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Trash is empty.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {folders.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <Folder className="size-4 text-muted-foreground" aria-hidden />
                  {folderPath([...allFolders, f], f.id)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!readOnly}
                  onClick={() => void restoreFolder(f)}
                >
                  Restore <span className="sr-only">folder {f.name}</span>
                </Button>
              </li>
            ))}
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 break-all">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {d.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!readOnly}
                  onClick={() => void restoreDoc(d)}
                >
                  Restore <span className="sr-only">{d.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
