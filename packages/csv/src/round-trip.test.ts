import { describe, expect, it } from "vitest";
import { exportBundle } from "./export.ts";
import { parseCsv } from "./import.ts";
import type { Bundle } from "./bundle-types.ts";

const FIXED_TIMESTAMP = "2026-06-04T12:00:00.000Z";

const fullBundle = (): Bundle => ({
  profile: {
    id: "profile",
    filingStatus: "mfj",
    state: "UT",
    seStartDate: "2024-01-01",
    dependents: 0,
    tracksRoth: true,
    usesRetirement: false,
    quarterlyMethod: "annualized",
    prepLeadDays: 14,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  entities: [
    {
      id: "ent_1",
      type: "sole_prop",
      startDate: "2024-01-01",
      endDate: null,
      notes: "Initial entity",
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  spouses: [
    {
      id: "sp_1",
      startDate: "2024-01-01",
      endDate: "2025-12-31",
      annualW2WagesCents: 4_500_000,
      annualFederalWithholdingCents: 450_000,
      annualStateWithholdingCents: 180_000,
      notes: null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  clients: [
    {
      id: "cl_1",
      name: "Stable Commission Co",
      type: "recurring",
      notes: null,
      defaultRateCents: null,
      defaultCommissionRate: 600,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
    {
      id: "cl_2",
      name: "Ad-hoc Consulting",
      type: null,
      notes: "Occasional engagements",
      defaultRateCents: 15_000_00,
      defaultCommissionRate: null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  income: [
    {
      id: "in_1",
      date: "2026-01-15",
      clientId: "cl_1",
      amountCents: 1_000_000,
      sourceType: "1099",
      kind: "recurring",
      description: "January commission",
      notes: null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
    {
      id: "in_2",
      date: "2026-07-10",
      clientId: "cl_2",
      amountCents: 350_000,
      sourceType: "1099",
      kind: "bonus",
      description: "Q3 consulting bonus",
      notes: "Includes travel reimbursement",
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  timeEntries: [
    {
      id: "te_1",
      date: "2026-01-15",
      clientId: "cl_1",
      minutes: 480,
      description: "Full day",
      notes: null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  vehicles: [
    {
      id: "v_1",
      make: "Toyota",
      model: "RAV4",
      year: 2022,
      mpg: 28,
      method: "standard_mileage",
      inServiceDate: "2024-01-01",
      notes: null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  mileage: [
    {
      id: "mi_1",
      date: "2026-02-10",
      vehicleId: "v_1",
      businessMiles: 47,
      purpose: "Client visit",
      notes: null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  homeOffice: [
    {
      id: "ho_1",
      startDate: "2024-01-01",
      endDate: null,
      method: "simplified",
      officeSqft: 150,
      homeSqft: 2000,
      monthlyRentMortgageCents: null,
      monthlyUtilitiesCents: null,
      monthlyInsuranceCents: null,
      regularExclusiveAck: true,
      notes: null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  expenses: [
    {
      id: "ex_1",
      date: "2026-03-05",
      amountCents: 12_000,
      category: "software_subs",
      clientId: null,
      description: "Linear annual",
      reason: "PM tooling",
      notes: null,
      flagForSection179: false,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  retirementContributions: [
    {
      id: "ret_1",
      date: "2026-04-01",
      account: "roth_ira",
      amountCents: 7000_00,
      notes: "Personal Roth (informational)",
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
});

const stripExportedTimestamp = (csv: string): string =>
  csv.replace(/^# exported: .*$/m, "# exported: <MASKED>");

describe("CSV round-trip", () => {
  it("export → import → export is byte-stable (with timestamp masked)", () => {
    const bundle = fullBundle();
    const csv1 = exportBundle(bundle, {
      scope: "full",
      exportedAt: FIXED_TIMESTAMP,
    });
    const { bundle: round, validationErrors } = parseCsv(csv1);
    expect(validationErrors).toEqual([]);
    const csv2 = exportBundle(round, {
      scope: "full",
      exportedAt: FIXED_TIMESTAMP,
    });
    expect(stripExportedTimestamp(csv1)).toBe(stripExportedTimestamp(csv2));
  });

  it("preserves all fields exactly", () => {
    const bundle = fullBundle();
    const csv = exportBundle(bundle, {
      scope: "full",
      exportedAt: FIXED_TIMESTAMP,
    });
    const { bundle: round } = parseCsv(csv);
    expect(round).toEqual(bundle);
  });

  it("yearly export filters dated records to that year and includes spans that overlap", () => {
    const bundle = fullBundle();
    const csv = exportBundle(bundle, {
      scope: "yearly",
      year: 2026,
      exportedAt: FIXED_TIMESTAMP,
    });
    const { bundle: round } = parseCsv(csv);
    expect(round.profile?.id).toBe("profile");
    expect(round.income.map((r) => r.id).sort()).toEqual(["in_1", "in_2"]);
    expect(round.entities.map((r) => r.id)).toEqual(["ent_1"]);
    // Spouse span 2024-01-01..2025-12-31 does NOT overlap 2026 — should be omitted.
    expect(round.spouses).toEqual([]);
  });

  it("yearly export of a different year drops all dated records but keeps profile/active singletons", () => {
    const bundle = fullBundle();
    const csv = exportBundle(bundle, {
      scope: "yearly",
      year: 2027,
      exportedAt: FIXED_TIMESTAMP,
    });
    const { bundle: round } = parseCsv(csv);
    expect(round.profile?.id).toBe("profile");
    expect(round.income).toEqual([]);
    expect(round.expenses).toEqual([]);
    expect(round.mileage).toEqual([]);
    // Entity is open-ended (endDate null), so it still overlaps 2027.
    expect(round.entities.map((r) => r.id)).toEqual(["ent_1"]);
  });

  it("provenance header survives round-trip", () => {
    const bundle = fullBundle();
    const csv = exportBundle(bundle, {
      scope: "yearly",
      year: 2026,
      exportedAt: FIXED_TIMESTAMP,
    });
    const { provenance } = parseCsv(csv);
    expect(provenance.scope).toBe("yearly");
    expect(provenance.year).toBe(2026);
    expect(provenance.exportedAt).toBe(FIXED_TIMESTAMP);
  });

  it("Excel-style file with header comments is still parseable (comments stripped by importer)", () => {
    const bundle = fullBundle();
    const csv = exportBundle(bundle, {
      scope: "full",
      exportedAt: FIXED_TIMESTAMP,
    });
    // Simulate an extra rogue `#` line a user might have prepended.
    const dirtied = "# user note: please review\n" + csv;
    const { bundle: round, validationErrors } = parseCsv(dirtied);
    expect(validationErrors).toEqual([]);
    expect(round).toEqual(bundle);
  });
});
