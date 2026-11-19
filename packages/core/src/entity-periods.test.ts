import { describe, expect, it } from "vitest";
import {
  canMoveEntityStart,
  EntityDatesError,
  EntityOverlapError,
  EntityPeriodError,
  endsBeforeStart,
  entityDatesMessage,
  entityOverlapMessage,
  findEntityOverlap,
  formatDisplayDate,
  type EntityPeriod,
} from "./entity-periods.ts";

const period = (
  id: string,
  startDate: string,
  endDate: string | null,
  extra: Partial<EntityPeriod> = {},
): EntityPeriod => ({ id, type: "sole_prop", startDate, endDate, deletedAt: null, ...extra });

describe("findEntityOverlap", () => {
  const cases: {
    name: string;
    existing: EntityPeriod[];
    candidate: { id?: string; startDate: string; endDate: string | null };
    conflict: string | null;
  }[] = [
    {
      name: "nothing saved yet",
      existing: [],
      candidate: { startDate: "2026-01-01", endDate: null },
      conflict: null,
    },
    {
      name: "open and open",
      existing: [period("a", "2024-01-01", null)],
      candidate: { startDate: "2026-11-02", endDate: null },
      conflict: "a",
    },
    {
      name: "open candidate that starts before an open period",
      existing: [period("a", "2026-01-01", null)],
      candidate: { startDate: "2024-01-01", endDate: null },
      conflict: "a",
    },
    {
      name: "closed candidate inside an open period",
      existing: [period("a", "2024-01-01", null)],
      candidate: { startDate: "2025-03-01", endDate: "2025-06-30" },
      conflict: "a",
    },
    {
      name: "open candidate that starts inside a closed period",
      existing: [period("a", "2024-01-01", "2024-12-31")],
      candidate: { startDate: "2024-06-01", endDate: null },
      conflict: "a",
    },
    {
      name: "closed candidate wholly before an open period",
      existing: [period("a", "2026-01-01", null)],
      candidate: { startDate: "2024-01-01", endDate: "2025-12-31" },
      conflict: null,
    },
    {
      name: "open candidate that starts after a closed period",
      existing: [period("a", "2024-01-01", "2024-12-31")],
      candidate: { startDate: "2025-01-01", endDate: null },
      conflict: null,
    },
    {
      name: "starts on the day the other ends (changeover day)",
      existing: [period("a", "2024-01-01", "2026-11-18")],
      candidate: { startDate: "2026-11-18", endDate: null },
      conflict: null,
    },
    {
      name: "ends on the day the other starts",
      existing: [period("a", "2026-11-18", null)],
      candidate: { startDate: "2024-01-01", endDate: "2026-11-18" },
      conflict: null,
    },
    {
      name: "ends one day after the other starts",
      existing: [period("a", "2026-11-18", null)],
      candidate: { startDate: "2024-01-01", endDate: "2026-11-19" },
      conflict: "a",
    },
    {
      name: "starts one day before the other ends",
      existing: [period("a", "2024-01-01", "2026-11-18")],
      candidate: { startDate: "2026-11-17", endDate: null },
      conflict: "a",
    },
    {
      name: "contained in a closed period",
      existing: [period("a", "2024-01-01", "2024-12-31")],
      candidate: { startDate: "2024-03-01", endDate: "2024-04-01" },
      conflict: "a",
    },
    {
      name: "contains a closed period",
      existing: [period("a", "2024-03-01", "2024-04-01")],
      candidate: { startDate: "2024-01-01", endDate: "2024-12-31" },
      conflict: "a",
    },
    {
      name: "identical closed periods",
      existing: [period("a", "2024-01-01", "2024-12-31")],
      candidate: { startDate: "2024-01-01", endDate: "2024-12-31" },
      conflict: "a",
    },
    {
      name: "identical one-day periods",
      existing: [period("a", "2024-05-05", "2024-05-05")],
      candidate: { startDate: "2024-05-05", endDate: "2024-05-05" },
      conflict: "a",
    },
    {
      name: "same start day, different ends",
      existing: [period("a", "2024-05-05", "2024-05-05")],
      candidate: { startDate: "2024-05-05", endDate: null },
      conflict: "a",
    },
    {
      name: "a one-day period on another period's last day",
      existing: [period("a", "2024-01-01", "2024-05-05")],
      candidate: { startDate: "2024-05-05", endDate: "2024-05-05" },
      conflict: null,
    },
    {
      name: "editing a period does not conflict with itself",
      existing: [period("a", "2024-01-01", null)],
      candidate: { id: "a", startDate: "2023-01-01", endDate: null },
      conflict: null,
    },
    {
      name: "editing a period still conflicts with another one",
      existing: [period("a", "2024-01-01", "2024-12-31"), period("b", "2025-01-01", null)],
      candidate: { id: "a", startDate: "2024-01-01", endDate: "2025-06-30" },
      conflict: "b",
    },
    {
      name: "a deleted period is ignored",
      existing: [period("a", "2024-01-01", null, { deletedAt: "2026-01-01T00:00:00.000Z" })],
      candidate: { startDate: "2025-01-01", endDate: null },
      conflict: null,
    },
    {
      name: "a different entity type still conflicts",
      existing: [period("a", "2024-01-01", null, { type: "single_member_llc" })],
      candidate: { startDate: "2025-01-01", endDate: null },
      conflict: "a",
    },
    {
      name: "fits in the gap between two periods, touching both",
      existing: [period("a", "2024-01-01", "2024-06-30"), period("b", "2025-01-01", null)],
      candidate: { startDate: "2024-06-30", endDate: "2025-01-01" },
      conflict: null,
    },
    {
      name: "several conflicts: the one that starts first is returned",
      existing: [period("late", "2025-01-01", null), period("early", "2024-01-01", "2024-12-31")],
      candidate: { startDate: "2024-06-01", endDate: null },
      conflict: "early",
    },
  ];

  it.each(cases)("$name", ({ existing, candidate, conflict }) => {
    expect(findEntityOverlap(existing, candidate)?.id ?? null).toBe(conflict);
  });

  it("is symmetric: swapping the saved period and the candidate gives the same answer", () => {
    for (const { existing, candidate } of cases) {
      if (existing.length !== 1 || candidate.id !== undefined) continue;
      const saved = existing[0]!;
      if (saved.deletedAt) continue;
      const forward = findEntityOverlap([saved], candidate) !== null;
      const backward =
        findEntityOverlap([period("c", candidate.startDate, candidate.endDate)], {
          startDate: saved.startDate,
          endDate: saved.endDate,
        }) !== null;
      expect(backward).toBe(forward);
    }
  });
});

