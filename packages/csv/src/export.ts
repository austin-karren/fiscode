import Papa from "papaparse";
import { countedExpenseDate, isPreStartStartupCost, startupDeductionBetween } from "@fiscode/core";
import type { Bundle } from "./bundle-types.ts";
import { CSV_COLUMNS, type CsvRow, type RecordType } from "./schema.ts";
import { BOM, buildProvenance, EOL } from "./provenance.ts";
import {
  encodeCell,
  guardText,
  isStored,
  SECTIONS,
  type Lookup,
  type Section,
} from "./sections.ts";

const bool = (v: boolean | null | undefined): string => (v === true ? "1" : v === false ? "0" : "");
const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v);
const str = (v: string | null | undefined): string => v ?? "";

const blankRow = (): Record<string, string> =>
  Object.fromEntries(CSV_COLUMNS.map((c) => [c, ""])) as Record<string, string>;

const emit = (
  rt: RecordType,
  id: string,
  fields: Partial<Record<keyof CsvRow, string>>,
): Record<string, string> => ({
  ...blankRow(),
  record_type: rt,
  id,
  ...fields,
});

const bundleToRows = (bundle: Bundle): Record<string, string>[] => {
  const rows: Record<string, string>[] = [];
  if (bundle.profile) {
    const p = bundle.profile;
    rows.push(
      emit("profile", p.id, {
        filing_status: p.filingStatus,
        state: p.state,
        se_start_date: p.seStartDate,
        dependents: num(p.dependents),
        tracks_roth: bool(p.tracksRoth),
        uses_retirement: bool(p.usesRetirement),
        quarterly_method: p.quarterlyMethod,
        prep_lead_days: num(p.prepLeadDays),
        prior_year_total_tax_cents: num(p.priorYearTotalTaxCents),
        prior_year_agi_cents: num(p.priorYearAgiCents),
        prior_year_state_tax_cents: num(p.priorYearStateTaxCents),
        prior_year_figures_year: num(p.priorYearFiguresYear),
        prior_year_not_filed: bool(p.priorYearNotFiled),
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      }),
    );
  }
  for (const e of bundle.entities) {
    rows.push(
      emit("entity", e.id, {
        type: e.type,
        start_date: e.startDate,
        end_date: str(e.endDate),
        notes: str(e.notes),
        created_at: e.createdAt,
        updated_at: e.updatedAt,
        deleted_at: str(e.deletedAt),
      }),
    );
  }
  for (const s of bundle.spouses) {
    rows.push(
      emit("spouse", s.id, {
        start_date: s.startDate,
        end_date: str(s.endDate),
        annual_w2_wages_cents: num(s.annualW2WagesCents),
        annual_federal_withholding_cents: num(s.annualFederalWithholdingCents),
        annual_state_withholding_cents: num(s.annualStateWithholdingCents),
        notes: str(s.notes),
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        deleted_at: str(s.deletedAt),
      }),
    );
  }
  for (const c of bundle.clients) {
    rows.push(
      emit("client", c.id, {
        name: c.name,
        type: str(c.type),
        notes: str(c.notes),
        default_rate_cents: num(c.defaultRateCents),
        default_commission_rate_basis_points: num(c.defaultCommissionRate),
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        deleted_at: str(c.deletedAt),
      }),
    );
  }
  for (const i of bundle.income) {
    rows.push(
      emit("income", i.id, {
        date: i.date,
        client_id: str(i.clientId),
        amount_cents: num(i.amountCents),
        source_type: i.sourceType,
        kind: i.kind,
        description: str(i.description),
        notes: str(i.notes),
        created_at: i.createdAt,
        updated_at: i.updatedAt,
        deleted_at: str(i.deletedAt),
      }),
    );
  }
  for (const t of bundle.timeEntries) {
    rows.push(
      emit("time_entry", t.id, {
        date: t.date,
        client_id: str(t.clientId),
        minutes: num(t.minutes),
        description: str(t.description),
        notes: str(t.notes),
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        deleted_at: str(t.deletedAt),
      }),
    );
  }
  for (const v of bundle.vehicles) {
    rows.push(
      emit("vehicle", v.id, {
        make: v.make,
        model: v.model,
        year: num(v.year),
        mpg: num(v.mpg),
        method: v.method,
        in_service_date: str(v.inServiceDate),
        notes: str(v.notes),
        created_at: v.createdAt,
        updated_at: v.updatedAt,
        deleted_at: str(v.deletedAt),
      }),
    );
  }
  for (const m of bundle.mileage) {
    rows.push(
      emit("mileage", m.id, {
        date: m.date,
        vehicle_id: str(m.vehicleId),
        business_miles: num(m.businessMiles),
        purpose: str(m.purpose),
        notes: str(m.notes),
        created_at: m.createdAt,
        updated_at: m.updatedAt,
        deleted_at: str(m.deletedAt),
      }),
    );
  }
  for (const h of bundle.homeOffice) {
    rows.push(
      emit("home_office", h.id, {
        start_date: h.startDate,
        end_date: str(h.endDate),
        method: h.method,
        office_sqft: num(h.officeSqft),
        home_sqft: num(h.homeSqft),
        monthly_rent_mortgage_cents: num(h.monthlyRentMortgageCents),
        monthly_utilities_cents: num(h.monthlyUtilitiesCents),
        monthly_insurance_cents: num(h.monthlyInsuranceCents),
        regular_exclusive_ack: bool(h.regularExclusiveAck),
        notes: str(h.notes),
        created_at: h.createdAt,
        updated_at: h.updatedAt,
        deleted_at: str(h.deletedAt),
      }),
    );
  }
  for (const e of bundle.expenses) {
    rows.push(
      emit("expense", e.id, {
        date: e.date,
        amount_cents: num(e.amountCents),
        category: e.category,
        client_id: str(e.clientId),
        description: str(e.description),
        reason: str(e.reason),
        notes: str(e.notes),
        flag_for_section_179: bool(e.flagForSection179),
        startup_expense: bool(e.startupExpense),
        placed_in_service_date: str(e.placedInServiceDate),
        created_at: e.createdAt,
        updated_at: e.updatedAt,
        deleted_at: str(e.deletedAt),
      }),
    );
  }
  for (const w of bundle.w2Jobs) {
    rows.push(
      emit("w2_job", w.id, {
        tax_year: num(w.taxYear),
        employer: w.employer,
        start_date: str(w.startDate),
        end_date: str(w.endDate),
        wages_cents: num(w.wagesCents),
        federal_withholding_cents: num(w.federalWithholdingCents),
        ss_wages_cents: num(w.ssWagesCents),
        ss_tax_withheld_cents: num(w.ssTaxWithheldCents),
        medicare_wages_cents: num(w.medicareWagesCents),
        ss_tips_cents: num(w.ssTipsCents),
        state_wages_cents: num(w.stateWagesCents),
        state_withholding_cents: num(w.stateWithholdingCents),
        notes: str(w.notes),
        created_at: w.createdAt,
        updated_at: w.updatedAt,
        deleted_at: str(w.deletedAt),
      }),
    );
  }
  for (const p of bundle.estimatedPayments) {
    rows.push(
      emit("estimated_payment", p.id, {
        date: p.date,
        amount_cents: num(p.amountCents),
        jurisdiction: p.jurisdiction,
        tax_year: num(p.taxYear),
        applied_quarter: num(p.appliedQuarter),
        notes: str(p.notes),
        created_at: p.createdAt,
        updated_at: p.updatedAt,
        deleted_at: str(p.deletedAt),
      }),
    );
  }
  for (const f of bundle.documentFolders) {
    rows.push(
      emit("document_folder", f.id, {
        name: f.name,
        parent_id: str(f.parentId),
        tax_year: num(f.taxYear),
        sort_order: num(f.sortOrder),
        created_at: f.createdAt,
        updated_at: f.updatedAt,
        deleted_at: str(f.deletedAt),
      }),
    );
  }
  for (const d of bundle.documents) {
    rows.push(
      emit("document", d.id, {
        name: d.name,
        folder_id: str(d.folderId),
        mime: d.mime,
        size_bytes: num(d.sizeBytes),
        sha256: d.sha256,
        added_at: d.addedAt,
        notes: str(d.notes),
        created_at: d.createdAt,
        updated_at: d.updatedAt,
        deleted_at: str(d.deletedAt),
      }),
    );
  }
  for (const l of bundle.documentLinks) {
    rows.push(
      emit("document_link", l.id, {
        document_id: l.documentId,
        linked_record_type: l.recordType,
        linked_record_id: l.recordId,
        created_at: l.createdAt,
        updated_at: l.updatedAt,
        deleted_at: str(l.deletedAt),
      }),
    );
  }
  for (const r of bundle.retirementContributions) {
    rows.push(
      emit("retirement_contribution", r.id, {
        date: r.date,
        account: r.account,
        amount_cents: num(r.amountCents),
        notes: str(r.notes),
        created_at: r.createdAt,
        updated_at: r.updatedAt,
        deleted_at: str(r.deletedAt),
      }),
    );
  }
  for (const h of bundle.history) {
    rows.push(
      emit("history", h.id, {
        at: h.at,
        entity: h.entity,
        entity_id: h.entityId,
        op: h.op,
        before_json: str(h.beforeJson),
        after_json: str(h.afterJson),
      }),
    );
  }
  return rows;
};

