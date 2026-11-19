import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { buildBundle } from "@fiscode/db";
import { exportBundle, exportFileName, type ExportOptions } from "@fiscode/csv";
import { todayIso, yearOf } from "@fiscode/core";
import { useState } from "react";
import { toast } from "sonner";
import { SectionTitle } from "./section-title";

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

  const run = async (options: ExportOptions) => {
    setBusy(true);
    try {
      // The file is the whole state: deleted rows always, and for the full
      // backup the edit history too.
      const bundle = await buildBundle({
        includeDeleted: true,
        includeHistory: options.scope === "full",
      });
      downloadCsv(exportFileName(options, todayIso()), exportBundle(bundle, options));
    } catch (err) {
      // The export refuses to write a value it could not read back, and the
      // message names the row to fix.
      console.error(err);
      toast.error("Export failed.", {
        description: err instanceof Error ? err.message : String(err),
        duration: Infinity,
        closeButton: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const exportFull = () => run({ scope: "full" });
  const exportYearly = () => run({ scope: "yearly", year });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <SectionTitle>Export CSV</SectionTitle>
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
