import Papa from "papaparse";
import {
  type Bundle,
  emptyBundle,
  type ClientRow,
  type EntityRow,
  type ExpenseRow,
  type HomeOfficeRow,
  type IncomeRow,
  type MileageRow,
  type ProfileRow,
  type RetirementContributionRow,
  type SpouseRow,
  type TimeEntryRow,
  type VehicleRow,
} from "./bundle-types.ts";
import { csvRowSchema, type CsvRow } from "./schema.ts";
import { parseProvenance, type Provenance } from "./provenance.ts";

const num = (v: string | undefined, fallback = 0): number => {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const numOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const strOrNull = (v: string | undefined): string | null =>
  v === undefined || v === "" ? null : v;

const bool = (v: string | undefined): boolean => v === "1";

const rowToBundle = (rows: CsvRow[]): Bundle => {
  const b = emptyBundle();
  for (const r of rows) {
    switch (r.record_type) {
      case "profile":
        b.profile = {
          id: r.id,
          filingStatus: r.filing_status ?? "single",
          state: r.state ?? "UT",
          seStartDate: r.se_start_date ?? "",
          dependents: num(r.dependents),
          tracksRoth: bool(r.tracks_roth),
          usesRetirement: bool(r.uses_retirement),
          quarterlyMethod: r.quarterly_method ?? "annualized",
          prepLeadDays: num(r.prep_lead_days, 14),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
        } satisfies ProfileRow;
        break;
      case "entity":
        b.entities.push({
          id: r.id,
          type: r.type ?? "sole_prop",
          startDate: r.start_date ?? "",
          endDate: strOrNull(r.end_date),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies EntityRow);
        break;
      case "spouse":
        b.spouses.push({
          id: r.id,
          startDate: r.start_date ?? "",
          endDate: strOrNull(r.end_date),
          annualW2WagesCents: num(r.annual_w2_wages_cents),
          annualFederalWithholdingCents: num(r.annual_federal_withholding_cents),
          annualStateWithholdingCents: num(r.annual_state_withholding_cents),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies SpouseRow);
        break;
      case "client":
        b.clients.push({
          id: r.id,
          name: r.name ?? "",
          type: strOrNull(r.type),
          notes: strOrNull(r.notes),
          defaultRateCents: numOrNull(r.default_rate_cents),
          defaultCommissionRate: numOrNull(r.default_commission_rate_basis_points),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies ClientRow);
        break;
      case "income":
        b.income.push({
          id: r.id,
          date: r.date ?? "",
          clientId: strOrNull(r.client_id),
          amountCents: num(r.amount_cents),
          sourceType: r.source_type ?? "1099",
          kind: r.kind ?? "recurring",
          description: strOrNull(r.description),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies IncomeRow);
        break;
      case "time_entry":
        b.timeEntries.push({
          id: r.id,
          date: r.date ?? "",
          clientId: strOrNull(r.client_id),
          minutes: num(r.minutes),
          description: strOrNull(r.description),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies TimeEntryRow);
        break;
      case "vehicle":
        b.vehicles.push({
          id: r.id,
          make: r.make ?? "",
          model: r.model ?? "",
          year: numOrNull(r.year),
          mpg: numOrNull(r.mpg),
          method: r.method ?? "standard_mileage",
          inServiceDate: strOrNull(r.in_service_date),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies VehicleRow);
        break;
      case "mileage":
        b.mileage.push({
          id: r.id,
          date: r.date ?? "",
          vehicleId: strOrNull(r.vehicle_id),
          businessMiles: num(r.business_miles),
          purpose: strOrNull(r.purpose),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies MileageRow);
        break;
      case "home_office":
        b.homeOffice.push({
          id: r.id,
          startDate: r.start_date ?? "",
          endDate: strOrNull(r.end_date),
          method: r.method ?? "simplified",
          officeSqft: numOrNull(r.office_sqft),
          homeSqft: numOrNull(r.home_sqft),
          monthlyRentMortgageCents: numOrNull(r.monthly_rent_mortgage_cents),
          monthlyUtilitiesCents: numOrNull(r.monthly_utilities_cents),
          monthlyInsuranceCents: numOrNull(r.monthly_insurance_cents),
          regularExclusiveAck: bool(r.regular_exclusive_ack),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies HomeOfficeRow);
        break;
      case "expense":
        b.expenses.push({
          id: r.id,
          date: r.date ?? "",
          amountCents: num(r.amount_cents),
          category: r.category ?? "other",
          clientId: strOrNull(r.client_id),
          description: strOrNull(r.description),
          reason: strOrNull(r.reason),
          notes: strOrNull(r.notes),
          flagForSection179: bool(r.flag_for_section_179),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies ExpenseRow);
        break;
      case "retirement_contribution":
        b.retirementContributions.push({
          id: r.id,
          date: r.date ?? "",
          account: r.account ?? "",
          amountCents: num(r.amount_cents),
          notes: strOrNull(r.notes),
          createdAt: r.created_at ?? "",
          updatedAt: r.updated_at ?? "",
          deletedAt: strOrNull(r.deleted_at),
        } satisfies RetirementContributionRow);
        break;
    }
  }
  return b;
};

export type ImportResult = {
  bundle: Bundle;
  provenance: Partial<Provenance>;
  validationErrors: Array<{ rowIndex: number; message: string }>;
};

export const parseCsv = (raw: string): ImportResult => {
  const { body, provenance } = parseProvenance(raw);
  const parsed = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: true,
    // Belt-and-suspenders in case provenance was already stripped externally
    // or the file is from a future schema with `#` data lines.
    comments: "#",
  });
  const validationErrors: ImportResult["validationErrors"] = [];
  const validated: CsvRow[] = [];
  for (let i = 0; i < parsed.data.length; i++) {
    const result = csvRowSchema.safeParse(parsed.data[i]);
    if (result.success) {
      validated.push(result.data);
    } else {
      validationErrors.push({
        rowIndex: i,
        message: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
      });
    }
  }
  const bundle = rowToBundle(validated);
  // Post-pass invariants. se_start_date is required by the DB schema and
  // by the tax-engine SE-range filter; an empty value silently disables
  // the filter (every date is lexically > "") and would import without
  // complaint. Fail loudly here instead.
  if (bundle.profile && !bundle.profile.seStartDate) {
    validationErrors.push({
      rowIndex: -1,
      message: "profile.se_start_date is required but missing or empty",
    });
  }
  return { bundle, provenance, validationErrors };
};

export { rowToBundle };