export type ExportOptions = {
  scope: "full" | "yearly";
  year?: number;
};

// Plain code-unit comparison: the same on every machine, unlike localeCompare.
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Row order inside a section: by date (or span start, or the time of a
 * history entry), then by id. Tables
 * without a date (clients, vehicles) are in id order, which for the app's
 * ULIDs is creation order. The export sorts for itself so the bytes depend
 * only on the rows, not on the order the database or an imported file
 * happened to hand them over in.
 */
const byRowOrder = (a: Record<string, string>, b: Record<string, string>): number => {
  const key = (r: Record<string, string>) => r.date || r.start_date || r.at || "";
  return compare(key(a), key(b)) || compare(a.id ?? "", b.id ?? "");
};

const filterYearly = (bundle: Bundle, year: number): Bundle => {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const within = (date: string) => date >= yearStart && date <= yearEnd;
  const spanOverlapsYear = (start: string, end: string | null): boolean => {
    if (start > yearEnd) return false;
    if (end !== null && end < yearStart) return false;
    return true;
  };
  // The yearly file is for an accountant, not a backup. Someone who sums its
  // amount column must get the same total the app shows, so deleted rows stay
  // out, as does the edit log. The full export carries both. One exception:
  // §195 startup costs (paid before the SE start) appear at their full amount in
  // the year the business begins, while the year's deduction is limited and the
  // rest amortized; a `#` note above the expenses (`startupNote`) gives both
  // amounts so the file reconciles with the app.
  const live = <T extends { deletedAt: string | null }>(rows: T[]): T[] =>
    rows.filter((r) => r.deletedAt === null);
  return {
    ...bundle,
    clients: live(bundle.clients),
    vehicles: live(bundle.vehicles),
    income: live(bundle.income).filter((r) => within(r.date)),
    timeEntries: live(bundle.timeEntries).filter((r) => within(r.date)),
    mileage: live(bundle.mileage).filter((r) => within(r.date)),
    // By the date each expense counts on: a startup cost paid before the SE start
    // belongs to the year the business begins (IRC §195(b)), not the year it was paid.
    expenses: live(bundle.expenses).filter((r) =>
      within(countedExpenseDate(r, bundle.profile?.seStartDate)),
    ),
    retirementContributions: live(bundle.retirementContributions).filter((r) => within(r.date)),
    // By the year each is for, not its date: a January payment is the prior year's Q4.
    w2Jobs: live(bundle.w2Jobs).filter((r) => r.taxYear === year),
    estimatedPayments: live(bundle.estimatedPayments).filter((r) => r.taxYear === year),
    // Documents are a full backup's: a yearly file is for an accountant, and the rows are no use
    // without the files.
    documentFolders: [],
    documents: [],
    documentLinks: [],
    entities: live(bundle.entities).filter((r) => spanOverlapsYear(r.startDate, r.endDate)),
    spouses: live(bundle.spouses).filter((r) => spanOverlapsYear(r.startDate, r.endDate)),
    homeOffice: live(bundle.homeOffice).filter((r) => spanOverlapsYear(r.startDate, r.endDate)),
    history: [],
  };
};

