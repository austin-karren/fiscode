import { addCents, cents, expensesCountedForYear, type Cents, yearOf } from "@fiscode/core";
import type { Bundle } from "@fiscode/csv";
import type { AnnualizedInput, TaxInput } from "@fiscode/tax";
import {
  actualHomeOfficeExpenses,
  getYearConfig,
  limitToTentativeProfit,
  mileageDeduction,
} from "@fiscode/tax";

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

/**
 * The rows that count toward `year`: live, dated in the year, and on or after
 * the SE start. The income and mileage totals are sums over these, and the
 * year-end packet lists the same rows.
 */
export const countedInYear = <T extends { date: string; deletedAt: string | null }>(
  rows: readonly T[],
  year: number,
  seStartDate: string,
): T[] => rows.filter((r) => r.deletedAt === null && inSeRange(r.date, seStartDate, year));

const sumWithinYear = (
  rows: Array<{ date: string; amountCents: number; deletedAt: string | null }>,
  year: number,
  seStartDate: string,
): Cents =>
  countedInYear(rows, year, seStartDate).reduce(
    (sum, r) => addCents(sum, cents(r.amountCents)),
    cents(0),
  );

// Which expenses count (startup expenses before the SE start included) is
// `expensesCountedForYear` in @fiscode/core, shared with the year-end packet.
const sumExpensesWithinYear = (
  rows: Array<{
    date: string;
    amountCents: number;
    deletedAt: string | null;
    startupExpense?: boolean;
  }>,
  year: number,
  seStartDate: string,
): Cents =>
  expensesCountedForYear(rows, year, seStartDate).reduce(
    (sum, r) => addCents(sum, cents(r.amountCents)),
    cents(0),
  );

// `through` (inclusive) limits the sums to an annualization period's end;
// left out, they cover the whole year.
const sumMileageDeductionWithinYear = (
  bundle: Bundle,
  year: number,
  seStartDate: string,
  through = `${year}-12-31`,
): Cents => {
  const cfg = getYearConfig(year);
  // Each trip at the rate in force on its date (2026 changed on July 1).
  return mileageDeduction(
    bundle.mileage.filter(
      (m) => m.deletedAt === null && inSeRange(m.date, seStartDate, year) && m.date <= through,
    ),
    cfg,
  );
};

// One home-office config's amount before the gross income limit, over the
// days it owns.
type HomeOfficePiece = {
  method: "simplified" | "actual";
  amount: Cents;
  /** The days this config owns: [from, to], inclusive ISO dates. */
  from: string;
  to: string;
};

// The configs that deduct something, each with the days it owns within the
// year (through `through`, not before the SE start), and its amount prorated
// over exactly those days. One source of owned days for the amount and the
// profit window:
// - Where two configs overlap, the later start owns the shared days (a move
//   entered as "ends Jul 1" and "starts Jul 1" gives Jul 1 to the new home;
//   an overlap of any kind is treated as a move to the later config).
// - A config that deducts nothing (no area, no costs, or an office larger
//   than the home) owns no days.
const homeOfficePieces = (
  bundle: Bundle,
  year: number,
  seStartDate: string,
  through: string,
): { pieces: HomeOfficePiece[]; areaRejected: number } => {
  const cfg = getYearConfig(year);
  const yearDays = isLeapYear(year) ? 366 : 365;
  let areaRejected = 0;
  const candidates: Array<{ h: Bundle["homeOffice"][number]; from: string; to: string }> = [];
  for (const h of bundle.homeOffice) {
    if (h.deletedAt !== null) continue;
    const window = activeWindow(year, h.startDate, h.endDate, seStartDate, through);
    if (!window) continue;
    if (h.method === "simplified") {
      if (Math.min(h.officeSqft ?? 0, cfg.homeOffice.simplifiedMaxSqft) <= 0) continue;
    } else {
      const fullYear = actualHomeOfficeExpenses({ ...h, monthsActive: 12 });
      if (fullYear.areaRejected) areaRejected += 1;
      if (fullYear.amount <= 0) continue;
    }
    candidates.push({ h, ...window });
  }
  candidates.sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0));
  const pieces: HomeOfficePiece[] = [];
  // Allowable simplified square feet already counted in each month (Jan = 0).
  const simplifiedSqftByMonth = Array.from({ length: 12 }, () => 0);
  candidates.forEach((c, i) => {
    const next = candidates.slice(i + 1).find((n) => n.from <= c.to);
    const to = next ? dayBefore(next.from) : c.to;
    if (to < c.from) return;
    const monthsActive = (daysBetweenInclusive(c.from, to) / yearDays) * 12;
    if (c.h.method === "simplified") {
      // Pub 587 (2025), "Part-year use or area changes (for simplified method only)",
      // https://www.irs.gov/pub/irs-pdf/p587.pdf: "your deduction is limited to the average
      // monthly allowable square footage. You calculate the average monthly allowable square
      // footage by adding the amount of allowable square feet you used in each month and dividing
      // the sum by 12. ... you cannot take more than 300 square feet into account for any 1 month.
      // Additionally, if your qualified business use was less than 15 days in a month, you must
      // use -0- for that month."
      const sqft = c.h.officeSqft ?? 0;
      let sqftMonthsAdded = 0;
      for (let month = 0; month < 12; month++) {
        if (daysInMonthWithin(year, month, c.from, to) < 15) continue;
        // At most 300 sq ft a month, across every simplified config.
        const add = Math.min(
          sqft,
          cfg.homeOffice.simplifiedMaxSqft - simplifiedSqftByMonth[month]!,
        );
        simplifiedSqftByMonth[month]! += add;
        sqftMonthsAdded += add;
      }
      const amount = Math.round((sqftMonthsAdded * cfg.homeOffice.simplifiedRatePerSqft) / 12);
      pieces.push({ method: "simplified", amount: cents(amount), from: c.from, to });
    } else {
      const amount = actualHomeOfficeExpenses({ ...c.h, monthsActive }).amount;
      pieces.push({ method: "actual", amount, from: c.from, to });
    }
  });
  return { pieces, areaRejected };
};

