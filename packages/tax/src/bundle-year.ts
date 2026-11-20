import {
  addCents,
  cents,
  countedExpenseDate,
  countedInYear,
  expenseYearExclusion,
  expensesCountedForYear,
  isPreStartStartupCost,
  startupDeductionBetween,
  startupTickIgnoredForEquipment,
  type Cents,
  yearExclusion,
} from "@fiscode/core";
// Type-only: @fiscode/csv is not a runtime dependency of @fiscode/tax (see .oxlintrc.json).
import type { Bundle } from "@fiscode/csv";

import { getYearConfig } from "./config/index.ts";
import { estimateYear, type EstimateResult } from "./engine.ts";
import { actualHomeOfficeExpenses, limitToTentativeProfit } from "./home-office.ts";
import { mileageDeduction } from "./mileage.ts";
import type { AnnualizedInput, TaxInput } from "./types.ts";

type ActiveSpouse = {
  annualW2WagesCents: number;
  annualFederalWithholdingCents: number;
  annualStateWithholdingCents: number;
};

const sumWithinYear = (
  rows: Array<{ date: string; amountCents: number; deletedAt: string | null }>,
  year: number,
  seStartDate: string,
): Cents =>
  countedInYear(rows, year, seStartDate).reduce(
    (sum, r) => addCents(sum, cents(r.amountCents)),
    cents(0),
  );

