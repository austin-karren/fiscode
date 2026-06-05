import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { buildBundle } from "@fiscode/db";
import { exportBundle } from "@fiscode/csv";
import { todayIso, yearOf } from "@fiscode/core";
import { useState } from "react";

const downloadCsv = (filename: string, csv: string) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export function ExportCard() {
  const [busy, setBusy] = useState(false);
  const year = yearOf(todayIso());

  const exportFull = async () => {
    setBusy(true);
    const bundle = await buildBundle();
    downloadCsv(`fiscode-${todayIso()}.csv`, exportBundle(bundle, { scope: "full" }));
    setBusy(false);
  };

  const exportYearly = async () => {
    setBusy(true);
    const bundle = await buildBundle();
    downloadCsv(`fiscode-${year}.csv`, exportBundle(bundle, { scope: "yearly", year }));
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
          Export CSV
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Yearly export is the artifact you hand to your accountant. Full export is your portable
          backup.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportFull} disabled={busy}>
            Download full CSV
          </Button>
          <Button onClick={exportYearly} disabled={busy} variant="outline">
            Download {year} CSV
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
