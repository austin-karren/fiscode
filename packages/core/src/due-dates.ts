import { type IsoDate, isoDate, shiftToBusinessDay } from "./date.ts";

/**
 * The four federal estimated-tax due dates for a tax year: April 15, June 15 and September 15
 * of the year, and January 15 of the next, each moved to the next business day when it falls
 * on a weekend or holiday. Pub 505 (https://www.irs.gov/publications/p505), "When To Pay
 * Estimated Tax". The tax engine's year configs list the same dates; a test pins them equal.
 */
export const federalDueDates = (year: number): [IsoDate, IsoDate, IsoDate, IsoDate] => [
  shiftToBusinessDay(isoDate(`${year}-04-15`)),
  shiftToBusinessDay(isoDate(`${year}-06-15`)),
  shiftToBusinessDay(isoDate(`${year}-09-15`)),
  shiftToBusinessDay(isoDate(`${year + 1}-01-15`)),
];

/**
 * The tax year a payment made on `date` is most likely for: a payment on or before the January
 * due date is the prior year's fourth installment, anything later is for its own year.
 */
export const defaultTaxYear = (date: string): number => {
  const year = Number(date.slice(0, 4));
  return date <= federalDueDates(year - 1)[3] ? year - 1 : year;
};

/**
 * The installment a payment counts toward by its date: the first due date of `taxYear` on or
 * after it, or the fourth when it is after them all. The payment form's default and the
 * engine's both come from here, so they pick the same quarter.
 */
export const defaultAppliedQuarter = (
  date: string,
  taxYear: number = defaultTaxYear(date),
): 1 | 2 | 3 | 4 => {
  const i = federalDueDates(taxYear).findIndex((due) => date <= due);
  return (i === -1 ? 4 : i + 1) as 1 | 2 | 3 | 4;
};
