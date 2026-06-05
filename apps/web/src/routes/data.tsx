import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Card } from "@fiscode/ui/components/card";
import { buildBundle } from "@fiscode/db";
import { exportBundle, parseCsv } from "@fiscode/csv";
import { todayIso, yearOf } from "@fiscode/core";
import { useState } from "react";
import { toast } from "sonner";

import { Page } from "../components/page";

export const Route = createFileRoute("/data")({
  component: DataPage,
});

const downloadCsv = (filename: string, csv: string) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

function DataPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const exportFull = async () => {
    setBusy(true);
    const bundle = await buildBundle();
    const csv = exportBundle(bundle, { scope: "full" });
    downloadCsv(`fiscode-${todayIso()}.csv`, csv);
    setBusy(false);
  };

  const exportYearly = async () => {
    setBusy(true);
    const bundle = await buildBundle();
    const y = yearOf(todayIso());
    const csv = exportBundle(bundle, { scope: "yearly", year: y });
    downloadCsv(`fiscode-${y}.csv`, csv);
    setBusy(false);
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const { bundle, validationErrors, provenance } = parseCsv(text);
    if (validationErrors.length > 0) {
      toast.error(`${validationErrors.length} row(s) failed validation. Aborting.`);
      console.error(validationErrors);
      return;
    }
    // todo: wire the bundle back into the DB. For now, surface a confirmation
    // dialog flow so the user gets a real preview before destructive overwrite.
    toast.success(`Parsed ${countRows(bundle)} rows from ${provenance.scope ?? "unknown"} export.`);
    router.invalidate();
  };

  return (
    <Page
      title="Data"
      description="CSV is the source of truth. Exports include a provenance header; the importer strips it. Excel will not."
    >
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-medium uppercase text-muted-foreground">Export</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Use the yearly export as the artifact you hand to your accountant.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportFull} disabled={busy}>
            Download full CSV
          </Button>
          <Button onClick={exportYearly} disabled={busy} variant="outline">
            Download {yearOf(todayIso())} CSV
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-medium uppercase text-muted-foreground">
          Import (preview)
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Parsing only — applying the bundle to local state requires confirmation. This will be
          wired in a follow-up.
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
          }}
          className="block text-sm"
        />
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-medium uppercase text-muted-foreground">Backup nudge</h2>
        <p className="text-sm text-muted-foreground">
          Download the latest CSV and upload it to Google Drive as off-device insurance. fiscode
          does not integrate with Drive.
        </p>
      </Card>
    </Page>
  );
}

const countRows = (b: Awaited<ReturnType<typeof buildBundle>>): number =>
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
