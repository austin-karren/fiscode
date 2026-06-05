import { describe, expect, it } from "vitest";
import { applyImport } from "./apply-import.ts";
import { emptyBundle, type Bundle } from "./bundle-types.ts";
import { exportBundle } from "./export.ts";
import { parseCsv } from "./import.ts";

const FIXED = "2026-06-04T12:00:00.000Z";

const incomeRow = (id: string, date: string, amount: number) => ({
  id,
  date,
  clientId: null,
  amountCents: amount,
  sourceType: "1099",
  kind: "recurring",
  description: null,
  notes: null,
  createdAt: FIXED,
  updatedAt: FIXED,
  deletedAt: null,
});

const profile = (id = "profile") => ({
  id,
  filingStatus: "mfj",
  state: "UT",
  seStartDate: "2024-01-01",
  dependents: 0,
  tracksRoth: false,
  usesRetirement: false,
  quarterlyMethod: "annualized",
  prepLeadDays: 14,
  createdAt: FIXED,
  updatedAt: FIXED,
});

describe("applyImport", () => {
  it("overwrite replaces wholesale; replaced captures the prior state", () => {
    const existing: Bundle = {
      ...emptyBundle(),
      profile: profile(),
      income: [incomeRow("in_old", "2026-01-01", 100_00)],
    };
    const incoming: Bundle = {
      ...emptyBundle(),
      profile: { ...profile(), state: "CA" },
      income: [incomeRow("in_new", "2026-05-01", 555_00)],
    };
    const r = applyImport(existing, incoming, "overwrite");
    expect(r.next).toEqual(incoming);
    expect(r.replaced).toEqual(existing);
    expect(r.conflicts).toEqual([]);
  });

  it("restore behaves like overwrite", () => {
    const existing: Bundle = { ...emptyBundle(), profile: profile() };
    const incoming: Bundle = {
      ...emptyBundle(),
      profile: { ...profile(), dependents: 2 },
    };
    const r = applyImport(existing, incoming, "restore");
    expect(r.next).toEqual(incoming);
    expect(r.replaced).toEqual(existing);
  });

  it("append keeps existing rows and adds non-colliding incoming rows", () => {
    const existing: Bundle = {
      ...emptyBundle(),
      profile: profile(),
      income: [incomeRow("in_a", "2026-01-01", 100_00)],
    };
    const incoming: Bundle = {
      ...emptyBundle(),
      income: [incomeRow("in_b", "2026-02-01", 200_00), incomeRow("in_c", "2026-03-01", 300_00)],
    };
    const r = applyImport(existing, incoming, "append");
    expect(r.conflicts).toEqual([]);
    expect(r.next.income.map((i) => i.id).sort()).toEqual(["in_a", "in_b", "in_c"]);
    expect(r.next.profile).toEqual(profile());
  });

  it("append records conflicts and keeps existing rows on id collision", () => {
    const existing: Bundle = {
      ...emptyBundle(),
      profile: profile(),
      income: [incomeRow("in_a", "2026-01-01", 100_00)],
    };
    const incoming: Bundle = {
      ...emptyBundle(),
      income: [
        incomeRow("in_a", "2026-01-01", 999_99), // collision
        incomeRow("in_b", "2026-02-01", 200_00), // new
      ],
    };
    const r = applyImport(existing, incoming, "append");
    expect(r.conflicts).toEqual([{ table: "income", id: "in_a" }]);
    // Existing wins for in_a.
    expect(r.next.income.find((i) => i.id === "in_a")?.amountCents).toBe(100_00);
    expect(r.next.income.map((i) => i.id).sort()).toEqual(["in_a", "in_b"]);
  });

  it("append preserves existing profile if both present (singleton append)", () => {
    const existing: Bundle = {
      ...emptyBundle(),
      profile: { ...profile(), state: "UT" },
    };
    const incoming: Bundle = {
      ...emptyBundle(),
      profile: { ...profile(), state: "CA" },
    };
    const r = applyImport(existing, incoming, "append");
    expect(r.next.profile?.state).toBe("UT");
  });

  it("append fills profile when existing has none", () => {
    const existing: Bundle = emptyBundle();
    const incoming: Bundle = { ...emptyBundle(), profile: profile() };
    const r = applyImport(existing, incoming, "append");
    expect(r.next.profile).toEqual(profile());
  });

  it("CSV round trip → applyImport(overwrite) on empty existing → equals original", () => {
    const original: Bundle = {
      ...emptyBundle(),
      profile: profile(),
      income: [incomeRow("in_1", "2026-01-15", 1_000_00), incomeRow("in_2", "2026-07-10", 350_000)],
    };
    const csv = exportBundle(original, { scope: "full", exportedAt: FIXED });
    const { bundle: parsed } = parseCsv(csv);
    const r = applyImport(emptyBundle(), parsed, "overwrite");
    expect(r.next).toEqual(original);
  });

  it("CSV round trip → applyImport(append) on empty existing → equals original", () => {
    const original: Bundle = {
      ...emptyBundle(),
      profile: profile(),
      income: [incomeRow("in_1", "2026-01-15", 1_000_00)],
    };
    const csv = exportBundle(original, { scope: "full", exportedAt: FIXED });
    const { bundle: parsed } = parseCsv(csv);
    const r = applyImport(emptyBundle(), parsed, "append");
    expect(r.next).toEqual(original);
    expect(r.conflicts).toEqual([]);
  });
});
