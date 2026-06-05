import { addCents, cents, dollars, type Cents, yearOf } from "@fiscode/core";
import type { Bundle } from "@fiscode/csv";
import type { AnnualizedInput, TaxInput } from "@fiscode/tax";
import { getYearConfig } from "@fiscode/tax";

type ActiveSpouse = {
  annualW2WagesCents: number;
  annualFederalWithholdingCents: number;
  annualStateWithholdingCents: number;
};

const sumWithinYear = (
  rows: Array<{ date: string; amountCents: number; deletedAt: string | null }>,
  year: number,
): Cents =>
  rows
    .filter((r) => r.deletedAt === null && yearOf(r.date as never) === year)
    .reduce((sum, r) => addCents(sum, cents(r.amountCents)), cents(0));

const sumMileageDeductionWithinYear = (bundle: Bundle, year: number): Cents => {
  const cfg = getYearConfig(year);
  const totalMiles = bundle.mileage
    .filter((m) => m.deletedAt === null && yearOf(m.date as never) === year)
    .reduce((acc, m) => acc + m.businessMiles, 0);
  return dollars(totalMiles * cfg.mileageRatePerMile);
};

const sumHomeOfficeWithinYear = (bundle: Bundle, year: number): Cents => {
  const cfg = getYearConfig(year);
  const activeForYear = bundle.homeOffice.filter(
    (h) => h.deletedAt === null && h.startDate.slice(0, 4) <= String(year),
  );
  // Simplified method only for now. Pro-rate across months active in-year.
  const hoVal = activeForYear.reduce((acc, h) => {
    if (h.method !== "simplified") return acc;
    const sqft = Math.min(h.officeSqft ?? 0, cfg.homeOffice.simplifiedMaxSqft);
    const monthsActive = monthsActiveIn(year, h.startDate, h.endDate);
    if (sqft <= 0 || monthsActive <= 0) return acc;
    const annual = sqft * cfg.homeOffice.simplifiedRatePerSqft;
    const prorated = Math.round((annual * monthsActive) / 12);
    return Math.min(cfg.homeOffice.simplifiedCap, acc + prorated) as Cents;
  }, cents(0));
  return hoVal;
};

const monthsActiveIn = (year: number, start: string, end: string | null): number => {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  if (start > yEnd) return 0;
  if (end !== null && end < yStart) return 0;
  const effStart = start > yStart ? start : yStart;
  const effEnd = end === null || end > yEnd ? yEnd : end;
  const sm = Number(effStart.slice(5, 7));
  const em = Number(effEnd.slice(5, 7));
  return em - sm + 1;
};

const activeSpouseFor = (bundle: Bundle, year: number): ActiveSpouse | undefined => {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  const match = bundle.spouses.find(
    (s) =>
      s.deletedAt === null && s.startDate <= yEnd && (s.endDate === null || s.endDate >= yStart),
  );
  return match;
};

const activeEntityFor = (bundle: Bundle, year: number) => {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  return bundle.entities.find(
    (e) =>
      e.deletedAt === null && e.startDate <= yEnd && (e.endDate === null || e.endDate >= yStart),
  );
};

export type DerivedYear = {
  gross1099: Cents;
  directExpenses: Cents;
  mileageDeduction: Cents;
  homeOfficeDeduction: Cents;
  totalDeductibleExpenses: Cents;
  activeEntityType: string;
};

export const deriveYear = (bundle: Bundle, year: number): DerivedYear => {
  const gross1099 = sumWithinYear(
    bundle.income.filter((i) => i.sourceType === "1099"),
    year,
  );
  const directExpenses = sumWithinYear(bundle.expenses, year);
  const mileageDeduction = sumMileageDeductionWithinYear(bundle, year);
  const homeOfficeDeduction = sumHomeOfficeWithinYear(bundle, year);
  const total = addCents(directExpenses, mileageDeduction, homeOfficeDeduction);
  return {
    gross1099,
    directExpenses,
    mileageDeduction,
    homeOfficeDeduction,
    totalDeductibleExpenses: total,
    activeEntityType: activeEntityFor(bundle, year)?.type ?? "sole_prop",
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
  const endsDates: Array<{ q: 1 | 2 | 3 | 4; ends: string }> = [
    { q: 1, ends: `${year}-03-31` },
    { q: 2, ends: `${year}-05-31` },
    { q: 3, ends: `${year}-08-31` },
    { q: 4, ends: `${year}-12-31` },
  ];
  const cumulative = (cutoff: string) => {
    const yStart = `${year}-01-01`;
    const incomeRows = bundle.income.filter(
      (r) =>
        r.deletedAt === null && r.sourceType === "1099" && r.date >= yStart && r.date <= cutoff,
    );
    const expRows = bundle.expenses.filter(
      (r) => r.deletedAt === null && r.date >= yStart && r.date <= cutoff,
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
