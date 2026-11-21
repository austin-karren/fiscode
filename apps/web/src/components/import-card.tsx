import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { RadioGroup, RadioGroupItem } from "@fiscode/ui/components/radio-group";
import { Label } from "@fiscode/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fiscode/ui/components/dialog";
import { useRouter } from "@tanstack/react-router";
import {
  applyImport,
  describeImportErrors,
  planImport,
  readImportFile,
  type Bundle,
  type ImportFile,
  type ImportMode,
  type ImportPlan,
} from "@fiscode/csv";
import { buildBundle, importBundle } from "@fiscode/db";
import { CircleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { SectionTitle } from "./section-title";

type ReadableFile = Extract<ImportFile, { ok: true }>;
type RefusedFile = Extract<ImportFile, { ok: false }>;

/** How many rejected rows are listed before the rest become a count. */
const ERROR_LIMIT = 10;

const MODES: readonly ImportMode[] = ["restore", "append", "update"];

// One name per action, used on the option, the button and the toast.
const MODE_LABELS: Record<ImportMode, string> = {
  restore: "Restore",
  append: "Add rows",
  update: "Update rows",
};

const MODE_DESCRIPTIONS: Record<ImportMode, string> = {
  restore: "Replace everything here with this file. Use this for a backup.",
  append: "Keep everything here and add the file's rows that are not here yet.",
  update:
    "Take the file's values for rows already here and add its new rows. Nothing is removed. Use this for an amended file from your accountant.",
};

const BUSY_LABELS: Record<ImportMode, string> = {
  restore: "Restoring…",
  append: "Adding rows…",
  update: "Updating rows…",
};

const IMPORT_REASONS = {
  restore: "import-restore",
  append: "import-append",
  update: "import-update",
} as const satisfies Record<ImportMode, string>;

/** `3 rows`, `1 row`, `0 rows`. */
const n = (count: number, noun: string, plural = `${noun}s`): string =>
  `${count} ${count === 1 ? noun : plural}`;

const entries = (count: number): string => n(count, "history entry", "history entries");

/**
 * Import a fiscode CSV: pick the file first, then see what it holds and choose
 * what to do with it. `variant="setup"` is the same flow on the setup screen,
 * worded as restoring a backup into a new install.
 */
export function ImportCard({
  variant = "dashboard",
  onImported,
}: {
  variant?: "dashboard" | "setup";
  /** Called after a committed import, e.g. to leave the setup screen. */
  onImported?: () => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  // `seq` changes with every refusal, so each one is a new alert that is
  // scrolled to and focused, even when the same file is refused twice.
  const [refused, setRefused] = useState<{
    fileName: string;
    file: RefusedFile;
    seq: number;
  } | null>(null);
  // State alone cannot stop a second confirm fired before the first render.
  const committing = useRef(false);
  const [pending, setPending] = useState<{
    fileName: string;
    file: ReadableFile;
    existing: Bundle;
  } | null>(null);
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const onFile = async (picked: File | undefined) => {
    if (!picked) return;
    const file = readImportFile(await picked.text());
    if (!file.ok) {
      setRefused((prev) => ({ fileName: picked.name, file, seq: (prev?.seq ?? 0) + 1 }));
      return;
    }
    setRefused(null);
    // The whole state, deleted rows and history too: a deleted row is restored
    // as deleted, an added row must not collide with one, and the dialog
    // counts all three.
    const existing = await buildBundle({ includeDeleted: true, includeHistory: true });
    const restore = planImport(existing, file.bundle, "restore", file);
    const empty = restore.current.live + restore.current.deleted === 0;
    // An empty app has nothing to keep, so there is no question to ask. A
    // yearly file cannot be restored from: over data it is an accountant's
    // amended file, which is what Update rows is for. Otherwise the user
    // chooses: no mode is a safe guess for a file we know nothing more about.
    setMode(empty ? "restore" : restore.refusal ? "update" : null);
    setFailure(null);
    setPending({ fileName: picked.name, file, existing });
  };

  const plans = pending
    ? {
        restore: planImport(pending.existing, pending.file.bundle, "restore", pending.file),
        append: planImport(pending.existing, pending.file.bundle, "append", pending.file),
        update: planImport(pending.existing, pending.file.bundle, "update", pending.file),
      }
    : null;
  const empty = plans !== null && plans.restore.current.live + plans.restore.current.deleted === 0;
  const plan = plans && mode ? plans[mode] : null;

  const close = () => {
    if (busy) return; // the import is committing; it cannot be abandoned half way
    setPending(null);
    setFailure(null);
  };

  const confirm = async () => {
    if (!pending || !plan || plan.refusal || committing.current) return;
    committing.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const applied = applyImport(pending.existing, pending.file.bundle, plan.mode, pending.file);
      // One transaction: this resolves only once every row is committed.
      await importBundle(applied.next, IMPORT_REASONS[plan.mode]);
      const added = plan.written.live + plan.written.deleted;
      toast.success(
        plan.mode === "restore"
          ? `Restored ${n(plan.written.live, "row")} from ${pending.fileName}.`
          : plan.mode === "update"
            ? `Updated ${n(plan.changed, "row")} and added ${n(added, "row")} from ${pending.fileName}.`
            : `Added ${n(added, "row")} from ${pending.fileName}.`,
      );
      setPending(null);
      await router.invalidate();
      onImported?.();
    } catch (err) {
      // Repeated ids and bad cells are refused when the file is read, so this
      // is an error nobody predicted. Show what the database said.
      console.error(err);
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      committing.current = false;
      setBusy(false);
    }
  };

  const setup = variant === "setup";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <SectionTitle>{setup ? "Restore from a backup" : "Import CSV"}</SectionTitle>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4">
          <p className="text-sm text-muted-foreground">
            {setup
              ? "Already use fiscode somewhere else? Choose the full backup CSV you downloaded there. It brings your profile with it, so you can skip the form above."
              : "Restore a full backup, or add rows from a fiscode CSV. You see what the file holds and choose what happens before anything changes."}
          </p>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            // The button below is the control. `hidden` keeps this one out of
            // the tab order and away from screen readers.
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              // Clear it so picking the same file again (after fixing it) fires.
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>
            <Upload />
            {setup ? "Choose a backup file" : "Choose a CSV file"}
          </Button>
          {refused ? (
            <Refusal key={refused.seq} fileName={refused.fileName} file={refused.file} />
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
          {pending && plans ? (
            <>
              <DialogHeader>
                <DialogTitle>{empty ? "Restore this backup?" : "Import this file?"}</DialogTitle>
                <DialogDescription>
                  <span className="font-medium text-foreground">{pending.fileName}</span> holds{" "}
                  {n(pending.file.counts.live, "row")},{" "}
                  {n(pending.file.counts.deleted, "deleted row")} and{" "}
                  {entries(pending.file.counts.history)}.
                  {pending.file.scope === "yearly"
                    ? ` It is a yearly file${pending.file.year === undefined ? "" : ` for ${pending.file.year}`}, not a full backup.`
                    : ""}
                </DialogDescription>
              </DialogHeader>

              {empty ? null : (
                <RadioGroup
                  value={mode ?? ""}
                  onValueChange={(v) => setMode(v as ImportMode)}
                  aria-label="What to do with this file"
                  className="grid gap-2"
                >
                  {MODES.map((m) => {
                    const refusal = plans[m].refusal;
                    return (
                      <Label
                        key={m}
                        htmlFor={`import-mode-${m}`}
                        className={`flex items-start gap-3 rounded-md border border-border p-3 text-sm font-normal ${
                          refusal ? "opacity-70" : "cursor-pointer hover:bg-muted/40"
                        }`}
                      >
                        {/* Named by its title; the description (or why it is off) is
                            its description, not part of the name (#52). */}
                        <RadioGroupItem
                          id={`import-mode-${m}`}
                          value={m}
                          disabled={refusal !== undefined || busy}
                          aria-labelledby={`import-mode-${m}-title`}
                          aria-describedby={`import-mode-${m}-hint`}
                          className="mt-0.5"
                        />
                        <span className="flex flex-col gap-1">
                          <span id={`import-mode-${m}-title`} className="font-medium">
                            {MODE_LABELS[m]}
                          </span>
                          <span id={`import-mode-${m}-hint`} className="text-muted-foreground">
                            {refusal ? refusalCopy(plans[m], pending.file) : MODE_DESCRIPTIONS[m]}
                          </span>
                        </span>
                      </Label>
                    );
                  })}
                </RadioGroup>
              )}

              {plan ? (
                <ul className="list-disc space-y-1.5 pl-5 text-sm" aria-label="What will happen">
                  {describePlan(plan, !pending.file.bundle.profile).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Choose one to see what it will do. Nothing changes until you confirm.
                </p>
              )}

              {plan ? <Warnings plan={plan} /> : null}

              {failure ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>The import failed. Nothing was changed.</AlertTitle>
                  <AlertDescription>
                    Your data is exactly as it was before. The reason given was: {failure}
                  </AlertDescription>
                </Alert>
              ) : null}

              <DialogFooter>
                <Button variant="outline" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  onClick={confirm}
                  disabled={busy || !plan || plan.refusal !== undefined || addsNothing(plan)}
                >
                  {busy && mode ? BUSY_LABELS[mode] : mode ? MODE_LABELS[mode] : "Choose an option"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Bring a new refusal to the user: on a short window it renders below the
 * fold, and picking a bad file would otherwise change nothing they can see.
 * Module-level so React calls it once per mounted alert, not on every render.
 */
const reveal = (alert: HTMLDivElement | null) => {
  if (!alert) return;
  alert.scrollIntoView?.({ block: "nearest" });
  alert.focus({ preventScroll: true });
};

/** A refused file, shown in the card until another file is picked. */
function Refusal({ fileName, file }: { fileName: string; file: RefusedFile }) {
  return (
    <Alert ref={reveal} tabIndex={-1} variant="destructive" className="w-full outline-none">
      <CircleAlert />
      <AlertTitle>{file.headline}</AlertTitle>
      <AlertDescription>
        <p>
          File: <span className="font-medium">{fileName}</span>. Your data is unchanged.
          {file.detail ? ` ${file.detail}` : ""}
        </p>
        {file.errors.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-left">
            {describeImportErrors(file.errors, ERROR_LIMIT).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** True for an Add or Update that would write no row and no history entry. */
const addsNothing = (plan: ImportPlan): boolean =>
  plan.mode !== "restore" &&
  plan.changed + plan.written.live + plan.written.deleted + plan.written.history === 0;

/**
 * What Add rows and Update rows would write that the app would not let you enter, and entity
 * periods that would overlap. Warnings, not refusals: the file is the user's or their
 * accountant's, the rows import as written, and Profile shows any overlap to fix.
 */
// Why Restore is off for a yearly file over data (the planner refuses it): short, with what would
// be lost and what to use instead. Any other refusal keeps the planner's own words.
function refusalCopy(plan: ImportPlan, file: ReadableFile): string {
  if (file.scope !== "yearly") return plan.refusal ?? "";
  const lost = plan.removed.live + plan.removed.deleted;
  const year = file.year === undefined ? "one year" : String(file.year);
  // One line in the card at 1440 (#52).
  return lost === 0
    ? `Not for a yearly file (${year} only): use Update rows.`
    : `Not for a yearly file: ${n(lost, "row")} would be lost. Use Update rows.`;
}

function Warnings({ plan }: { plan: ImportPlan }) {
  const { outOfRange, overlaps } = plan.warnings;
  if (outOfRange.count === 0 && overlaps.length === 0) return null;
  const more = outOfRange.count - outOfRange.rows.length;
  return (
    <div className="grid gap-2">
      {outOfRange.count > 0 ? (
        <Alert role="alert" aria-label={outOfRange.summary}>
          <CircleAlert />
          <AlertTitle>{outOfRange.summary}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4 text-left">
              {outOfRange.rows.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {more > 0 ? <li>And {n(more, "more row")}.</li> : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {overlaps.length > 0 ? (
        <Alert role="alert" aria-label="Entity periods would overlap">
          <CircleAlert />
          <AlertTitle>Entity periods would overlap</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4 text-left">
              {overlaps.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p>
              They import as the file has them. Fix the dates under Entity periods on your profile.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** What a mode will do, one checkable sentence per line. */
const describePlan = (plan: ImportPlan, fileHasNoProfile: boolean): string[] => {
  const { current, written, removed, skipped } = plan;
  const lines: string[] = [];
  const history =
    `History: ${entries(current.history)} here ${current.history === 1 ? "is" : "are"} kept` +
    `, ${written.history} from the file ${written.history === 1 ? "is" : "are"} added` +
    (plan.snapshot ? ", and 1 new entry records the state before this import." : ".");

  if (plan.mode === "append") {
    lines.push(
      addsNothing(plan)
        ? "Nothing would be added: every row in the file is already here."
        : `${n(written.live, "row")} will be added and show in the app.`,
    );
    if (written.deleted > 0) {
      lines.push(
        `${n(written.deleted, "deleted row")} will be added as deleted. ${written.deleted === 1 ? "It stays" : "They stay"} hidden.`,
      );
    }
    if (skipped > 0) {
      lines.push(
        `${n(skipped, "row")} in the file ${skipped === 1 ? "is" : "are"} already here and will be skipped. The ${skipped === 1 ? "row" : "rows"} here ${skipped === 1 ? "stays as it is" : "stay as they are"}, so changes made to ${skipped === 1 ? "it" : "them"} in the file are not applied.`,
      );
    }
    if (addsNothing(plan)) return lines;
    lines.push(
      `Nothing here is removed: ${n(current.live, "row")} and ${n(current.deleted, "deleted row")} stay.`,
    );
    lines.push(history);
    return lines;
  }

  if (plan.mode === "update") {
    if (addsNothing(plan)) {
      return ["Nothing would change: every row in the file is already here with the same values."];
    }
    const one = (k: number) => k === 1;
    lines.push(`${n(plan.changed, "row")} here will take the file's values.`);
    lines.push(`${n(written.live, "row")} will be added and show in the app.`);
    if (written.deleted > 0) {
      lines.push(
        `${n(written.deleted, "deleted row")} will be added as deleted. ${one(written.deleted) ? "It stays" : "They stay"} hidden.`,
      );
    }
    if (plan.unchanged > 0) {
      lines.push(
        `${n(plan.unchanged, "row")} in the file ${one(plan.unchanged) ? "is the same as here and stays as it is" : "are the same as here and stay as they are"}.`,
      );
    }
    if (plan.keptDeleted > 0) {
      lines.push(
        `${n(plan.keptDeleted, "row")} deleted here ${one(plan.keptDeleted) ? "is" : "are"} in the file. ${one(plan.keptDeleted) ? "It stays" : "They stay"} deleted.`,
      );
    }
    if (plan.keptLive > 0) {
      lines.push(
        `${n(plan.keptLive, "row")} the file marks deleted ${one(plan.keptLive) ? "is" : "are"} live here. ${one(plan.keptLive) ? "It stays as it is" : "They stay as they are"}: Update rows never removes a row.`,
      );
    }
    lines.push(
      `Nothing here is removed: ${n(current.live, "row")} and ${n(current.deleted, "deleted row")} stay.`,
    );
    lines.push(history);
    return lines;
  }

  const emptyApp = current.live + current.deleted === 0;
  lines.push(`${n(written.live, "row")} will show in the app.`);
  if (written.deleted > 0) {
    lines.push(
      `${n(written.deleted, "deleted row")} will be restored as deleted. ${written.deleted === 1 ? "It stays hidden and is" : "They stay hidden and are"} not part of your books.`,
    );
  }
  if (emptyApp) {
    lines.push("The app is empty, so nothing is replaced.");
  } else {
    lines.push(
      `Everything here now is replaced: ${n(current.live, "row")} and ${n(current.deleted, "deleted row")}.`,
    );
    const lost = removed.live + removed.deleted;
    lines.push(
      lost === 0
        ? "Every row here is also in the file, so no row is lost."
        : `${n(lost, "row")} here ${lost === 1 ? "is" : "are"} not in the file and will be gone (${removed.live} visible, ${removed.deleted} deleted).`,
    );
  }
  if (emptyApp && current.history === 0) {
    if (written.history > 0) lines.push(`${entries(written.history)} will be restored.`);
  } else {
    lines.push(history);
  }
  if (fileHasNoProfile) {
    lines.push("The file has no profile row, so you will fill in the setup form afterwards.");
  }
  return lines;
};