describe("entityOverlapMessage", () => {
  it("names an open period by type label and start date, and says what to do", () => {
    expect(entityOverlapMessage(period("a", "2024-01-01", null))).toBe(
      "This overlaps your Sole proprietor period that started Jan 1, 2024 and is still open. End that period first, or change these dates. A period may start on the day the other one ends.",
    );
  });

  it("names a closed period by both dates", () => {
    expect(
      entityOverlapMessage(period("a", "2024-01-01", "2024-12-31", { type: "single_member_llc" })),
    ).toBe(
      "This overlaps your Single-member LLC period from Jan 1, 2024 to Dec 31, 2024. Change these dates so the two do not overlap. A period may start on the day the other one ends.",
    );
  });

  it("falls back to the stored code for a type with no label", () => {
    expect(entityOverlapMessage(period("a", "2024-01-01", null, { type: "co_op" }))).toContain(
      "your co_op period",
    );
  });
});

describe("entityOverlapMessage, for two periods that already overlapped", () => {
  it("does not say to end the other one first; it says how to separate them", () => {
    const message = entityOverlapMessage(period("a", "2024-01-01", null), { preexisting: true });
    expect(message).toBe(
      "This period already overlaps your Sole proprietor period that started Jan 1, 2024 and is still open, and these dates would not separate them. End one of the two on or before the day the other one starts. Ending either of them is always allowed.",
    );
    expect(message).not.toContain("End that period first");
  });
});

describe("endsBeforeStart", () => {
  it.each([
    { name: "end before start", startDate: "2026-11-02", endDate: "2023-01-01", inverted: true },
    {
      name: "end one day before start",
      startDate: "2026-11-02",
      endDate: "2026-11-01",
      inverted: true,
    },
    { name: "one-day period", startDate: "2026-11-02", endDate: "2026-11-02", inverted: false },
    { name: "end after start", startDate: "2026-11-02", endDate: "2026-11-03", inverted: false },
    { name: "open-ended", startDate: "2026-11-02", endDate: null, inverted: false },
  ])("$name", ({ startDate, endDate, inverted }) => {
    expect(endsBeforeStart({ startDate, endDate })).toBe(inverted);
  });

  it("an inverted candidate overlaps nothing, which is why it is rejected on its own", () => {
    const open = period("a", "2024-01-01", null);
    expect(
      findEntityOverlap([open], { startDate: "2026-11-02", endDate: "2023-01-01" }),
    ).toBeNull();
  });

  it("has a message that names both dates and says what to do", () => {
    expect(entityDatesMessage({ startDate: "2026-11-02", endDate: "2023-01-01" })).toBe(
      "The end date (Jan 1, 2023) is before the start date (Nov 2, 2026). Pick an end date on or after the start date, or leave it empty for a period that is still open.",
    );
  });
});

