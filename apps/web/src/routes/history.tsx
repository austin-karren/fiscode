import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { buildBundle, historyRepo } from "@fiscode/db";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@fiscode/ui/components/alert-dialog";
import { Button } from "@fiscode/ui/components/button";
import { History as HistoryIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { NoDataEmpty } from "../components/empty-states/no-data";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { Page } from "../components/page";
import {
  ALL,
  describeHistoryRow,
  formatHistoryTime,
  HISTORY_ACTION_LABELS,
  HISTORY_KIND_LABELS,
  matchesFilter,
  namesFromBundle,
  type HistoryAction,
  type HistoryEntry,
} from "../lib/history-describe";
import { planRestore, type RestorePlan } from "../lib/history-restore";

const PAGE_SIZE = 100;

export const Route = createFileRoute("/history")({
  loader: async () => {
    const [history, bundle] = await Promise.all([
      historyRepo.listAll(),
      // Deleted rows too: a restore compares against the record as it is
      // now, and an archived client still has a name.
      buildBundle({ includeDeleted: true }),
    ]);
    const names = namesFromBundle(bundle);
    // Newest first. Same-instant rows keep their stored order, reversed.
    const rows = history.slice().reverse();
    return {
      rows,
      bundle,
      names,
      entries: rows.map((row) => describeHistoryRow(row, names)),
    };
  },
  component: HistoryPage,
});

function HistoryPage() {
  const { rows, bundle, names, entries } = useLoaderData({ from: "/history" });
  const router = useRouter();
  const [kind, setKind] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [shown, setShown] = useState(PAGE_SIZE);

  const kindsPresent = new Set(entries.map((e) => e.kind));
  const actionsPresent = new Set<HistoryAction>(entries.map((e) => e.action));
  const kindItems = [
    { value: ALL, label: "All records" },
    ...Object.entries(HISTORY_KIND_LABELS)
      .filter(([value]) => kindsPresent.has(value))
      .map(([value, label]) => ({ value, label })),
  ];
  const actionItems = [
    { value: ALL, label: "All actions" },
    ...Object.entries(HISTORY_ACTION_LABELS)
      .filter(([value]) => actionsPresent.has(value as HistoryAction))
      .map(([value, label]) => ({ value, label })),
  ];

  const matching = entries
    .map((entry, index) => ({ entry, row: rows[index]! }))
    .filter(({ entry }) => matchesFilter(entry, kind, action));
  const visible = matching.slice(0, shown);

  return (
    <Page title="History" description="Every change is recorded here, newest first.">
      {entries.length === 0 ? (
        <NoDataEmpty
          icon={HistoryIcon}
          title="No history yet"
          description="Each thing you add, edit, delete or import shows up here, and most can be restored."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Filter label="Record" value={kind} onValueChange={setKind} items={kindItems} />
            <Filter label="Action" value={action} onValueChange={setAction} items={actionItems} />
            <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
              {matching.length === entries.length
                ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
                : `${matching.length} of ${entries.length} entries`}
            </p>
          </div>

          {matching.length === 0 ? (
            <p className="rounded-md border border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No entries match these filters.
            </p>
          ) : (
            <ul aria-label="History" className="rounded-md border border-border text-sm">
              {visible.map(({ entry, row }) => (
                <HistoryItem
                  key={entry.id}
                  entry={entry}
                  plan={planRestore(row, bundle, names)}
                  onChange={() => router.invalidate()}
                />
              ))}
            </ul>
          )}

          {matching.length > shown ? (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => setShown(shown + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, matching.length - shown)} more
            </Button>
          ) : null}
        </>
      )}
    </Page>
  );
}

function Filter({
  label,
  value,
  onValueChange,
  items,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <SelectWithLabels
        id={id}
        value={value}
        onValueChange={(v) => onValueChange(v === "" ? ALL : v)}
        items={items}
        triggerClassName="w-44"
      />
    </div>
  );
}

// One entry. Wide: when | what | Restore on one line. Narrow: what and
// Restore on the first line, when under it; nothing scrolls sideways.
function HistoryItem({
  entry,
  plan,
  onChange,
}: {
  entry: HistoryEntry;
  plan: RestorePlan | undefined;
  onChange: () => void;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border/40 px-3 py-2 last:border-b-0 md:grid-cols-[11rem_minmax(0,1fr)_auto]">
      <time
        dateTime={entry.at.toISOString()}
        className="order-3 col-span-2 text-xs text-muted-foreground tabular-nums md:order-none md:col-span-1 md:pt-0.5 md:text-sm"
      >
        {formatHistoryTime(entry.at)}
      </time>
      <div className="min-w-0">
        <p className="font-medium wrap-break-word">{entry.headline}</p>
        {entry.changes.length > 0 ? (
          <ul className="mt-0.5 text-muted-foreground">
            {entry.changes.map((change) => (
              <li key={change.label} className="wrap-break-word">
                {change.label}: {change.from} <span aria-hidden="true">→</span>
                <span className="sr-only"> changed to </span>{" "}
                <span className="text-foreground">{change.to}</span>
              </li>
            ))}
          </ul>
        ) : entry.facts.length > 0 ? (
          <p className="mt-0.5 text-muted-foreground wrap-break-word">{entry.facts.join(" · ")}</p>
        ) : null}
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            Details
          </summary>
          <p className="mt-1 break-all">
            {entry.kindLabel} record <span className="font-mono">{entry.recordId}</span>, entry{" "}
            <span className="font-mono">{entry.id}</span>
          </p>
        </details>
      </div>
      <div className="justify-self-end">
        {plan ? <RestoreDialog entry={entry} plan={plan} onChange={onChange} /> : null}
      </div>
    </li>
  );
}

function RestoreDialog({
  entry,
  plan,
  onChange,
}: {
  entry: HistoryEntry;
  plan: RestorePlan;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm" aria-label={`Restore: ${entry.headline}`}>
            Restore
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{plan.title}</AlertDialogTitle>
          <AlertDialogDescription>{plan.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={plan.discardsNewer ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await plan.run(onChange);
                setOpen(false);
              } catch (err) {
                console.error(err);
                toast.error("Restore failed. Nothing was changed.", {
                  description: err instanceof Error ? err.message : String(err),
                  duration: Infinity,
                  closeButton: true,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            Restore
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
