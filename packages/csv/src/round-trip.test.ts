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
    priorYearTotalTaxCents: null,
    priorYearAgiCents: null,
    priorYearStateTaxCents: null,
    priorYearFiguresYear: null,
    priorYearNotFiled: null,
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
      startupExpense: false,
      placedInServiceDate: null,
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
  w2Jobs: [
    {
      id: "w2_1",
      taxYear: 2026,
      employer: "Demo Employer Inc",
      startDate: "2026-01-01",
      endDate: "2026-02-18",
      wagesCents: 12_345_67,
      federalWithholdingCents: 1_234_56,
      ssWagesCents: 12_345_67,
      ssTaxWithheldCents: 765_43,
      medicareWagesCents: 12_345_67,
      ssTipsCents: 0,
      stateWagesCents: 12_345_67,
      stateWithholdingCents: 543_21,
      notes: null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  estimatedPayments: [
    {
      id: "ep_1",
      date: "2027-01-15",
      amountCents: 1_000_00,
      jurisdiction: "federal",
      taxYear: 2026,
      appliedQuarter: 4,
      notes: "Q4, paid in January",
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  documentFolders: [
    {
      id: "df_1",
      parentId: null,
      name: "2026",
      taxYear: 2026,
      sortOrder: 0,
      defaultKey: "year-root",
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  documents: [
    {
      id: "doc_1",
      folderId: "df_1",
      name: "Demo receipt.pdf",
      mime: "application/pdf",
      sizeBytes: 1_234_567,
      sha256: "a".repeat(64),
      addedAt: FIXED_TIMESTAMP,
      notes: null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  documentLinks: [
    {
      id: "dl_1",
      documentId: "doc_1",
      recordType: "expense",
      recordId: "ex_1",
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      deletedAt: null,
    },
  ],
  history: [
    {
      id: "h_1",
      entity: "client",
      entityId: "cl_1",
      op: "insert",
      beforeJson: null,
      afterJson: '{"id":"cl_1","name":"Stable Commission Co","notes":null}',
      at: "2026-06-04T12:00:00.000Z",
    },
    {
      id: "h_2",
      entity: "client",
      entityId: "cl_1",
      op: "update",
      beforeJson: '{"id":"cl_1","name":"Stable, \\"Co\\""}',
      afterJson: '{"id":"cl_1","name":"Stable Commission Co"}',
      at: "2026-06-05T08:30:00.000Z",
    },
  ],
});

describe("CSV round-trip", () => {
  it("export → import → export is byte-identical", () => {
    const bundle = fullBundle();
    const csv1 = exportBundle(bundle, {
      scope: "full",
    });
    const { bundle: round, validationErrors } = parseCsv(csv1);
    expect(validationErrors).toEqual([]);
    const csv2 = exportBundle(round, {
      scope: "full",
    });
    expect(csv2).toBe(csv1);
  });

  it("an actual-method home office (Form 8829 inputs) round-trips byte-identical", () => {
    const bundle = fullBundle();
    bundle.homeOffice = [
      {
        ...bundle.homeOffice[0]!,
        method: "actual",
        officeSqft: 200,
        homeSqft: 2000,
        monthlyRentMortgageCents: 150_000,
        monthlyUtilitiesCents: 20_000,
        monthlyInsuranceCents: 3_000,
      },
    ];
    const csv1 = exportBundle(bundle, { scope: "full" });
    const { bundle: round, validationErrors } = parseCsv(csv1);
    expect(validationErrors).toEqual([]);
    expect(round.homeOffice).toEqual(bundle.homeOffice);
    expect(exportBundle(round, { scope: "full" })).toBe(csv1);
  });

  it("preserves all fields exactly", () => {
    const bundle = fullBundle();
    const csv = exportBundle(bundle, {
      scope: "full",
    });
    const { bundle: round } = parseCsv(csv);
    expect(round).toEqual(bundle);
  });

  it("an equipment row's placed_in_service_date round-trips (v3)", () => {
    const bundle = fullBundle();
    bundle.expenses = [
      {
        ...bundle.expenses[0]!,
        category: "equipment",
        date: "2025-11-20",
        placedInServiceDate: "2026-02-01",
      },
    ];
    const csv = exportBundle(bundle, { scope: "full" });
    expect(csv).toContain("placed_in_service_date");
    const { bundle: round, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);
    expect(round.expenses[0]!.placedInServiceDate).toBe("2026-02-01");
    expect(exportBundle(round, { scope: "full" })).toBe(csv);
  });

  it("a v2 file (no placed_in_service_date column) still imports, with the field null", () => {
    const v2 = [
      "# fiscode export (schema: v2; scope: full)",
      "record_type,date,category,category_label,description,amount,client_name,reason,flag_for_section_179,startup_expense,notes,id,client_id,created_at,updated_at,deleted_at",
      "expense,2026-01-20,equipment,Equipment,Demo desk,899.99,,,yes,no,,ex_v2,,2026-06-04T12:00:00.000Z,2026-06-04T12:00:00.000Z,",
      "",
    ].join("\n");
    const { bundle, validationErrors, provenance } = parseCsv(v2);
    expect(validationErrors).toEqual([]);
    expect(provenance.schema).toBe("v2");
    expect(bundle.expenses).toHaveLength(1);
    expect(bundle.expenses[0]!.placedInServiceDate).toBeNull();
    expect(bundle.expenses[0]!.amountCents).toBe(89_999);
  });

  it("last year's tax, AGI and Utah tax round-trip on the profile (v4), $0 kept as 0", () => {
    const bundle = fullBundle();
    bundle.profile = {
      ...bundle.profile!,
      priorYearTotalTaxCents: 1_234_56,
      priorYearAgiCents: 150_000_01,
      priorYearStateTaxCents: 0,
      priorYearFiguresYear: 2025,
    };
    const csv = exportBundle(bundle, { scope: "full" });
    expect(csv).toContain(
      "prior_year_total_tax,prior_year_agi,prior_year_state_tax,prior_year_figures_year",
    );
    expect(csv).toContain("1234.56,150000.01,0.00,2025");
    const { bundle: round, validationErrors } = parseCsv(csv);
    expect(validationErrors).toEqual([]);
    expect(round.profile).toMatchObject({
      priorYearTotalTaxCents: 1_234_56,
      priorYearAgiCents: 150_000_01,
      priorYearStateTaxCents: 0,
      priorYearFiguresYear: 2025,
    });
    expect(exportBundle(round, { scope: "full" })).toBe(csv);
  });

  it("a v3 file (no prior-year columns) still imports, with the fields null", () => {
    const v3 = [
      "# fiscode export (schema: v3; scope: full)",
      "record_type,filing_status,filing_status_label,state,se_start_date,dependents,quarterly_method,quarterly_method_label,prep_lead_days,tracks_roth,uses_retirement,id,created_at,updated_at",
      "profile,single,Single,UT,2026-02-01,0,annualized,Annualized,14,no,no,profile,2026-06-04T12:00:00.000Z,2026-06-04T12:00:00.000Z",
      "",
    ].join("\n");
    const { bundle, validationErrors, provenance } = parseCsv(v3);
    expect(validationErrors).toEqual([]);
    expect(provenance.schema).toBe("v3");
    expect(bundle.profile).toMatchObject({
      seStartDate: "2026-02-01",
      priorYearTotalTaxCents: null,
      priorYearAgiCents: null,
      priorYearStateTaxCents: null,
      priorYearFiguresYear: null,
      priorYearNotFiled: null,
    });
  });

  it("a v5 file (no document rows) imports with them empty", () => {
    const v5 = exportBundle(fullBundle(), { scope: "full" })
      .replace("schema: v6", "schema: v5")
      .split("\r\n")
      .filter((l) => !/^(document_folder|document|document_link),/.test(l))
      .join("\r\n");
    const { bundle, validationErrors, provenance } = parseCsv(v5);
    expect(validationErrors).toEqual([]);
    expect(provenance.schema).toBe("v5");
    expect(bundle.documentFolders).toEqual([]);
    expect(bundle.documents).toEqual([]);
    expect(bundle.documentLinks).toEqual([]);
  });

  it("documents round-trip as rows (no bytes), with a size for people; the yearly file has none", () => {
    const b = fullBundle();
    const csv = exportBundle(b, { scope: "full" });
    expect(csv).toContain("# Documents");
    expect(csv).toContain("Demo receipt.pdf,df_1,application/pdf,1.2 MB,1234567,");
    const round = parseCsv(csv).bundle;
    expect(round.documentFolders).toEqual(b.documentFolders);
    expect(round.documents).toEqual(b.documents);
    expect(round.documentLinks).toEqual(b.documentLinks);
    expect(exportBundle(round, { scope: "full" })).toBe(csv);
    const yearly = parseCsv(exportBundle(b, { scope: "yearly", year: 2026 })).bundle;
    expect([yearly.documentFolders, yearly.documents, yearly.documentLinks]).toEqual([[], [], []]);
  });

  it("a v4 file (no W-2 or payment rows, no prior_year_not_filed) imports with them empty", () => {
    const v4 = exportBundle(fullBundle(), { scope: "full" })
      .replace("schema: v6", "schema: v4")
      .split("\r\n")
      .filter((l) => !/^(w2_job|estimated_payment|document_folder|document|document_link),/.test(l))
      .join("\r\n");
    const { bundle, validationErrors, provenance } = parseCsv(v4);
    expect(validationErrors).toEqual([]);
    expect(provenance.schema).toBe("v4");
    expect(bundle.w2Jobs).toEqual([]);
    expect(bundle.estimatedPayments).toEqual([]);
  });

  it("a profile's prior_year_not_filed reads yes, no and empty as true, false and null", () => {
    for (const v of [true, false, null]) {
      const b = fullBundle();
      b.profile = { ...b.profile!, priorYearNotFiled: v };
      expect(parseCsv(exportBundle(b, { scope: "full" })).bundle.profile!.priorYearNotFiled).toBe(
        v,
      );
    }
  });

  it("the yearly file carries W-2s and payments by tax year: a January payment goes with the prior year", () => {
    const b = fullBundle(); // ep_1 is dated 2027-01-15 for tax year 2026
    const y2026 = parseCsv(exportBundle(b, { scope: "yearly", year: 2026 })).bundle;
    const y2027 = parseCsv(exportBundle(b, { scope: "yearly", year: 2027 })).bundle;
    expect(y2026.estimatedPayments.map((p) => p.id)).toEqual(["ep_1"]);
    expect(y2026.w2Jobs.map((w) => w.id)).toEqual(["w2_1"]);
    expect(y2027.estimatedPayments).toEqual([]);
  });

  it("yearly export puts a startup cost paid before the SE start in the year the business begins", () => {
    // Paid 2025-12-15, SE start 2026-02-01: it counts in 2026 (IRC §195(b)), so the 2026
    // accountant file carries it and the 2025 file doesn't. The full export is unchanged.
    const bundle = fullBundle();
    bundle.profile = { ...bundle.profile!, seStartDate: "2026-02-01" };
    bundle.expenses = [
      { ...bundle.expenses[0]!, id: "ex_startup", date: "2025-12-15", startupExpense: true },
    ];
    const rows = (year: number) =>
      parseCsv(exportBundle(bundle, { scope: "yearly", year })).bundle.expenses.map((e) => e.id);
    expect(rows(2026)).toEqual(["ex_startup"]);
    expect(rows(2025)).toEqual([]);
    expect(
      parseCsv(exportBundle(bundle, { scope: "full" })).bundle.expenses.map((e) => e.id),
    ).toEqual(["ex_startup"]);
  });

  it("yearly export notes the §195 amounts so the file reconciles with the app (review #65 r2)", () => {
    // $12,000 paid 2025-12-15, SE start 2026-03-02: 2026 deducts $5,388.89, 2027 $466.67.
    const bundle = fullBundle();
    bundle.profile = { ...bundle.profile!, seStartDate: "2026-03-02" };
    bundle.expenses = [
      {
        ...bundle.expenses[0]!,
        id: "ex_startup",
        date: "2025-12-15",
        amountCents: 1_200_000,
        startupExpense: true,
      },
    ];
    const y2026 = exportBundle(bundle, { scope: "yearly", year: 2026 });
    expect(y2026).toContain(
      "# Startup costs (Section 195): the startup rows below total $12000.00 paid before the business began on 2026-03-02; $5388.89 of it is deductible in 2026; the rest is amortized over 180 months (IRC 195(b)).",
    );
    const y2027 = exportBundle(bundle, { scope: "yearly", year: 2027 });
    expect(y2027).toContain(
      "# Startup costs (Section 195): $466.67 of the $12000.00 paid before the business began on 2026-03-02 is amortized in 2027 (IRC 195(b)); the startup rows are in the 2026 file.",
    );
    // No note where nothing is deducted, or in the full export.
    expect(exportBundle(bundle, { scope: "yearly", year: 2025 })).not.toContain("Section 195");
    expect(exportBundle(bundle, { scope: "full" })).not.toContain("Section 195");
    // The note is a comment: the yearly file still imports, with the startup row.
    const parsed = parseCsv(y2026);
    expect(parsed.validationErrors).toEqual([]);
    expect(parsed.bundle.expenses.map((e) => e.id)).toEqual(["ex_startup"]);
  });

  it("yearly export filters dated records to that year and includes spans that overlap", () => {
    const bundle = fullBundle();
    const csv = exportBundle(bundle, {
      scope: "yearly",
      year: 2026,
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
    });
    const { provenance } = parseCsv(csv);
    expect(provenance.scope).toBe("yearly");
    expect(provenance.year).toBe(2026);
    expect(provenance.schema).toBe("v6");
    expect(provenance.exportedAt).toBeUndefined();
  });

  it("Excel-style file with header comments is still parseable (comments stripped by importer)", () => {
    const bundle = fullBundle();
    const csv = exportBundle(bundle, {
      scope: "full",
    });
    // Simulate an extra rogue `#` line a user might have prepended.
    const dirtied = "# user note: please review\n" + csv;
    const { bundle: round, validationErrors } = parseCsv(dirtied);
    expect(validationErrors).toEqual([]);
    expect(round).toEqual(bundle);
  });
});

describe("document folders: one per default key per tax year (review #84 r3)", () => {
  it("a file with two folders sharing a year's default key is refused at parse, naming both rows", () => {
    const b = fullBundle();
    b.documentFolders = [
      b.documentFolders[0]!,
      { ...b.documentFolders[0]!, id: "df_2", name: "2026 copy" },
    ];
    const csv = exportBundle(b, { scope: "full" });
    const { validationErrors } = parseCsv(csv);
    const lines = csv.split("\r\n");
    const first = lines.findIndex((l) => l.startsWith("document_folder,2026,")) + 1;
    const second = lines.findIndex((l) => l.startsWith("document_folder,2026 copy,")) + 1;
    expect(validationErrors).toEqual([
      expect.objectContaining({
        line: second,
        message: `default_key: "year-root" for 2026 is also used on row ${first}. A tax year has one folder per default key`,
      }),
    ]);
  });

  it("the same key in different years, and folders with no key, are fine", () => {
    const b = fullBundle();
    b.documentFolders = [
      b.documentFolders[0]!,
      { ...b.documentFolders[0]!, id: "df_2", name: "2027", taxYear: 2027 },
      { ...b.documentFolders[0]!, id: "df_3", name: "Mine", defaultKey: null },
      { ...b.documentFolders[0]!, id: "df_4", name: "Mine too", defaultKey: null },
    ];
    expect(parseCsv(exportBundle(b, { scope: "full" })).validationErrors).toEqual([]);
  });
});