describe("EntityDatesError", () => {
  it("is an EntityPeriodError with the ready-made message", () => {
    const err = new EntityDatesError({ startDate: "2026-11-02", endDate: "2023-01-01" });
    expect(err).toBeInstanceOf(EntityPeriodError);
    expect(err.name).toBe("EntityDatesError");
    expect(err.message).toBe(
      entityDatesMessage({ startDate: "2026-11-02", endDate: "2023-01-01" }),
    );
  });
});

describe("EntityOverlapError", () => {
  it("carries the conflict and the ready-made message", () => {
    const conflict = period("a", "2024-01-01", null);
    const err = new EntityOverlapError(conflict);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EntityPeriodError);
    expect(err.preexisting).toBe(false);
    expect(err.name).toBe("EntityOverlapError");
    expect(err.conflict).toBe(conflict);
    expect(err.message).toBe(entityOverlapMessage(conflict));
  });
});

describe("formatDisplayDate", () => {
  it("writes an ISO date the way the date pickers show it", () => {
    expect(formatDisplayDate("2024-01-01")).toBe("Jan 1, 2024");
    expect(formatDisplayDate("2026-11-18")).toBe("Nov 18, 2026");
  });

  it("returns anything else unchanged", () => {
    expect(formatDisplayDate("1/15/2026")).toBe("1/15/2026");
    expect(formatDisplayDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("canMoveEntityStart: the rule the repo and the Profile dialog share", () => {
  const p = (id: string, type: string, startDate: string, endDate: string | null) => ({
    id,
    type,
    startDate,
    endDate,
    deletedAt: null,
  });
  type Case = {
    name: string;
    live: ReturnType<typeof p>[];
    move: string;
    expected: null | "dates" | "overlap-new" | "overlap-preexisting";
    conflictId?: string;
  };
  const cases: Case[] = [
    {
      name: "Austin's case: one open period, start moved earlier",
      live: [p("a", "sole_prop", "2026-11-02", null)],
      move: "2026-03-02",
      expected: null,
    },
    {
      name: "r1 demo B: a closed first period moved past its own end",
      live: [
        p("a", "sole_prop", "2026-01-05", "2026-02-28"),
        p("b", "single_member_llc", "2026-03-01", null),
      ],
      move: "2026-03-02",
      expected: "dates",
    },
    {
      name: "r2 demo C: an existing overlap, start moved earlier (grows) is rejected",
      live: [
        p("a", "sole_prop", "2026-03-01", null),
        p("b", "single_member_llc", "2026-06-01", null),
      ],
      move: "2026-02-02",
      expected: "overlap-preexisting",
      conflictId: "b",
    },
    {
      name: "r2 demo D: shrinking out of one existing overlap, still in another, is allowed",
      live: [
        p("a", "sole_prop", "2026-01-05", "2026-12-31"),
        p("b", "single_member_llc", "2026-02-01", "2026-02-28"),
        p("c", "single_member_llc", "2026-06-01", null),
      ],
      move: "2026-03-01",
      expected: null,
    },
    {
      name: "a shrink that lands on the next period's start day adds an overlap",
      live: [
        p("a", "sole_prop", "2026-01-01", "2026-06-01"),
        p("b", "single_member_llc", "2026-06-01", null),
      ],
      move: "2026-06-01",
      expected: "overlap-new",
      conflictId: "b",
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const problem = canMoveEntityStart(c.live, c.live[0]!, c.move);
      if (c.expected === null) return expect(problem).toBeNull();
      if (c.expected === "dates") return expect(problem).toBeInstanceOf(EntityDatesError);
      expect(problem).toBeInstanceOf(EntityOverlapError);
      const err = problem as EntityOverlapError;
      expect(err.preexisting).toBe(c.expected === "overlap-preexisting");
      expect(err.conflict.id).toBe(c.conflictId);
    });
  }
});