// Self-employed health insurance is not a Schedule C expense: it is a Schedule 1 line 17
// adjustment (Form 7206), so it never lowers net profit or SE tax. These two split the rows.
const isHealthInsurance = (e: { category: string }) => e.category === "health_insurance";
const scheduleCExpenses = <T extends { category: string }>(rows: readonly T[]): T[] =>
  rows.filter((e) => !isHealthInsurance(e));

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
    countedInYear(bundle.mileage, year, seStartDate).filter((m) => m.date <= through),
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
  // Each config's owned days: a later start owns shared days.
  const owned = candidates
    .map((c, i) => {
      const next = candidates.slice(i + 1).find((n) => n.from <= c.to);
      return { ...c, to: next ? dayBefore(next.from) : c.to };
    })
    .filter((c) => c.from <= c.to);

  // Pub 587 (2025), "Part-year use or area changes (for simplified method only)",
  // https://www.irs.gov/pub/irs-pdf/p587.pdf: "your deduction is limited to the average monthly
  // allowable square footage. You calculate the average monthly allowable square footage by adding
  // the amount of allowable square feet you used in each month and dividing the sum by 12. ... you
  // cannot take more than 300 square feet into account for any 1 month. Additionally, if your
  // qualified business use was less than 15 days in a month, you must use -0- for that month."
  // The 15-day test is on the month's business use across the simplified configs (an area change
  // continues the same use: Pub 587 Example 2). A qualifying month uses the square feet of the
  // config with the most days in it (a tie goes to the later one), at most 300, credited to it.
  const simplified = owned.filter((c) => c.h.method === "simplified");
  const sqftMonths = simplified.map(() => 0);
  for (let month = 0; month < 12; month++) {
    const days = simplified.map((c) => daysInMonthWithin(year, month, c.from, c.to));
    if (days.reduce((sum, d) => sum + d, 0) < 15) continue;
    let pick = 0;
    days.forEach((d, i) => {
      if (d > 0 && d >= days[pick]!) pick = i;
    });
    sqftMonths[pick]! += Math.min(
      simplified[pick]!.h.officeSqft ?? 0,
      cfg.homeOffice.simplifiedMaxSqft,
    );
  }

  const pieces: HomeOfficePiece[] = owned.map((c) => {
    if (c.h.method === "simplified") {
      const sqftMonthsCredited = sqftMonths[simplified.indexOf(c)]!;
      const amount = Math.round((sqftMonthsCredited * cfg.homeOffice.simplifiedRatePerSqft) / 12);
      return { method: "simplified", amount: cents(amount), from: c.from, to: c.to };
    }
    const monthsActive = (daysBetweenInclusive(c.from, c.to) / yearDays) * 12;
    const amount = actualHomeOfficeExpenses({ ...c.h, monthsActive }).amount;
    return { method: "actual", amount, from: c.from, to: c.to };
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
  const expenses =
    // By the date each counts on (equipment: its placed-in-service date).
    scheduleCExpenses(expensesCountedForYear(bundle.expenses, year, seStartDate))
      .filter((r) => within(countedExpenseDate(r, seStartDate)))
      .reduce((sum, r) => sum + r.amountCents, 0) +
    // §195 startup costs: the start-year amount on the SE start date, amortization by month.
    startupDeductionBetween(bundle.expenses, seStartDate, from, to);
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
  const beforeStart = (r: { date: string; deletedAt: string | null }) =>
    yearExclusion(r, year, seStartDate) === "before_se_start";
  return {
    income: bundle.income.filter((i) => i.sourceType === "1099" && beforeStart(i)).length,
    // Startup costs paid before the start are deducted under §195, not excluded. Equipment counts
    // on the date it is placed in service, never before the start (core expenseYearExclusion).
    expense: bundle.expenses.filter(
      (e) =>
        expenseYearExclusion(e, year, seStartDate) === "before_se_start" &&
        !isPreStartStartupCost(e, seStartDate),
    ).length,
    mileage: bundle.mileage.filter(beforeStart).length,
  };
};

export type DerivedYear = {
  gross1099: Cents;
  /** Schedule C expenses: every counted expense except self-employed health insurance. */
  directExpenses: Cents;
  /** Self-employed health insurance premiums counted for the year (Schedule 1 line 17, before its limit). */
  selfEmployedHealthInsurance: Cents;
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
  /**
   * §195 startup costs (paid before the SE start): the year's deduction (included in
   * `directExpenses`), the total paid, and what is still to deduct after Dec 31 of the year
   * (the total for a year before the start year). The rest is amortized over 180 months.
   */
  startupCosts: { deductedThisYear: Cents; total: Cents; remainingAfterYear: Cents };
  /**
   * Equipment counted this year for more than $2,500 without the §179 flag. fiscode deducts all
   * equipment in full, which above the de minimis safe harbor ("up to $2,500 per item or invoice",
   * Pub 334) assumes a section 179 election; the dashboard says so. No number changes.
   */
  equipmentAssumedSection179: number;
  /**
   * Equipment counted this year that is ticked Startup but was bought before the SE start. The
   * tick is ignored: equipment is placed in service, not a §195 start-up cost (core
   * `startupTickIgnoredForEquipment`). A count, so the dashboard can say it in one line. No
   * number changes.
   */
  startupIgnoredForEquipment: number;
  totalDeductibleExpenses: Cents;
  /** The entity active in the year (the latest one overlapping it), or sole_prop when none. */
  entityType: string;
  /**
   * True for an S corp. The estimate is still computed as a sole proprietorship: no S-corp
   * math exists yet. A single-member LLC is a disregarded entity, taxed as a sole
   * proprietorship, so its estimate is right and this stays false.
   */
  entityUnsupported: boolean;
  seStartDate: string;
  excludedBeforeSeStart: ExcludedBeforeSeStart;
};

const deriveYear = (bundle: Bundle, year: number): DerivedYear => {
  // Floor at Jan 1 of the year if no profile — defensive; buildTaxInput
  // throws on missing profile anyway, but deriveYear is also called for
  // read-only dashboard display.
  const seStartDate = bundle.profile?.seStartDate ?? `${year}-01-01`;
  const gross1099 = sumWithinYear(
    bundle.income.filter((i) => i.sourceType === "1099"),
    year,
    seStartDate,
  );
  const startupThisYear = cents(
    startupDeductionBetween(bundle.expenses, seStartDate, `${year}-01-01`, `${year}-12-31`),
  );
  const startupTotal = cents(
    bundle.expenses
      .filter((e) => isPreStartStartupCost(e, seStartDate))
      .reduce((sum, e) => sum + e.amountCents, 0),
  );
  const startupRemaining = cents(
    startupTotal -
      startupDeductionBetween(bundle.expenses, seStartDate, seStartDate, `${year}-12-31`),
  );
  const directExpenses = addCents(
    sumExpensesWithinYear(scheduleCExpenses(bundle.expenses), year, seStartDate),
    startupThisYear,
  );
  const selfEmployedHealthInsurance = sumExpensesWithinYear(
    bundle.expenses.filter(isHealthInsurance),
    year,
    seStartDate,
  );
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
  const entityType = activeEntityFor(bundle, year)?.type ?? "sole_prop";
  return {
    gross1099,
    directExpenses,
    selfEmployedHealthInsurance,
    mileageDeduction,
    homeOfficeDeduction,
    homeOfficeLost: limited.lost,
    homeOfficeCarryover: limited.carryover,
    homeOfficeAreaRejected: limited.areaRejected,
    startupCosts: {
      deductedThisYear: startupThisYear,
      total: startupTotal,
      remainingAfterYear: startupRemaining,
    },
    startupIgnoredForEquipment: expensesCountedForYear(bundle.expenses, year, seStartDate).filter(
      (e) => startupTickIgnoredForEquipment(e, seStartDate),
    ).length,
    equipmentAssumedSection179: expensesCountedForYear(bundle.expenses, year, seStartDate).filter(
      (e) => e.category === "equipment" && !e.flagForSection179 && e.amountCents > 250_000,
    ).length,
    totalDeductibleExpenses: total,
    entityType,
    entityUnsupported: entityType === "s_corp",
    seStartDate,
    excludedBeforeSeStart: countExcludedBeforeSeStart(bundle, year, seStartDate),
  };
};

/** Build a TaxInput suitable for `estimateYear` from the current bundle. */
const buildTaxInput = (bundle: Bundle, year: number): TaxInput => {
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
    selfEmployedHealthInsurance: derived.selfEmployedHealthInsurance,
    spouseW2Wages: cents(spouse?.annualW2WagesCents ?? 0),
    spouseFederalWithholding: cents(spouse?.annualFederalWithholdingCents ?? 0),
    spouseStateWithholding: cents(spouse?.annualStateWithholdingCents ?? 0),
    priorYearTotalTax: undefined,
    priorYearAgi: undefined,
  };
};

