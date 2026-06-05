import type { Bundle } from "@fiscode/csv";
import { todayIso, type IsoDate } from "@fiscode/core";

const activeOn = (start: string, end: string | null, date: IsoDate): boolean => {
  if (start > date) return false;
  if (end !== null && end < date) return false;
  return true;
};

/**
 * Derive UI feature flags from the bundle. Flags are either user-toggled on
 * profile or auto-derived from active entity / spouse / data presence.
 */
export const deriveFlags = (bundle: Bundle, today = todayIso()) => {
  const activeEntity = bundle.entities.find(
    (e) => e.deletedAt === null && activeOn(e.startDate, e.endDate, today),
  );
  const activeSpouse = bundle.spouses.find(
    (s) => s.deletedAt === null && activeOn(s.startDate, s.endDate, today),
  );
  return {
    isSCorp: activeEntity?.type === "s_corp",
    hasSpouse: activeSpouse !== undefined,
    hasDependents: (bundle.profile?.dependents ?? 0) > 0,
    usesRetirement:
      bundle.profile?.usesRetirement === true ||
      bundle.retirementContributions.some((r) => r.deletedAt === null && r.account !== "roth_ira"),
    tracksRoth:
      bundle.profile?.tracksRoth === true ||
      bundle.retirementContributions.some((r) => r.deletedAt === null && r.account === "roth_ira"),
    activeEntity,
    activeSpouse,
  };
};

export type DerivedFlags = ReturnType<typeof deriveFlags>;