// Tentative profit from the rows dated within [from, to]: counted 1099 income
// minus counted direct expenses minus mileage.
const tentativeProfitBetween = (
  bundle: Bundle,
  year: number,
  seStartDate: string,
  from: string,
  to: string,
): number => {
  const within = (d: string) => d >= from && d <= to;
  const income = countedInYear(
    bundle.income.filter((i) => i.sourceType === "1099"),
    year,
    seStartDate,
  )
    .filter((r) => within(r.date))
    .reduce((sum, r) => sum + r.amountCents, 0);
  const expenses = expensesCountedForYear(bundle.expenses, year, seStartDate)
    .filter((r) => within(r.date))
    .reduce((sum, r) => sum + r.amountCents, 0);
  const mileage = mileageDeduction(
    countedInYear(bundle.mileage, year, seStartDate).filter((m) => within(m.date)),
    getYearConfig(year),
  );
  return income - expenses - mileage;
};

// Gross income limit (Form 8829 lines 8, 15, 27; Pub 587 "Gross income
// limitation", which applies to the simplified method too): each home's
// deduction is at most the profit from the business use of that home.
//
// Every config, one home or several, is limited by the profit from the rows
// dated within its own days in use. Pub 587: "If some of the income is from a
// place of business other than your home, you must first determine the part
// of your gross income from the business use of your home." i8829 Line 8, for
// more than one home: "include only the income earned and the deductions
// attributable to that income during the period you owned the home".
//
// - Each config's profit window is the days it owns (see homeOfficePieces),
//   the same days its amount is prorated over.
// - The total allowed never exceeds the business's whole tentative profit
//   (line 27 is never more than line 15). Any excess over it is cut from the
//   latest config back.
//
// What the limit cuts depends on the method. Actual: Form 8829 line 43
// carries it to next year. Simplified: "Amount in excess of gross income
// limitation may not be carried over"
// (https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction),
// so it is lost.
const limitedHomeOffice = (
  bundle: Bundle,
  year: number,
  seStartDate: string,
  through: string,
  wholeTentativeProfit: number,
): { allowed: Cents; lost: Cents; carryover: Cents; areaRejected: number } => {
  const { pieces, areaRejected } = homeOfficePieces(bundle, year, seStartDate, through);
  const cut = pieces.map((piece) => {
    const profit = tentativeProfitBetween(bundle, year, seStartDate, piece.from, piece.to);
    return { piece, ...limitToTentativeProfit(piece.amount, profit) };
  });
  // Never more than the whole tentative profit: trim from the latest config back.
  let over = cut.reduce((sum, c) => sum + c.allowed, 0) - Math.max(0, wholeTentativeProfit);
  for (let i = cut.length - 1; i >= 0 && over > 0; i--) {
    const trim = Math.min(over, cut[i]!.allowed);
    cut[i] = {
      ...cut[i]!,
      allowed: cents(cut[i]!.allowed - trim),
      disallowed: cents(cut[i]!.disallowed + trim),
    };
    over -= trim;
  }
  let allowed = 0;
  let lost = 0;
  let carryover = 0;
  for (const c of cut) {
    allowed += c.allowed;
    if (c.piece.method === "simplified") lost += c.disallowed;
    else carryover += c.disallowed;
  }
  return { allowed: cents(allowed), lost: cents(lost), carryover: cents(carryover), areaRejected };
};

