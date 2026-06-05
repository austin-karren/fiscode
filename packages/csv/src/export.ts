import Papa from "papaparse";
import type { Bundle } from "./bundle-types.ts";
import { CSV_COLUMNS, type CsvRow, type RecordType } from "./schema.ts";
import { buildProvenance, type Provenance } from "./provenance.ts";

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
        created_at: e.createdAt,
        updated_at: e.updatedAt,
        deleted_at: str(e.deletedAt),
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
  return rows;
};

export type ExportOptions = {
  scope: "full" | "yearly";
  year?: number;
  exportedAt?: string; // testing seam
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
  return {
    ...bundle,
    income: bundle.income.filter((r) => within(r.date)),
    timeEntries: bundle.timeEntries.filter((r) => within(r.date)),
    mileage: bundle.mileage.filter((r) => within(r.date)),
    expenses: bundle.expenses.filter((r) => within(r.date)),
    retirementContributions: bundle.retirementContributions.filter((r) => within(r.date)),
    entities: bundle.entities.filter((r) => spanOverlapsYear(r.startDate, r.endDate)),
    spouses: bundle.spouses.filter((r) => spanOverlapsYear(r.startDate, r.endDate)),
    homeOffice: bundle.homeOffice.filter((r) => spanOverlapsYear(r.startDate, r.endDate)),
  };
};

export const exportBundle = (bundle: Bundle, options: ExportOptions): string => {
  const filtered =
    options.scope === "yearly" && options.year !== undefined
      ? filterYearly(bundle, options.year)
      : bundle;
  const rows = bundleToRows(filtered);
  const provenance: Provenance = {
    scope: options.scope,
    year: options.year,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
  };
  const header = buildProvenance(provenance);
  const csv = Papa.unparse(
    {
      fields: CSV_COLUMNS as unknown as string[],
      data: rows,
    },
    { quotes: false, header: true, newline: "\n" },
  );
  return header + csv + "\n";
};

export { bundleToRows };
