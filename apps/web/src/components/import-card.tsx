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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@fiscode/ui/components/empty";
import { useRouter } from "@tanstack/react-router";
import {
  applyImport,
  parseCsv,
  type ImportMode,
  type AppliedImport,
  type Bundle,
} from "@fiscode/csv";
import { buildBundle, importBundle, type ImportReason } from "@fiscode/db";
import { useState } from "react";
import { toast } from "sonner";

const MODE_LABELS: Record<ImportMode, string> = {
  append: "Append (default)",
  overwrite: "Overwrite",
  restore: "Restore",
};

const MODE_DESCRIPTIONS: Record<ImportMode, string> = {
  append: "Add rows from the CSV that don't already exist. Colliding ids keep the existing row.",
  overwrite:
    "Replace all local state with the CSV's contents. The prior state is captured in history.",
  restore: "Same as overwrite, framed as restoring from a backup. Prior state captured in history.",
};

const reasonFromMode = (mode: ImportMode): ImportReason => {
  if (mode === "overwrite") return "import-overwrite";
  if (mode === "restore") return "import-restore";
  return "import-append";
};

export function ImportCard() {
  const router = useRouter();
  const [mode, setMode] = useState<ImportMode>("append");
  const [pending, setPending] = useState<{
    file: File;
    applied: AppliedImport;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const { bundle, validationErrors } = parseCsv(text);
    if (validationErrors.length > 0) {
      toast.error(`${validationErrors.length} row(s) failed validation.`);
      console.error(validationErrors);
      return;
    }
    const existing = await buildBundle();
    const applied = applyImport(existing, bundle, mode);
    setPending({ file, applied });
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await importBundle(pending.applied.next, reasonFromMode(mode));
      toast.success(`Imported. ${pending.applied.conflicts.length} conflict(s).`);
      setPending(null);
      router.invalidate();
    } catch (err) {
      console.error(err);
      toast.error("Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
            Import CSV
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Best workflow: export to get the column layout, edit in your editor, re-import. The
            importer strips the <code>#</code> provenance header.
          </p>
          <div>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as ImportMode)}
              className="grid gap-2"
            >
              {(["append", "overwrite", "restore"] as ImportMode[]).map((m) => (
                <Label
                  key={m}
                  htmlFor={`mode-${m}`}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm font-normal hover:bg-muted/40"
                >
                  <RadioGroupItem id={`mode-${m}`} value={m} className="mt-0.5" />
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">{MODE_LABELS[m]}</span>
                    <span className="text-muted-foreground">{MODE_DESCRIPTIONS[m]}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1 file:text-xs file:hover:bg-muted"
          />
        </CardContent>
      </Card>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm import</DialogTitle>
            <DialogDescription>
              {pending ? <ImportSummary mode={mode} applied={pending.applied} /> : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={busy}>
              {busy ? "Applying..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportSummary({ mode, applied }: { mode: ImportMode; applied: AppliedImport }) {
  const incomingCount = countRows(applied.next) - countRows(applied.replaced);
  return (
    <Empty className="border-0 p-0 text-left">
      <EmptyHeader className="items-start">
        <EmptyTitle className="text-base">
          {mode === "append"
            ? `Append ${Math.max(incomingCount, 0)} new row(s)`
            : `Replace local state with ${countRows(applied.next)} row(s)`}
        </EmptyTitle>
        <EmptyDescription className="text-left">
          {applied.conflicts.length > 0
            ? `${applied.conflicts.length} id collision(s) detected (existing rows kept). `
            : ""}
          {mode !== "append"
            ? `Prior state (${countRows(applied.replaced)} row(s)) will be snapshotted to history.`
            : ""}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const countRows = (b: Bundle): number =>
  (b.profile ? 1 : 0) +
  b.entities.length +
  b.spouses.length +
  b.clients.length +
  b.income.length +
  b.timeEntries.length +
  b.vehicles.length +
  b.mileage.length +
  b.homeOffice.length +
  b.expenses.length +
  b.retirementContributions.length;