/**
 * Write a bundle as CSV. The output is a pure function of the rows and the
 * scope: no clock, no locale, no machine detail. Two exports of the same
 * state are the same bytes. Soft-deleted rows are written like any other,
 * with their `deleted_at`.
 */
export const exportBundle = (bundle: Bundle, options: ExportOptions): string => {
  const filtered =
    options.scope === "yearly" && options.year !== undefined
      ? filterYearly(bundle, options.year)
      : bundle;
  const rows = bundleToRows(filtered);
  const lookup: Lookup = {
    // Names come from the unfiltered bundle: a live income row still names
    // its client when that client is deleted or left out of the yearly file.
    clientNames: new Map(bundle.clients.map((c) => [c.id, c.name])),
    vehicleNames: new Map(
      bundle.vehicles.map((v) => [
        v.id,
        [v.year === null ? "" : String(v.year), v.make, v.model].filter(Boolean).join(" "),
      ]),
    ),
  };
  let out = BOM + buildProvenance(options);
  const note =
    options.scope === "yearly" && options.year !== undefined
      ? startupNote(bundle, options.year)
      : undefined;
  for (const section of SECTIONS) {
    if (note && section.recordType === "expense") out += note + EOL;
    const sectionRows = rows.filter((r) => r.record_type === section.recordType).sort(byRowOrder);
    // Deleted rows get a table of their own, after the live one and titled so
    // nobody adds them up. The importer reads it like any other table: the
    // title is a comment and the rows carry their `deleted_at`.
    const live = sectionRows.filter((r) => !r.deleted_at);
    const deleted = sectionRows.filter((r) => r.deleted_at);
    out += writeTable(section, section.title, live, lookup);
    out += writeTable(section, `${section.title}${DELETED_TITLE_SUFFIX}`, deleted, lookup);
  }
  return out;
};

