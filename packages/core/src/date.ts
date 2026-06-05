// ISO date YYYY-MM-DD strings throughout. No Date objects in storage layer.
declare const IsoDateBrand: unique symbol;
export type IsoDate = string & { readonly [IsoDateBrand]: true };

export const isoDate = (d: string): IsoDate => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`invalid IsoDate: ${d}`);
  return d as IsoDate;
};

export const todayIso = (): IsoDate => {
  const d = new Date();
  return isoDate(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  );
};

export const isoFromDate = (d: Date): IsoDate =>
  isoDate(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  );

export const dateFromIso = (s: IsoDate): Date => {
  const parts = s.split("-").map(Number);
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!);
};

export const yearOf = (s: IsoDate): number => Number(s.slice(0, 4));

// US federal holiday roll-forward, *simplified*. The IRS uses the next
// business day when a quarterly date falls on a weekend or DC holiday.
// We handle weekends + a static fixed-date holiday list. Easter-floating
// holidays don't fall on tax due dates, so static is fine.
// todo: verify federal-holiday list against IRS guidance each year that this hits a boundary
const FIXED_HOLIDAYS = new Set([
  "01-01", // New Year's
  "06-19", // Juneteenth
  "07-04", // Independence Day
  "12-25", // Christmas
]);

const isHoliday = (d: Date): boolean => {
  const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return FIXED_HOLIDAYS.has(md);
};

export const shiftToBusinessDay = (s: IsoDate): IsoDate => {
  const d = dateFromIso(s);
  while (d.getDay() === 0 || d.getDay() === 6 || isHoliday(d)) {
    d.setDate(d.getDate() + 1);
  }
  return isoFromDate(d);
};

export const inRange = (date: IsoDate, start: IsoDate | null, end: IsoDate | null): boolean => {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
};

export const yearStart = (year: number): IsoDate => isoDate(`${year}-01-01`);
export const yearEnd = (year: number): IsoDate => isoDate(`${year}-12-31`);
