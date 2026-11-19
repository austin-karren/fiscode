import {
  buildBundle,
  clientRepo,
  emptyBundle,
  entityRepo,
  expenseRepo,
  homeOfficeRepo,
  importBundle,
  incomeRepo,
  mileageRepo,
  retirementRepo,
  spouseRepo,
  timeRepo,
  vehicleRepo,
  type Bundle,
  type HistoryRow,
} from "@fiscode/db";
import { toast } from "sonner";

import {
  countBundleRows,
  parseSnapshot,
  snapshotChanges,
  snapshotNoun,
  snapshotTitle,
  type NameLookup,
} from "./history-describe";
import { revertWithUndo } from "./soft-delete";

// What the History screen's Restore does for one history row, worked out
// from the row's "before" snapshot and the record as it is now.

type Snapshot = Record<string, unknown>;
type StoredRow = Snapshot & { id: string; deletedAt?: string | null };

type AnyCrudRepo = {
  softDelete: (id: string) => Promise<boolean>;
  // Each repo takes its own row type; a stored snapshot is that row as JSON.
  revertTo: (id: string, snapshot: any) => Promise<unknown>;
};

// History's `entity` is the table name. The profile is not here: its repo has
// no `revertTo`, so a profile edit can be read but not restored.
const REPOS: Record<string, AnyCrudRepo> = {
  client: clientRepo,
  entity: entityRepo,
  spouse: spouseRepo,
  income: incomeRepo,
  time_entry: timeRepo,
  vehicle: vehicleRepo,
  mileage: mileageRepo,
  home_office: homeOfficeRepo,
  expense: expenseRepo,
  retirement_contribution: retirementRepo,
};

const BUNDLE_KEY: Record<string, keyof Bundle> = {
  client: "clients",
  entity: "entities",
  spouse: "spouses",
  income: "income",
  time_entry: "timeEntries",
  vehicle: "vehicles",
  mileage: "mileage",
  home_office: "homeOffice",
  expense: "expenses",
  retirement_contribution: "retirementContributions",
};

/** The record a history row is about, as it is now (deleted rows included). */
export const currentRowFor = (
  bundle: Bundle,
  entity: string,
  id: string,
): StoredRow | undefined => {
  const key = BUNDLE_KEY[entity];
  if (!key) return undefined;
  return (bundle[key] as unknown as StoredRow[]).find((r) => r.id === id);
};

// `updatedAt` moves on every write, also on a restore; it is not a difference.
const sameRow = (a: Snapshot | undefined, b: Snapshot | undefined): boolean => {
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("updatedAt");
  return [...keys].every((k) => (a[k] ?? null) === (b[k] ?? null));
};

const isDeleted = (row: Snapshot | undefined): boolean =>
  typeof row?.deletedAt === "string" && row.deletedAt !== "";

export type RestorePlan = {
  title: string;
  /** Plain words for the confirm dialog. */
  description: string;
  /** The restore throws away something newer than this history row. */
  discardsNewer: boolean;
  run: (onChange: () => void) => Promise<void>;
};

const sentenceList = (parts: string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/**
 * The restore a history row offers, or undefined when there is nothing to
 * restore: the row has no earlier state, the record is already in that state,
 * or its type cannot be restored.
 */
export function planRestore(
  row: HistoryRow,
  bundle: Bundle,
  names: NameLookup,
): RestorePlan | undefined {
  const before = parseSnapshot(row.beforeJson);
  if (!before) return undefined;

  if (row.entity === "__import_snapshot") return planImportRestore(before);

  const repo = REPOS[row.entity];
  // Restoring a deleted snapshot would delete the record; that is done on the
  // record's own screen.
  if (!repo || typeof before.id !== "string" || isDeleted(before)) return undefined;
  const snapshot = before as StoredRow;
  const current = currentRowFor(bundle, row.entity, row.entityId);
  if (sameRow(current, snapshot)) return undefined;

  const noun = snapshotNoun(row.entity);
  const name = snapshotTitle(row.entity, snapshot, names);
  const gone = !current || isDeleted(current);
  const after = parseSnapshot(row.afterJson);
  // Newer than this entry: the record no longer looks the way this entry left it.
  const discardsNewer = current !== undefined && !sameRow(current, after);
  const changes = current
    ? snapshotChanges(row.entity, current, snapshot, names).map(
        (c) => `${c.label.toLowerCase()} ${c.to}`,
      )
    : [];

  let description: string;
  if (gone) {
    description = `This brings back the ${noun} ${name}.`;
    if (changes.length > 0 && discardsNewer) {
      description += ` It comes back as it was at this point: ${sentenceList(changes)}.`;
    }
  } else {
    description =
      changes.length > 0
        ? `This puts ${snapshotTitle(row.entity, current, names)} back to ${sentenceList(changes)}.`
        : `This puts ${name} back to how it was at this point.`;
    description += discardsNewer
      ? " It was changed again after this entry; those later changes are replaced too."
      : " The current values are replaced.";
  }

  return {
    title: gone ? `Bring back this ${noun}?` : `Restore this ${noun}?`,
    description,
    discardsNewer,
    run: (onChange) =>
      revertWithUndo({
        repo,
        snapshot,
        current,
        message: gone ? `${name} is back.` : `${name} restored.`,
        undoneMessage: "Restore undone.",
        onChange,
      }),
  };
}

function planImportRestore(before: Record<string, unknown>): RestorePlan {
  const count = countBundleRows(before);
  return {
    title: "Go back to before this import?",
    description: `This puts everything back to how it was just before this import (${count} ${
      count === 1 ? "row" : "rows"
    }). Everything added or changed since then is replaced.`,
    discardsNewer: true,
    run: async (onChange) => {
      // Taken first, so Undo can put today's state back.
      const current = await buildBundle({ includeDeleted: true });
      await importBundle({ ...emptyBundle(), ...before, history: [] }, "import-restore");
      onChange();
      toast("Back to before the import.", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            await importBundle({ ...current, history: [] }, "import-restore");
            onChange();
            toast.success("Restore undone.");
          },
        },
      });
    },
  };
}
