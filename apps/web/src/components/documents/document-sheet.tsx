import { useEffect, useId, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@fiscode/ui/components/sheet";
import { Button } from "@fiscode/ui/components/button";
import { Label } from "@fiscode/ui/components/label";
import { Textarea } from "@fiscode/ui/components/textarea";
import { toast } from "sonner";

import { DocumentBytesMissingError } from "@fiscode/core";
import { documentLinkRepo, documentRepo } from "@fiscode/db";
import type { DocumentRow } from "@fiscode/csv";
import { errorLine, fileKind, formatBytes } from "../../lib/documents-view";
import { formatDate, formatDateTime } from "../../lib/format-date";

type Versions = Awaited<ReturnType<typeof documentRepo.versions>>;
type Links = Awaited<ReturnType<typeof documentLinkRepo.forDocument>>;

// The document side sheet (?doc=<id>): a preview, download, replace, its versions, notes, and the
// rows it is linked to. Full screen on a phone. Every object URL it makes is revoked.
export function DocumentSheet({
  doc,
  folderPath,
  onClose,
  onChanged,
}: {
  doc: DocumentRow | undefined;
  folderPath: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Sheet open={doc !== undefined} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto data-[side=right]:w-full sm:data-[side=right]:max-w-xl"
      >
        {doc ? (
          <SheetBody
            key={`${doc.id}:${doc.sha256}`}
            doc={doc}
            folderPath={folderPath}
            onChanged={onChanged}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  doc,
  folderPath,
  onChanged,
}: {
  doc: DocumentRow;
  folderPath: string;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState<string>();
  const [missing, setMissing] = useState(false);
  const [versions, setVersions] = useState<Versions>([]);
  const [links, setLinks] = useState<Links>([]);
  const [notes, setNotes] = useState(doc.notes ?? "");
  const [heicFailed, setHeicFailed] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const id = useId();

  // Loads this version's bytes as an object URL, and revokes it when the sheet moves on
  // (another document, a replaced file, or closed): a subscription to outside state.
  useEffect(() => {
    let made: string | undefined;
    let live = true;
    documentRepo
      .objectUrl(doc.id)
      .then((u) => {
        made = u;
        if (live) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch((err) => {
        if (err instanceof DocumentBytesMissingError && live) setMissing(true);
      });
    // Newest first, whatever order the repo returns (it gives oldest first): the top one is current.
    void documentRepo
      .versions(doc.id)
      .then((v) => live && setVersions(v.toSorted((a, b) => b.at.localeCompare(a.at))));
    void documentLinkRepo.forDocument(doc.id).then((l) => live && setLinks(l));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [doc.id]);

  const replace = async (file: File | undefined) => {
    if (!file) return;
    try {
      await documentRepo.replaceBytes(doc.id, file);
      // The name keeps the user's wording but takes the new file's extension (a PNG replacing a
      // PDF is no longer ".pdf").
      const ext = (n: string) => (n.includes(".") ? n.slice(n.lastIndexOf(".")) : "");
      if (ext(file.name) && ext(file.name).toLowerCase() !== ext(doc.name).toLowerCase()) {
        const base = ext(doc.name) ? doc.name.slice(0, -ext(doc.name).length) : doc.name;
        await documentRepo.rename(doc.id, `${base}${ext(file.name)}`);
      }
      toast.success(`Replaced ${doc.name}.`);
      onChanged();
    } catch (err) {
      toast.error(errorLine(err));
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle className="break-all">{doc.name}</SheetTitle>
        <SheetDescription>
          {fileKind(doc.mime)} · {formatBytes(doc.sizeBytes)} · added{" "}
          {formatDate(new Date(doc.addedAt))} · {folderPath}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-4 px-4 pb-4">
        <section aria-label="Preview" className="rounded-md border border-border bg-muted/30">
          {missing ? (
            <div role="status" className="grid gap-1 p-4 text-sm">
              <p>File not on this device — restore a backup</p>
              {/* A CSV restore brings rows, not files: the file itself can come back by hand. */}
              <p className="text-muted-foreground">Or add the file again with Replace file.</p>
            </div>
          ) : !url ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : doc.mime === "application/pdf" ? (
            <iframe title={`Preview of ${doc.name}`} src={url} className="h-[60vh] w-full" />
          ) : doc.mime.startsWith("image/") && !heicFailed ? (
            <img
              src={url}
              alt={`Preview of ${doc.name}`}
              className="mx-auto max-h-[60vh] object-contain"
              onError={() => setHeicFailed(true)}
            />
          ) : doc.mime === "text/plain" ? (
            <iframe
              title={`Preview of ${doc.name}`}
              src={url}
              className="h-[40vh] w-full bg-background"
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              This browser can't show a preview of this file. Download it to open it.
            </p>
          )}
        </section>

        <div className="flex flex-wrap gap-2">
          {url ? (
            <Button render={<a href={url} download={doc.name} />} variant="outline">
              Download
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => replaceInput.current?.click()}>
            Replace file
          </Button>
          <input
            ref={replaceInput}
            type="file"
            hidden
            onChange={(e) => {
              void replace(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-notes`}>Notes</Label>
          <Textarea
            id={`${id}-notes`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={async () => {
              if (notes === (doc.notes ?? "")) return;
              await documentRepo.update(doc.id, { notes: notes.trim() || null });
              toast.success("Notes saved.");
              onChanged();
            }}
          />
        </div>

        <section aria-labelledby={`${id}-links`} className="grid gap-1">
          <h3
            id={`${id}-links`}
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            Linked rows
          </h3>
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not linked to any row yet.</p>
          ) : (
            <ul className="text-sm">
              {links.map((l) => (
                <li key={l.id}>{l.record.label}</li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby={`${id}-versions`} className="grid gap-1">
          <h3
            id={`${id}-versions`}
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            Versions
          </h3>
          <ul className="text-sm">
            {versions.map((v, i) => (
              <li key={`${v.sha256}-${v.at}`} className="flex justify-between gap-2">
                <span>
                  {i === 0 ? "Current" : "Earlier"} · {formatDateTime(v.at)}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {formatBytes(v.sizeBytes)}
                  {v.available ? "" : " · not on this device"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