// Days of [from, to] that fall in `month` (0 = January) of `year`.
const daysInMonthWithin = (year: number, month: number, from: string, to: string): number => {
  const mm = String(month + 1).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  const start = from > first ? from : first;
  const end = to < last ? to : last;
  return start > end ? 0 : daysBetweenInclusive(start, end);
};

// The ISO date before `iso` (UTC, so no timezone moves the day).
const dayBefore = (iso: string): string =>
  new Date(Date.UTC(...isoParts(iso)) - 86_400_000).toISOString().slice(0, 10);

// The days a config is in use within the year, through `through`, and not
// before the SE start: [from, to] inclusive, or null when there are none.
const activeWindow = (
  year: number,
  start: string,
  end: string | null,
  seStartDate: string,
  through: string,
): { from: string; to: string } | null => {
  const yStart = `${year}-01-01`;
  const floor = (seStartDate || yStart) > yStart ? seStartDate || yStart : yStart;
  const from = start > floor ? start : floor;
  const to = end === null || end > through ? through : end;
  return from <= to ? { from, to } : null;
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
    // Every live expense in the year that the core rule leaves out, so the
    // banner always matches what "Direct expenses" counts.
    expense:
      bundle.expenses.filter((e) => e.deletedAt === null && inYear(e.date)).length -
      expensesCountedForYear(bundle.expenses, year, seStartDate).length,
    mileage: bundle.mileage.filter((m) => m.deletedAt === null && isExcluded(m.date)).length,
  };
};

export type DerivedYear = {
  gross1099: Cents;
  directExpenses: Cents;
  mileageDeduction: Cents;
  homeOfficeDeduction: Cents;
  /** Simplified-method home office over the gross income limit. It cannot be carried over: lost. */
  homeOfficeLost: Cents;
  /**
   * Actual-method home office over the gross income limit: Form 8829 line 43, which carries to next
   * year. fiscode reports it but does not carry it across years.
   */
  homeOfficeCarryover: Cents;
  /** Actual-method configs skipped because the office is larger than the home. */
  homeOfficeAreaRejected: number;
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
  const directExpenses = sumExpensesWithinYear(bundle.expenses, year, seStartDate);
  const mileageDeduction = sumMileageDeductionWithinYear(bundle, year, seStartDate);
  const limited = limitedHomeOffice(
    bundle,
    year,
    seStartDate,
    `${year}-12-31`,
    gross1099 - directExpenses - mileageDeduction,
  );
  const homeOfficeDeduction = limited.allowed;
  const total = addCents(directExpenses, mileageDeduction, homeOfficeDeduction);
  return {
    gross1099,
    directExpenses,
    mileageDeduction,
    homeOfficeDeduction,
    homeOfficeLost: limited.lost,
    homeOfficeCarryover: limited.carryover,
    homeOfficeAreaRejected: limited.areaRejected,
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
    dependents: profile.dependents,
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
    // The year's counted expenses (startup ones included), up to the cutoff.
    // Startup rows land in the first cumulative window that contains their date.
    const expRows = expensesCountedForYear(bundle.expenses, year, seStartDate).filter(
      (r) => r.date <= cutoff,
    );
    const cumGross = incomeRows.reduce((acc, r) => addCents(acc, cents(r.amountCents)), cents(0));
    // Direct expenses plus mileage and home office through the cutoff, the same
    // pieces deriveYear adds for the whole year (Schedule AI line 1 is the
    // period's AGI, so every deduction counts by its date).
    const otherExp = addCents(
      expRows.reduce((acc, r) => addCents(acc, cents(r.amountCents)), cents(0)),
      sumMileageDeductionWithinYear(bundle, year, seStartDate, cutoff),
    );
    // The period's home office, limited by the period's own tentative profit.
    const homeOffice = limitedHomeOffice(bundle, year, seStartDate, cutoff, cumGross - otherExp);
    const cumExp = addCents(otherExp, homeOffice.allowed);
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