/**
 * Appended to a section title for the table that holds its deleted rows. No
 * comma: a title is one cell, and a comma would split it in two.
 */
export const DELETED_TITLE_SUFFIX = " (deleted - not part of your books)";

/** One titled table as CSV text, or nothing when it has no rows. */
const writeTable = (
  section: Section,
  title: string,
  sectionRows: Record<string, string>[],
  lookup: Lookup,
): string => {
  if (sectionRows.length === 0) return "";
  const table = [
    section.columns.map((c) => c.name),
    ...sectionRows.map((row) =>
      section.columns.map((c) => {
        try {
          return isStored(c) ? encodeCell(c, row[c.key] ?? "") : guardText(c.derive(row, lookup));
        } catch (cause) {
          // Name the row so the user can find and fix it in the app.
          const why = cause instanceof Error ? cause.message : String(cause);
          throw new Error(`Cannot export ${section.recordType} row ${row.id}: ${why}`, { cause });
        }
      }),
    ),
  ];
  // Papa quotes any cell holding a comma, a quote, a line break or outer
  // spaces, and doubles inner quotes (RFC 4180).
  return EOL + `# ${title}` + EOL + Papa.unparse(table, { newline: EOL }) + EOL;
};

/**
 * The download name for an export. The yearly file is the one handed to an
 * accountant; the full file is a dated backup. `today` is ISO `YYYY-MM-DD`.
 */
export const exportFileName = (
  options: Pick<ExportOptions, "scope" | "year">,
  today: string,
): string =>
  options.scope === "yearly" && options.year !== undefined
    ? `fiscode-${options.year}-tax-year.csv`
    : `fiscode-full-backup-${today}.csv`;

const dollarsText = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * The yearly file's note on §195 startup costs, or undefined when none is
 * deducted in `year`. Written as a `#` comment line (the importer skips those),
 * with no commas so a spreadsheet keeps it in one cell. In the year the business
 * begins the startup rows are in the file at their full amount; in later years
 * only the amortization is deducted and no startup row is in the file.
 */
const startupNote = (bundle: Bundle, year: number): string | undefined => {
  const seStart = bundle.profile?.seStartDate;
  if (!seStart) return undefined;
  const total = bundle.expenses
    .filter((e) => isPreStartStartupCost(e, seStart))
    .reduce((sum, e) => sum + e.amountCents, 0);
  const deducted = startupDeductionBetween(
    bundle.expenses,
    seStart,
    `${year}-01-01`,
    `${year}-12-31`,
  );
  if (total === 0 || deducted === 0) return undefined;
  const startYear = seStart.slice(0, 4);
  return startYear === String(year)
    ? `# Startup costs (Section 195): the startup rows below total ${dollarsText(total)} paid before the business began on ${seStart}; ${dollarsText(deducted)} of it is deductible in ${year}; the rest is amortized over 180 months (IRC 195(b)).`
    : `# Startup costs (Section 195): ${dollarsText(deducted)} of the ${dollarsText(total)} paid before the business began on ${seStart} is amortized in ${year} (IRC 195(b)); the startup rows are in the ${startYear} file.`;
};

export { bundleToRows };
