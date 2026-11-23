import { useEffect, useId, useRef, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@fiscode/ui/components/dialog";
import { Badge } from "@fiscode/ui/components/badge";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@fiscode/ui/components/tabs";
import { toast } from "sonner";

import { ALLOWED_DOCUMENT_MIMES } from "@fiscode/core";
import { documentLinkRepo, documentRepo, folderRepo, sha256Hex } from "@fiscode/db";
import type { DocumentFolderRow, DocumentRow } from "@fiscode/csv";
import { errorLine, fileKind, folderPath } from "../../lib/documents-view";
import { uploadFiles } from "../../lib/documents-upload";
import { folderForRecord, type LinkableRecordType } from "../../lib/documents-links";

// The most documents "Choose existing" lists at once; a search narrows the rest.
const SHOWN = 50;

/**
 * A row's Attach action: a button with the row's document count, opening a dialog that uploads
 * files into `<year>/<Expenses|Income|Mileage>` or picks documents already added. Every attach
 * links the document to this row.
 */
export function AttachDialog({
  recordType,
  recordId,
  recordDate,
  recordLabel,
  count,
  onChanged,
}: {
  recordType: LinkableRecordType;
  recordId: string;
  recordDate: string;
  /** Names the row for screen readers ("Mar 16, 2026 · $129.99"). */
  recordLabel: string;
  count: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="sm" />}
        aria-label={`Attach to ${recordLabel}${count > 0 ? `, ${count} attached` : ""}`}
      >
        Attach
        {count > 0 ? (
          <Badge variant="secondary" className="tabular-nums" aria-hidden>
            {count}
          </Badge>
        ) : null}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach documents</DialogTitle>
          <DialogDescription>
            {recordLabel.charAt(0).toUpperCase() + recordLabel.slice(1)}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <AttachBody
            recordType={recordType}
            recordId={recordId}
            recordDate={recordDate}
            onChanged={onChanged}
          />
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachBody({
  recordType,
  recordId,
  recordDate,
  onChanged,
}: {
  recordType: LinkableRecordType;
  recordId: string;
  recordDate: string;
  onChanged: () => void;
}) {
  const [target, setTarget] = useState<{ id: string | null; path: string }>();
  const [lines, setLines] = useState<{ ok: boolean; line: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [folders, setFolders] = useState<DocumentFolderRow[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const id = useId();

  // What the dialog reads when it opens: the upload folder, the folders for paths, and what this
  // row already has attached (a subscription to outside state, dropped when the dialog closes).
  useEffect(() => {
    let live = true;
    void folderForRecord(recordType, recordDate).then((t) => live && setTarget(t));
    void folderRepo.list().then((f) => live && setFolders(f));
    void documentLinkRepo
      .forRecord(recordType, recordId)
      .then((l) => live && setLinked(new Set(l.map((x) => x.documentId))));
    return () => {
      live = false;
    };
  }, [recordType, recordId, recordDate]);

  // The documents to choose from: all of them newest first, or a search's matches.
  useEffect(() => {
    let live = true;
    const q = query.trim();
    void (q ? documentRepo.search(q) : documentRepo.list()).then(
      (rows) =>
        live &&
        setDocs(
          rows
            .filter((d) => d.deletedAt === null)
            .toSorted((a, b) => b.addedAt.localeCompare(a.addedAt)),
        ),
    );
    return () => {
      live = false;
    };
  }, [query]);

  const link = async (doc: DocumentRow): Promise<string | undefined> => {
    try {
      await documentLinkRepo.link(doc.id, recordType, recordId);
      setLinked((s) => new Set(s).add(doc.id));
      return undefined;
    } catch (err) {
      return errorLine(err);
    }
  };

  const upload = async (files: File[]) => {
    if (files.length === 0 || !target) return;
    setBusy(true);
    try {
      const all = await documentRepo.list();
      // Live documents by their bytes: a file already stored is linked, not added again.
      const stored = new Map<string, DocumentRow>(
        all.filter((d) => d.deletedAt === null).map((d) => [d.sha256, d]),
      );
      const pathOf = (f: string | null) => (f === target.id ? target.path : folderPath(folders, f));
      const out: { ok: boolean; line: string }[] = [];
      // This row's links, kept up to date through the batch (state updates land after it).
      const attached = new Set(linked);
      let changed = false;
      for (const file of files) {
        const same = stored.get(await sha256Hex(file));
        if (same) {
          const as = same.name === file.name ? "" : ` as ${same.name}`;
          if (attached.has(same.id)) {
            out.push({ ok: true, line: `${file.name}: already attached to this row${as}.` });
            continue;
          }
          const problem = await link(same);
          if (problem) out.push({ ok: false, line: `${file.name} isn't attached. ${problem}` });
          else {
            changed = true;
            attached.add(same.id);
            out.push({
              ok: true,
              line: `${file.name}: Already in Documents, linked${as} (${pathOf(same.folderId)}).`,
            });
          }
          continue;
        }
        // One file at a time, so each keeps its own line and a later copy in the same batch
        // finds this one.
        const [r] = await uploadFiles([file], target.id, all, pathOf);
        if (!r || !r.ok || !r.doc) {
          out.push({ ok: false, line: r?.line ?? `${file.name} wasn't added.` });
          continue;
        }
        stored.set(r.doc.sha256, r.doc);
        const problem = await link(r.doc);
        if (problem) out.push({ ok: false, line: `${r.line} It isn't attached. ${problem}` });
        else {
          changed = true;
          attached.add(r.doc.id);
          out.push({ ok: true, line: `${r.line.replace(/\.$/, "")} and attached it.` });
        }
      }
      setLines(out);
      // A refused link may mean the row is gone: then refreshing unmounts this dialog and its
      // lines, so the refusals also go to a toast, and only a real attach refreshes.
      for (const l of out) if (!l.ok) toast.error(l.line);
      if (changed) onChanged();
    } finally {
      setBusy(false);
    }
  };

  const choose = async (doc: DocumentRow) => {
    const problem = await link(doc);
    if (problem) toast.error(problem);
    else {
      toast.success(`Attached ${doc.name}.`);
      // The button became "Attached": focus goes back to the search, not the dialog.
      searchBox.current?.focus();
      onChanged();
    }
  };

  const shown = docs.slice(0, SHOWN);

  return (
    <Tabs defaultValue="upload" className="min-w-0">
      <TabsList>
        <TabsTrigger value="upload">Upload</TabsTrigger>
        <TabsTrigger value="choose">Choose existing</TabsTrigger>
      </TabsList>

      <TabsContent value="upload" className="grid gap-3 pt-2">
        <p className="text-sm text-muted-foreground">
          Files go into {target ? <span className="text-foreground">{target.path}</span> : "…"}.
          PDF, image or text, up to 25 MB each.
        </p>
        <div>
          <Button type="button" disabled={!target || busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : "Choose files"}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={ALLOWED_DOCUMENT_MIMES.join(",")}
            onChange={(e) => {
              void upload([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        <ul role="status" className="grid gap-1 text-sm">
          {lines.map((l, i) => (
            <li key={i} className={l.ok ? "" : "text-destructive"}>
              {l.line}
            </li>
          ))}
        </ul>
      </TabsContent>

      <TabsContent value="choose" className="grid min-w-0 gap-3 pt-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-q`}>Search documents</Label>
          <Input
            ref={searchBox}
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or notes"
          />
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query.trim() ? `No documents match "${query.trim()}".` : "No documents yet."}
          </p>
        ) : (
          <ul
            aria-label="Documents"
            className="grid max-h-[min(18rem,max(6rem,calc(100dvh-24rem)))] gap-1 overflow-y-auto"
          >
            {shown.map((d) => (
              <li
                key={d.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{d.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {fileKind(d.mime)} · {folderPath(folders, d.folderId)}
                  </span>
                </span>
                {linked.has(d.id) ? (
                  <span className="shrink-0 text-xs text-muted-foreground">Attached</span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void choose(d)}
                  >
                    Attach <span className="sr-only">{d.name}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* Always mounted, so a screen reader hears the count when a search changes it. */}
        <p role="status" className="text-xs text-muted-foreground empty:hidden">
          {docs.length > SHOWN
            ? `Showing ${SHOWN} of ${docs.length}. Search to find the rest.`
            : ""}
        </p>
      </TabsContent>
    </Tabs>
  );
}
