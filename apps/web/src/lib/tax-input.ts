import { addCents, cents, dollars, type Cents, yearOf } from "@fiscode/core";
import type { Bundle } from "@fiscode/csv";
import type { AnnualizedInput, TaxInput } from "@fiscode/tax";
import { getYearConfig } from "@fiscode/tax";

type ActiveSpouse = {
  annualW2WagesCents: number;
  annualFederalWithholdingCents: number;
  annualStateWithholdingCents: number;
};

// A row counts toward the year iff it lands in the calendar year AND on or
// after the user's self-employment start date. Pre-SE rows are excluded
// from the tax estimate but stay in the user's data; the dashboard surfaces
// the excluded count so the discrepancy isn't silent. An empty seStartDate
// (legacy data, manual SQL edits, broken imports) is treated as "no filter"
// rather than "everything passes" — the previous `date >= ""` semantics
// happened to do the right thing for lexical ISO dates but is fragile.
const inSeRange = (date: string, seStartDate: string, year: number): boolean => {
  const floor = seStartDate || `${year}-01-01`;
  return yearOf(date as never) === year && date >= floor;
};

const sumWithinYear = (
  rows: Array<{ date: string; amountCents: number; deletedAt: string | null }>,
  year: number,
  seStartDate: string,
): Cents =>
  rows
    .filter((r) => r.deletedAt === null && inSeRange(r.date, seStartDate, year))
    .reduce((sum, r) => addCents(sum, cents(r.amountCents)), cents(0));

const sumMileageDeductionWithinYear = (
  bundle: Bundle,
  year: number,
  seStartDate: string,
): Cents => {
  const cfg = getYearConfig(year);
  const totalMiles = bundle.mileage
    .filter((m) => m.deletedAt === null && inSeRange(m.date, seStartDate, year))
    .reduce((acc, m) => acc + m.businessMiles, 0);
  return dollars(totalMiles * cfg.mileageRatePerMile);
};

const sumHomeOfficeWithinYear = (bundle: Bundle, year: number, seStartDate: string): Cents => {
  const cfg = getYearConfig(year);
  const activeForYear = bundle.homeOffice.filter(
    (h) => h.deletedAt === null && h.startDate.slice(0, 4) <= String(year),
  );
  // Simplified method only for now. Pro-rate across months active in-year,
  // clamping the effective start to seStartDate so home-office periods that
  // pre-date the SE start don't pad the deduction.
  const hoVal = activeForYear.reduce((acc, h) => {
    if (h.method !== "simplified") return acc;
    const sqft = Math.min(h.officeSqft ?? 0, cfg.homeOffice.simplifiedMaxSqft);
    const monthsActive = monthsActiveIn(year, h.startDate, h.endDate, seStartDate);
    if (sqft <= 0 || monthsActive <= 0) return acc;
    const annual = sqft * cfg.homeOffice.simplifiedRatePerSqft;
    const prorated = Math.round((annual * monthsActive) / 12);
    return Math.min(cfg.homeOffice.simplifiedCap, acc + prorated) as Cents;
  }, cents(0));
  return hoVal;
};

// Returns a fractional month count (active-day-count / year-days * 12)
// for the home-office simplified deduction. Day-count proration matches
// what an accountant does for partial-year periods — the previous
// month-number subtraction over-credited any month containing even one
// active day. With the new SE-start clamp, mid-month boundaries are
// common, so the bucket math became materially wrong.
const monthsActiveIn = (
  year: number,
  start: string,
  end: string | null,
  seStartDate: string,
): number => {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  if (start > yEnd) return 0;
  if (end !== null && end < yStart) return 0;
  const lowerBound = (seStartDate || yStart) > yStart ? seStartDate || yStart : yStart;
  const effStart = start > lowerBound ? start : lowerBound;
  const effEnd = end === null || end > yEnd ? yEnd : end;
  if (effStart > effEnd) return 0;
  const activeDays = daysBetweenInclusive(effStart, effEnd);
  const yearDays = isLeapYear(year) ? 366 : 365;
  return (activeDays / yearDays) * 12;
};

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysBetweenInclusive = (startIso: string, endIso: string): number => {
  // ISO YYYY-MM-DD; parse as UTC midnight on both sides so the diff is in
  // whole UTC days regardless of the runtime timezone. +1 because the
  // range is inclusive of both endpoints (e.g. Mar 31 → Mar 31 = 1 day).
  const ms = Date.UTC(...isoParts(endIso)) - Date.UTC(...isoParts(startIso));
  return Math.round(ms / 86_400_000) + 1;
};

const isoParts = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.split("-").map(Number);
  return [y!, (m ?? 1) - 1, d ?? 1];
};

// Pick the LATEST overlapping row, not the earliest. Bundle arrays are
// sorted by startDate ASC (`makeCrudRepo` orderBy default), so a naive
// `.find()` would return the oldest entity/spouse that overlaps the year
// — wrong for mid-year switches (sole_prop Jan–Jun then S-corp Jul–Dec
// returns sole_prop for the whole year). Sort matches by startDate DESC
// and take the first.
const latestOverlap = <
  T extends { startDate: string; endDate: string | null; deletedAt: string | null },
>(
  rows: T[],
  year: number,
): T | undefined => {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  const matches = rows.filter(
    (r) =>
      r.deletedAt === null && r.startDate <= yEnd && (r.endDate === null || r.endDate >= yStart),
  );
  if (matches.length === 0) return undefined;
  // Sort DESC by startDate (string compare works for ISO YYYY-MM-DD).
  matches.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  return matches[0];
};