/** Cumulative period bundles for annualized installments. */
const buildAnnualizedInput = (bundle: Bundle, year: number): AnnualizedInput => {
  const base = buildTaxInput(bundle, year);
  const seStartDate = bundle.profile?.seStartDate ?? `${year}-01-01`;
  const endsDates: Array<{ q: 1 | 2 | 3 | 4; ends: string }> = [
    { q: 1, ends: `${year}-03-31` },
    { q: 2, ends: `${year}-05-31` },
    { q: 3, ends: `${year}-08-31` },
    { q: 4, ends: `${year}-12-31` },
  ];
  const cumulative = (cutoff: string) => {
    const incomeRows = countedInYear(
      bundle.income.filter((r) => r.sourceType === "1099"),
      year,
      seStartDate,
    ).filter((r) => r.date <= cutoff);
    // The year's counted expenses up to the cutoff, by the date each counts on
    // (equipment: its placed-in-service date).
    const counted = expensesCountedForYear(bundle.expenses, year, seStartDate).filter(
      (r) => countedExpenseDate(r, seStartDate) <= cutoff,
    );
    const expRows = scheduleCExpenses(counted);
    const cumSehi = counted
      .filter(isHealthInsurance)
      .reduce((acc, r) => addCents(acc, cents(r.amountCents)), cents(0));
    const cumGross = incomeRows.reduce((acc, r) => addCents(acc, cents(r.amountCents)), cents(0));
    // Direct expenses plus mileage and home office through the cutoff, the same
    // pieces deriveYear adds for the whole year (Schedule AI line 1 is the
    // period's AGI, so every deduction counts by its date).
    const otherExp = addCents(
      expRows.reduce((acc, r) => addCents(acc, cents(r.amountCents)), cents(0)),
      // §195 startup costs through the cutoff: the start-year amount in the period that
      // holds the SE start, amortization by month.
      cents(startupDeductionBetween(bundle.expenses, seStartDate, `${year}-01-01`, cutoff)),
      sumMileageDeductionWithinYear(bundle, year, seStartDate, cutoff),
    );
    // The period's home office, limited by the period's own tentative profit.
    const homeOffice = limitedHomeOffice(bundle, year, seStartDate, cutoff, cumGross - otherExp);
    const cumExp = addCents(otherExp, homeOffice.allowed);
    return { cumGross, cumExp, cumSehi };
  };
  const periods = endsDates.map((e) => {
    const c = cumulative(e.ends);
    return {
      endsAt: e.ends as never,
      cumulativeGross1099: c.cumGross,
      cumulativeDeductibleExpenses: c.cumExp,
      cumulativeSelfEmployedHealthInsurance: c.cumSehi,
    };
  }) as unknown as AnnualizedInput["periods"];
  return { ...base, periods };
};

export type BundleYearEstimate = {
  result: EstimateResult;
  derived: DerivedYear;
  /** What the engine was given: the annualized input when the profile picks that method. */
  input: TaxInput | AnnualizedInput;
};

/**
 * The year's estimate from the user's data: which rows count (the core year rule),
 * the deductions they add up to, and the engine run by the profile's quarterly
 * method. Every entity is estimated as a sole proprietorship for now;
 * `derived.entityUnsupported` says when that is not the user's entity.
 * Throws when the bundle has no profile.
 */
export const estimateBundleYear = (bundle: Bundle, year: number): BundleYearEstimate => {
  const profile = bundle.profile;
  if (!profile) throw new Error("estimateBundleYear: profile is required");
  const method = profile.quarterlyMethod === "annualized" ? "annualized" : "even";
  const input =
    method === "annualized" ? buildAnnualizedInput(bundle, year) : buildTaxInput(bundle, year);
  const result = estimateYear({ entity: "sole_prop", method, input });
  return { result, derived: deriveYear(bundle, year), input };
};
