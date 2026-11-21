import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fiscode/ui/components/dialog";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  createBackup,
  isAge,
  MIN_PASSPHRASE_LENGTH,
  planBackupRestore,
  readBackup,
  restoreBackup,
  type BackupFile,
  type BackupProgress,
} from "@fiscode/backup";
import { BackupFileCorruptError, BackupPassphraseError } from "@fiscode/core";
import { buildBundle } from "@fiscode/db";
import { downloadBlob, passphraseStrength, progressLine } from "../lib/backup-view";
import { errorLine, formatBytes } from "../lib/documents-view";
import { formatDateTime } from "../lib/format-date";
import { describePlan, Refusal } from "./import-card";
import { SectionTitle } from "./section-title";

/** The id of the card, so "restore a backup" elsewhere can link to it. */
export const BACKUP_CARD_ID = "backup";

/**
 * Back up everything (rows, history and document files, encrypted with a passphrase) and restore
 * from such a backup. `variant="setup"` offers restore only, into an empty profile, without a
 * confirm step.
 */
export function BackupCard({
  variant = "dashboard",
  onRestored,
}: {
  variant?: "dashboard" | "setup";
  onRestored?: () => void;
}) {
  const [dialog, setDialog] = useState<"backup" | "restore" | null>(null);
  const close = (open: boolean) => !open && setDialog(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  // Arriving by a "restore a backup" link (#backup): focus lands on Restore, not the page body.
  useEffect(() => {
    if (window.location.hash === `#${BACKUP_CARD_ID}`) restoreButton.current?.focus();
  }, []);
  return (
    <Card id={BACKUP_CARD_ID} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>
          <SectionTitle>
            {variant === "setup" ? "Restore an encrypted backup" : "Encrypted backup"}
          </SectionTitle>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {variant === "setup"
            ? "An encrypted backup (.zip.age) from Back up everything brings back every row, your history and your document files."
            : "One encrypted file (.zip.age) with every row, your history and your document files. Restore it here or on another device."}
        </p>
        <div className="flex flex-wrap gap-2">
          {variant === "dashboard" ? (
            <Button onClick={() => setDialog("backup")}>Back up everything</Button>
          ) : null}
          <Button
            ref={restoreButton}
            variant={variant === "dashboard" ? "outline" : "default"}
            onClick={() => setDialog("restore")}
          >
            Restore from backup
          </Button>
        </div>
      </CardContent>
      <Dialog open={dialog === "backup"} onOpenChange={close}>
        <DialogContent className="sm:max-w-md">
          {/* Mounted only while open: the passphrase leaves memory when the dialog closes. */}
          {dialog === "backup" ? <BackupBody onDone={() => setDialog(null)} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "restore"} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          {dialog === "restore" ? (
            <RestoreBody
              confirm={variant === "dashboard"}
              onDone={() => {
                setDialog(null);
                onRestored?.();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Progress({ progress }: { progress: BackupProgress }) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="grid gap-1.5" role="status">
      <p className="text-sm">{progressLine(progress)}…</p>
      <div
        role="progressbar"
        aria-label={progressLine(progress)}
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

// ─── Back up ──────────────────────────────────────────────────────────────────

function BackupBody({ onDone }: { onDone: () => void }) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [errors, setErrors] = useState<{ first?: string; second?: string }>({});
  const [progress, setProgress] = useState<BackupProgress>();
  const [failure, setFailure] = useState<string>();
  const id = useId();
  const strength = passphraseStrength(first, MIN_PASSPHRASE_LENGTH);

  const checkFirst = (v = first) =>
    v.length < MIN_PASSPHRASE_LENGTH
      ? `Use at least ${MIN_PASSPHRASE_LENGTH} characters (${v.length} so far).`
      : undefined;
  const checkSecond = (v = second) =>
    v === ""
      ? "Enter the passphrase again."
      : v !== first
        ? "The two passphrases don't match."
        : undefined;

  const submit = async () => {
    const next = { first: checkFirst(), second: checkSecond() };
    setErrors(next);
    if (next.first || next.second) {
      document.getElementById(next.first ? `${id}-first` : `${id}-second`)?.focus();
      return;
    }
    setFailure(undefined);
    try {
      const { blob, fileName, manifest } = await createBackup({
        passphrase: first,
        onProgress: setProgress,
      });
      downloadBlob(blob, fileName);
      const without = new Set(manifest.missing.flatMap((m) => m.documentIds)).size;
      toast.success(`Backed up to ${fileName}.`, {
        description:
          without > 0
            ? `${without} ${without === 1 ? "document has" : "documents have"} no file on this device and ${without === 1 ? "is" : "are"} backed up without it.`
            : undefined,
      });
      onDone();
    } catch (err) {
      setProgress(undefined);
      setFailure(errorLine(err));
    }
  };

  const busy = progress !== undefined;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>Back up everything</DialogTitle>
        <DialogDescription>
          The backup is encrypted with a passphrase you choose. Nobody can recover a forgotten
          passphrase, not even fiscode: without it, the backup can't be opened.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={`${id}-first`}>Passphrase</Label>
          <span
            id={`${id}-strength`}
            className={`text-xs ${strength.score >= 2 ? "text-foreground" : "text-muted-foreground"}`}
          >
            Strength: {strength.label}
          </span>
        </div>
        <Input
          id={`${id}-first`}
          type="password"
          autoComplete="new-password"
          value={first}
          disabled={busy}
          aria-invalid={errors.first ? true : undefined}
          aria-describedby={`${id}-strength ${id}-lost${errors.first ? ` ${id}-first-error` : ""}`}
          onChange={(e) => {
            setFirst(e.target.value);
            // A "too short" error goes once the value is long enough: it shouldn't sit beside
            // "Strong". Nothing new is flagged on change.
            if (errors.first && e.target.value.length >= MIN_PASSPHRASE_LENGTH)
              setErrors((x) => ({ ...x, first: undefined }));
          }}
          onBlur={() => setErrors((x) => ({ ...x, first: checkFirst() }))}
        />
        <p id={`${id}-lost`} className="text-xs text-muted-foreground">
          A lost passphrase loses the backup. A few unrelated words work well.
        </p>
        {errors.first ? (
          <p id={`${id}-first-error`} role="alert" className="text-sm text-destructive">
            {errors.first}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-second`}>Passphrase again</Label>
        <Input
          id={`${id}-second`}
          type="password"
          autoComplete="new-password"
          value={second}
          disabled={busy}
          aria-invalid={errors.second ? true : undefined}
          aria-describedby={errors.second ? `${id}-second-error` : undefined}
          onChange={(e) => setSecond(e.target.value)}
          onBlur={() => second && setErrors((x) => ({ ...x, second: checkSecond() }))}
        />
        {errors.second ? (
          <p id={`${id}-second-error`} role="alert" className="text-sm text-destructive">
            {errors.second}
          </p>
        ) : null}
      </div>
      {progress ? <Progress progress={progress} /> : null}
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy ? "Backing up…" : "Back up"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Restore ──────────────────────────────────────────────────────────────────

type Ready = Extract<BackupFile, { ok: true }>;
type Step =
  | { at: "pick"; problem?: string }
  | { at: "passphrase"; file: File; problem?: string }
  | { at: "refused"; fileName: string; file: Extract<BackupFile, { ok: false }> }
  | { at: "confirm"; fileName: string; ready: Ready; plan: ReturnType<typeof planBackupRestore> };

function RestoreBody({ confirm, onDone }: { confirm: boolean; onDone: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ at: "pick" });
  const [passphrase, setPassphrase] = useState("");
  const [progress, setProgress] = useState<BackupProgress>();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const busy = progress !== undefined;
  const passInput = useRef<HTMLInputElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const problemAlert = useRef<HTMLDivElement>(null);

  // After each async step, focus goes where the user acts next, never to the page body: the
  // passphrase (selected, to retype) after a wrong one, the alert after a refused file, and
  // Restore on the confirm step.
  useEffect(() => {
    if (step.at === "passphrase" && step.problem) {
      passInput.current?.focus();
      passInput.current?.select();
    } else if (step.at === "pick" && step.problem) problemAlert.current?.focus();
    else if (step.at === "confirm") restoreButton.current?.focus();
  }, [step]);

  const write = async (fileName: string, ready: Ready) => {
    try {
      await restoreBackup(ready, { onProgress: setProgress });
      await router.invalidate();
      const files = ready.documents.files;
      toast.success(
        `Restored ${fileName}${files > 0 ? `, with ${files} ${files === 1 ? "file" : "files"}` : ""}.`,
      );
      onDone();
    } catch (err) {
      setProgress(undefined);
      // StorageQuotaError and the rest: their own message. Nothing was changed.
      setStep({ at: "pick", problem: errorLine(err) });
    }
  };

  const read = async (file: File, pass?: string) => {
    try {
      const result = await readBackup(file, { passphrase: pass, onProgress: setProgress });
      setProgress(undefined);
      setPassphrase("");
      if (!result.ok) {
        setStep({ at: "refused", fileName: file.name, file: result });
        return;
      }
      if (!confirm) {
        await write(file.name, result);
        return;
      }
      const existing = await buildBundle({ includeDeleted: true, includeHistory: true });
      setStep({
        at: "confirm",
        fileName: file.name,
        ready: result,
        plan: planBackupRestore(result, existing),
      });
    } catch (err) {
      setProgress(undefined);
      if (err instanceof BackupPassphraseError) {
        // Wrong: ask again. Missing: the file is encrypted after all, so ask.
        setStep({ at: "passphrase", file, problem: err.message });
        return;
      }
      setPassphrase("");
      // A damaged file isn't the passphrase's fault: go back to choosing a file.
      setStep({
        at: "pick",
        problem:
          err instanceof BackupFileCorruptError && err.path === undefined
            ? `${err.message} Try another copy of the backup.`
            : errorLine(err),
      });
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (isAge(head)) setStep({ at: "passphrase", file });
    else void read(file);
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Restore from backup</DialogTitle>
        <DialogDescription>
          {step.at === "confirm"
            ? `From ${step.fileName}, made ${formatDateTime(step.ready.manifest.createdAt)}.`
            : "Choose a fiscode backup: a .zip.age file, or a .zip already decrypted."}
        </DialogDescription>
      </DialogHeader>

      {step.at === "pick" ? (
        <>
          <input
            ref={input}
            type="file"
            hidden
            accept=".age,.zip,application/zip,application/octet-stream"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {step.problem ? (
            <Alert ref={problemAlert} tabIndex={-1} variant="destructive" className="outline-none">
              <CircleAlert />
              <AlertTitle>This backup can't be restored</AlertTitle>
              <AlertDescription>{step.problem}</AlertDescription>
            </Alert>
          ) : null}
          {progress ? <Progress progress={progress} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
              Cancel
            </DialogClose>
            <Button type="button" disabled={busy} onClick={() => input.current?.click()}>
              Choose backup file
            </Button>
          </DialogFooter>
        </>
      ) : null}

      {step.at === "passphrase" ? (
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!passphrase) {
              setStep({ ...step, problem: "Enter the backup's passphrase." });
              return;
            }
            void read(step.file, passphrase);
          }}
        >
          <p className="text-sm">
            <span className="font-medium break-all">{step.file.name}</span> is encrypted.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-pass`}>Passphrase</Label>
            <Input
              ref={passInput}
              id={`${id}-pass`}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={passphrase}
              disabled={busy}
              aria-invalid={step.problem ? true : undefined}
              aria-describedby={step.problem ? `${id}-pass-error` : undefined}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            {step.problem ? (
              <p id={`${id}-pass-error`} role="alert" className="text-sm text-destructive">
                {step.problem}
              </p>
            ) : null}
          </div>
          {progress ? <Progress progress={progress} /> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPassphrase("");
                setStep({ at: "pick" });
              }}
            >
              Choose another file
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Opening…" : "Open backup"}
            </Button>
          </DialogFooter>
        </form>
      ) : null}

      {step.at === "refused" ? (
        <>
          <Refusal fileName={step.fileName} file={step.file} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Close</DialogClose>
            <Button type="button" onClick={() => setStep({ at: "pick" })}>
              Choose another file
            </Button>
          </DialogFooter>
        </>
      ) : null}

      {step.at === "confirm" ? (
        <>
          <ul className="grid list-disc gap-1 pl-4 text-sm">
            {describePlan(step.plan, !step.ready.bundle.profile, "restore").map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>
              {step.plan.documents.files === 0
                ? "No document files are in this backup."
                : `${step.plan.documents.files} document ${step.plan.documents.files === 1 ? "file" : "files"} (${formatBytes(step.plan.documents.bytes)}) will be written to this device.`}
            </li>
            {step.plan.snapshot ? <li>You can undo this restore from History.</li> : null}
          </ul>
          {step.ready.missing.length > 0 ? (
            <Alert>
              <CircleAlert />
              <AlertTitle>
                {step.ready.missing.length === 1
                  ? "1 file wasn't on the device that made this backup"
                  : `${step.ready.missing.length} files weren't on the device that made this backup`}
              </AlertTitle>
              <AlertDescription>
                <p>These documents come back without their file:</p>
                <ul className="list-disc pl-4">
                  {step.ready.missing
                    .flatMap((m) => m.names)
                    .map((name) => (
                      <li key={name} className="break-all">
                        {name}
                      </li>
                    ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {progress ? <Progress progress={progress} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
              Cancel
            </DialogClose>
            <Button
              ref={restoreButton}
              type="button"
              disabled={busy}
              onClick={() => void write(step.fileName, step.ready)}
            >
              {busy ? "Restoring…" : "Restore"}
            </Button>
          </DialogFooter>
        </>
      ) : null}
    </div>
  );
}
