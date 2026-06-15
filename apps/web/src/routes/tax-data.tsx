import { useState } from "react";
import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { CloudDownload, CloudOff, FileWarning, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Page } from "../components/page";
import {
  statusForYear,
  syncTaxYearData,
  TaxSyncError,
  yearsToTrack,
  type TaxYearSyncStatus,
} from "../lib/tax-sync";

/**
 * Tax-data settings page. The ONLY surface that loudly reports sync errors —
 * everywhere else the app silently falls back to hardcoded or stale-cached
 * values. Users who care about freshness come here to inspect status and
 * trigger a manual refresh.
 */
export const Route = createFileRoute("/tax-data")({
  loader: async () => {
    const years = uniqueSorted([...yearsToTrack(), 2025, 2026]);
    const statuses = await Promise.all(years.map((y) => statusForYear(y)));
    return { statuses };
  },
  component: TaxDataPage,
});

const uniqueSorted = (years: number[]): number[] => Array.from(new Set(years)).sort();

function TaxDataPage() {
  const { statuses } = useLoaderData({ from: "/tax-data" });
  const router = useRouter();
  const [busyYear, setBusyYear] = useState<number | "all" | undefined>();

  const sync = async (year: number) => {
    setBusyYear(year);
    try {
      await syncTaxYearData(year);
      toast.success(`Synced ${year} tax data.`);
      router.invalidate();
    } catch (e) {
      const msg = e instanceof TaxSyncError ? e.message : String(e);
      toast.error(`Sync failed for ${year}`, { description: msg });
    } finally {
      setBusyYear(undefined);
    }
  };

  const syncAll = async () => {
    setBusyYear("all");
    const years = statuses.map((s) => s.year);
    const results = await Promise.allSettled(years.map((y) => syncTaxYearData(y)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    if (failed === 0) {
      toast.success(`Synced ${ok} year${ok === 1 ? "" : "s"}.`);
    } else if (ok === 0) {
      toast.error(`All ${failed} sync(s) failed. Is the mirror reachable?`);
    } else {
      toast.warning(`Synced ${ok} year${ok === 1 ? "" : "s"}, ${failed} failed.`);
    }
    setBusyYear(undefined);
    router.invalidate();
  };

  return (
    <Page
      title="Tax data"
      description="Per-year IRS / SSA figures used by the estimate engine. Synced from a hosted mirror; falls back to bundled values when the mirror is unreachable."
    >
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={busyYear !== undefined}
          onClick={() => void syncAll()}
        >
          <RefreshCw className={busyYear === "all" ? "animate-spin" : undefined} />
          {busyYear === "all" ? "Syncing…" : "Sync all"}
        </Button>
      </div>

      {statuses.map((status) => (
        <YearCard
          key={status.year}
          status={status}
          busy={busyYear === status.year}
          onSync={() => void sync(status.year)}
        />
      ))}
    </Page>
  );
}

function YearCard({
  status,
  busy,
  onSync,
}: {
  status: TaxYearSyncStatus;
  busy: boolean;
  onSync: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span className="font-mono uppercase tracking-wide text-muted-foreground">
            Tax year {status.year}
          </span>
          <SourceBadge status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <Row label="Source">
          {status.remoteSource ?? (status.source === "hardcoded" ? "bundled with app" : "—")}
        </Row>
        <Row label="Last fetched">
          {status.fetchedAt ? (
            <span className="font-mono text-xs">
              {new Date(status.fetchedAt).toLocaleString()}{" "}
              {status.isStale ? (
                <span className="ms-1 text-amber-600">(stale, &gt; 7 days)</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">never</span>
          )}
        </Row>
        <Row label="Schema">
          <span className="font-mono text-xs">{status.schemaVersion ?? "—"}</span>
        </Row>
        <Row label="Mirror URL">
          <span className="font-mono text-xs">{status.sourceUrl}</span>
        </Row>
      </CardContent>
      <CardFooter className="justify-end">
        <Button variant="outline" size="sm" disabled={busy} onClick={onSync}>
          <RefreshCw className={busy ? "animate-spin" : undefined} />
          {busy ? "Syncing…" : status.source === "remote" ? "Re-sync" : "Sync now"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function SourceBadge({ status }: { status: TaxYearSyncStatus }) {
  if (status.source === "remote") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <CloudDownload className="h-3 w-3" />
        Remote
      </span>
    );
  }
  if (status.source === "hardcoded") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <CloudOff className="h-3 w-3" />
        Bundled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      <FileWarning className="h-3 w-3" />
      Missing
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-28 shrink-0 text-xs uppercase text-muted-foreground">{label}</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}
