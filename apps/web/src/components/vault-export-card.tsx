import { useId, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";

import { exportVault, type ExportVaultProgress, type ExportVaultTarget } from "@fiscode/backup";
import { downloadBlob, exportProgressLine } from "../lib/backup-view";
import { errorLine } from "../lib/documents-view";
import { useVaultReadOnly } from "../lib/vault-migration";
import { ReadOnlyNote } from "./read-only-note";
import { SectionTitle } from "./section-title";

type FolderDir = Extract<ExportVaultTarget, { kind: "folder" }>["dir"] & { name?: string };
type PickerWindow = Window & {
  showDirectoryPicker?: (o?: { mode: "readwrite" }) => Promise<FolderDir>;
};

type Run =
  | { at: "idle" }
  | { at: "running"; progress?: ExportVaultProgress }
  | { at: "cancelled"; progress?: ExportVaultProgress; folder: boolean }
  | { at: "failed"; message: string };

// By name: a picked folder and the signal may each carry their own DOMException class.
const isAbort = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";

/** "3 of 12 done", from the last step the export reported. */
const doneLine = (p: ExportVaultProgress | undefined) =>
  p ? `${Math.min(p.done, p.total)} of ${p.total} done` : "nothing done yet";

/**
 * Export vault (ADR 0001 § 9): the vault's files plus the CSV, unencrypted, as a zip or written
 * into a folder the user picks (where the browser has a folder picker).
 */
export function VaultExportCard() {
  const titleId = useId();
  const [run, setRun] = useState<Run>({ at: "idle" });
  const abort = useRef<AbortController | null>(null);
  const readOnly = useVaultReadOnly("export");
  const picker = (window as PickerWindow).showDirectoryPicker;
  const busy = run.at === "running";

  const start = async (target: ExportVaultTarget, folderName?: string) => {
    const controller = new AbortController();
    abort.current = controller;
    let last: ExportVaultProgress | undefined;
    setRun({ at: "running" });
    try {
      const out = await exportVault({
        target,
        signal: controller.signal,
        onProgress: (p) => {
          last = p;
          setRun({ at: "running", progress: p });
        },
      });
      setRun({ at: "idle" });
      if (out.kind === "zip") {
        downloadBlob(out.blob, out.fileName);
        toast.success(`Exported to ${out.fileName}.`);
      } else {
        toast.success(
          `Exported ${out.files} ${out.files === 1 ? "file" : "files"} to ${folderName ?? "the folder"}.`,
        );
      }
    } catch (err) {
      if (isAbort(err) && controller.signal.aborted) {
        setRun({ at: "cancelled", progress: last, folder: target.kind === "folder" });
      } else {
        setRun({ at: "failed", message: errorLine(err) });
      }
    } finally {
      abort.current = null;
    }
  };

  const toFolder = async () => {
    if (!picker) return;
    let dir: FolderDir;
    try {
      dir = await picker.call(window, { mode: "readwrite" });
    } catch (err) {
      // Dismissing the picker isn't an error.
      if (!isAbort(err)) setRun({ at: "failed", message: errorLine(err) });
      return;
    }
    await start({ kind: "folder", dir }, dir.name);
  };

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>
          <SectionTitle>Export vault</SectionTitle>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          A readable folder of your files plus the CSV, to keep in Nextcloud or Drive. It isn't
          encrypted: for a copy only you can open, use Back up everything.
        </p>
        <ReadOnlyNote reason={readOnly} />
        <div className="flex flex-wrap gap-2">
          {picker ? (
            <>
              <Button disabled={busy || !!readOnly} onClick={() => void toFolder()}>
                Export to a folder
              </Button>
              <Button
                variant="outline"
                disabled={busy || !!readOnly}
                onClick={() => void start({ kind: "zip" })}
              >
                Download as zip
              </Button>
            </>
          ) : (
            <Button disabled={busy || !!readOnly} onClick={() => void start({ kind: "zip" })}>
              Download vault as zip
            </Button>
          )}
        </div>
        {run.at === "running" ? (
          <div className="grid gap-2">
            <ExportProgress progress={run.progress} />
            <div>
              <Button variant="outline" size="sm" onClick={() => abort.current?.abort()}>
                Cancel export
              </Button>
            </div>
          </div>
        ) : null}
        {run.at === "cancelled" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Export cancelled: {doneLine(run.progress)}.
            {run.folder
              ? " The files already written stay in the folder, with no fiscode.json, so it isn't a complete export."
              : null}
          </p>
        ) : null}
        {run.at === "failed" ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>The vault wasn't exported</AlertTitle>
            <AlertDescription>{run.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExportProgress({ progress }: { progress: ExportVaultProgress | undefined }) {
  const line = progress ? exportProgressLine(progress) : "Starting";
  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="grid gap-1.5" role="status">
      <p className="text-sm">{line}…</p>
      <div
        role="progressbar"
        aria-label={line}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