const activeSpouseFor = (bundle: Bundle, year: number): ActiveSpouse | undefined =>
  latestOverlap(bundle.spouses, year);

const activeEntityFor = (bundle: Bundle, year: number) => latestOverlap(bundle.entities, year);

// Counts of rows that fall in the calendar year but pre-date the user's
// SE start date. Used by the dashboard banner so the user knows something
// they entered isn't being counted.
export type ExcludedBeforeSeStart = {
  income: number;
  expense: number;
  mileage: number;
};

const countExcludedBeforeSeStart = (
  bundle: Bundle,
  year: number,
  seStartDate: string,
): ExcludedBeforeSeStart => {
  const inYear = (d: string) => yearOf(d as never) === year;
  const isExcluded = (d: string) => inYear(d) && d < seStartDate;
  return {
    income: bundle.income.filter(
      (i) => i.deletedAt === null && i.sourceType === "1099" && isExcluded(i.date),
    ).length,
    expense: bundle.expenses.filter((e) => e.deletedAt === null && isExcluded(e.date)).length,
    mileage: bundle.mileage.filter((m) => m.deletedAt === null && isExcluded(m.date)).length,
  };
};

export type DerivedYear = {
  gross1099: Cents;
  directExpenses: Cents;
  mileageDeduction: Cents;
  homeOfficeDeduction: Cents;
  totalDeductibleExpenses: Cents;
  activeEntityType: string;
  seStartDate: string;
  excludedBeforeSeStart: ExcludedBeforeSeStart;
};

export const deriveYear = (bundle: Bundle, year: number): DerivedYear => {
  // Floor at Jan 1 of the year if no profile — defensive; buildTaxInput
  // throws on missing profile anyway, but deriveYear is also called for
  // read-only dashboard display.
  const seStartDate = bundle.profile?.seStartDate ?? `${year}-01-01`;
  const gross1099 = sumWithinYear(
    bundle.income.filter((i) => i.sourceType === "1099"),
    year,
    seStartDate,
  );
  const directExpenses = sumWithinYear(bundle.expenses, year, seStartDate);
  const mileageDeduction = sumMileageDeductionWithinYear(bundle, year, seStartDate);
  const homeOfficeDeduction = sumHomeOfficeWithinYear(bundle, year, seStartDate);
  const total = addCents(directExpenses, mileageDeduction, homeOfficeDeduction);
  return {
    gross1099,
    directExpenses,
    mileageDeduction,
    homeOfficeDeduction,
    totalDeductibleExpenses: total,
    activeEntityType: activeEntityFor(bundle, year)?.type ?? "sole_prop",
    seStartDate,
    excludedBeforeSeStart: countExcludedBeforeSeStart(bundle, year, seStartDate),
  };
};

/** Build a TaxInput suitable for `estimateYear` from the current bundle. */
export const buildTaxInput = (bundle: Bundle, year: number): TaxInput => {
  const profile = bundle.profile;
  if (!profile) throw new Error("buildTaxInput: profile is required");
  const derived = deriveYear(bundle, year);
  const spouse = activeSpouseFor(bundle, year);
  return {
    year,
    filingStatus: profile.filingStatus as TaxInput["filingStatus"],
    state: profile.state as TaxInput["state"],
    gross1099: derived.gross1099,
    deductibleExpenses: derived.totalDeductibleExpenses,
    spouseW2Wages: cents(spouse?.annualW2WagesCents ?? 0),
    spouseFederalWithholding: cents(spouse?.annualFederalWithholdingCents ?? 0),
    spouseStateWithholding: cents(spouse?.annualStateWithholdingCents ?? 0),
    priorYearTotalTax: undefined,
    priorYearAgi: undefined,
  };
};

/** Cumulative period bundles for annualized installments. */
export const buildAnnualizedInput = (bundle: Bundle, year: number): AnnualizedInput => {
  const base = buildTaxInput(bundle, year);
  const seStartDate = bundle.profile?.seStartDate ?? `${year}-01-01`;
  const endsDates: Array<{ q: 1 | 2 | 3 | 4; ends: string }> = [
    { q: 1, ends: `${year}-03-31` },
    { q: 2, ends: `${year}-05-31` },
    { q: 3, ends: `${year}-08-31` },
    { q: 4, ends: `${year}-12-31` },
  ];
  const cumulative = (cutoff: string) => {
    const yStart = `${year}-01-01`;
    // Same SE-start gate as deriveYear so cumulative totals reflect what
    // the engine will actually count.
    const lower = seStartDate > yStart ? seStartDate : yStart;
    const incomeRows = bundle.income.filter(
      (r) => r.deletedAt === null && r.sourceType === "1099" && r.date >= lower && r.date <= cutoff,
    );
    const expRows = bundle.expenses.filter(
      (r) => r.deletedAt === null && r.date >= lower && r.date <= cutoff,
    );
    const cumGross = incomeRows.reduce((acc, r) => addCents(acc, cents(r.amountCents)), cents(0));
    const cumExp = expRows.reduce((acc, r) => addCents(acc, cents(r.amountCents)), cents(0));
    return { cumGross, cumExp };
  };
  const periods = endsDates.map((e) => {
    const c = cumulative(e.ends);
    return {
      endsAt: e.ends as never,
      cumulativeGross1099: c.cumGross,
      cumulativeDeductibleExpenses: c.cumExp,
    };
  }) as unknown as AnnualizedInput["periods"];
  return { ...base, periods };
};
