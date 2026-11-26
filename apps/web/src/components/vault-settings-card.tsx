import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  OperationCancelledError,
  VaultMigratingError,
  VaultMigrationIncompleteError,
} from "@fiscode/core";
import {
  canPickFolder,
  type PickedDirHandle,
  onVaultChange,
  pendingVaultSwitch,
  pickedFolderName,
  switchVaultToFolder,
  switchVaultToOpfs,
} from "@fiscode/db";

import { vaultSwitchLine } from "../lib/vault-settings";
import { useVaultMigration } from "../lib/vault-migration";
import { ReadOnlyNote } from "./read-only-note";
import { SectionTitle } from "./section-title";

type Picker = (options?: { mode: "readwrite" }) => Promise<PickedDirHandle>;
type Pending = { to: "folder" | "opfs"; done: number };

type Run =
  | { at: "idle" }
  | { at: "running"; done: number; total: number }
  | { at: "cancelled" }
  | { at: "failed"; message: string };

const isAbort = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";

const NO_PICKER =
  "Your files are kept in this browser. Use Export vault or Backup to get them out.";

/**
 * Vault settings (ADR 0001 § 11.1-2): where files are kept, pick a folder, switch back, resume.
 */
export function VaultSettingsCard() {
  const titleId = useId();
  const [pending, setPending] = useState<Pending>();
  const [known, setKnown] = useState(false);
  const [folder, setFolder] = useState<string | undefined>();
  const [run, setRun] = useState<Run>({ at: "idle" });
  const abort = useRef<AbortController | null>(null);
  const migration = useVaultMigration();
  const blocked =
    migration.phase === "migrating"
      ? new VaultMigratingError().message
      : migration.phase === "migration-incomplete"
        ? new VaultMigrationIncompleteError().message
        : undefined;
  const picker = canPickFolder();
  const busy = run.at === "running";

  useEffect(() => {
    let live = true;
    const load = () => {
      void pendingVaultSwitch().then((next) => {
        if (!live) return;
        setPending(next);
        setFolder(pickedFolderName());
        setKnown(true);
      });
    };
    load();
    const off = onVaultChange(load);
    return () => {
      live = false;
      off();
    };
  }, []);

  const runSwitch = async (
    go: (options: {
      onProgress: (p: { phase: "copying"; done: number; total: number }) => void;
      signal: AbortSignal;
    }) => Promise<void>,
    landed: string,
  ) => {
    const controller = new AbortController();
    abort.current = controller;
    setRun({ at: "running", done: 0, total: 0 });
    try {
      await go({
        signal: controller.signal,
        onProgress: (p) => setRun({ at: "running", done: p.done, total: p.total }),
      });
      setRun({ at: "idle" });
      setPending(undefined);
      setFolder(pickedFolderName());
      toast.success(`Your files are now in ${landed}.`);
    } catch (err) {
      if (err instanceof OperationCancelledError) {
        setRun({ at: "cancelled" });
      } else {
        setRun({ at: "failed", message: vaultSwitchLine(err) });
      }
    } finally {
      abort.current = null;
      setPending(await pendingVaultSwitch());
    }
  };

  const pick = async (then: (handle: PickedDirHandle) => Promise<void>) => {
    const show = (window as Window & { showDirectoryPicker?: Picker }).showDirectoryPicker;
    if (!show) return;
    let handle: PickedDirHandle;
    try {
      handle = await show.call(window, { mode: "readwrite" });
    } catch (err) {
      if (!isAbort(err)) setRun({ at: "failed", message: vaultSwitchLine(err) });
      return;
    }
    await then(handle);
  };

  const held = busy || !!blocked || !known;

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>
          <SectionTitle>Vault</SectionTitle>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          Files are kept <span className="font-medium">{folder ?? "in this browser"}</span>
        </p>
        {!picker && !folder ? <p className="text-sm text-muted-foreground">{NO_PICKER}</p> : null}
        <ReadOnlyNote reason={blocked} />
        {pending && !busy ? (
          <p className="text-sm text-muted-foreground">
            A switch didn't finish
            {pending.done > 0 ? ` (${pending.done} files already copied)` : ""}.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <Button
              disabled={held}
              onClick={() => {
                if (pending.to === "opfs") {
                  void runSwitch(switchVaultToOpfs, "this browser");
                  return;
                }
                void pick((handle) =>
                  runSwitch((options) => switchVaultToFolder(handle, options), handle.name),
                );
              }}
            >
              Resume switch
            </Button>
          ) : folder ? (
            <Button
              variant="outline"
              disabled={held}
              onClick={() => void runSwitch(switchVaultToOpfs, "this browser")}
            >
              Switch back to this browser
            </Button>
          ) : picker ? (
            <Button
              disabled={held}
              onClick={() =>
                void pick((handle) =>
                  runSwitch((options) => switchVaultToFolder(handle, options), handle.name),
                )
              }
            >
              Pick folder
            </Button>
          ) : null}
        </div>
        {run.at === "running" ? (
          <div className="grid gap-2">
            <div className="grid gap-1.5" role="status">
              <p className="text-sm">
                {run.total > 0 ? `Copying files: ${run.done} of ${run.total}` : "Copying files…"}
              </p>
              <progress
                className="h-1.5 w-full accent-primary"
                max={Math.max(run.total, 1)}
                value={run.done}
                aria-label="Files copied"
              />
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => abort.current?.abort()}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {run.at === "cancelled" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Nothing changed.
          </p>
        ) : null}
        {run.at === "failed" ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>The vault wasn't moved</AlertTitle>
            <AlertDescription>{run.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
