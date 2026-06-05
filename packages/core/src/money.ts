declare const CentsBrand: unique symbol;
export type Cents = number & { readonly [CentsBrand]: true };

export const cents = (n: number): Cents => Math.round(n) as Cents;
export const dollars = (n: number): Cents => Math.round(n * 100) as Cents;

export const toDollars = (c: Cents): number => c / 100;

export const addCents = (...vals: Cents[]): Cents => vals.reduce((sum, v) => sum + v, 0) as Cents;

export const subCents = (a: Cents, b: Cents): Cents => (a - b) as Cents;

export const mulRate = (c: Cents, rate: number): Cents => Math.round(c * rate) as Cents;

export const maxCents = (...vals: Cents[]): Cents =>
  vals.reduce((m, v) => (v > m ? v : m), 0 as Cents);

export const minCents = (a: Cents, b: Cents): Cents => (a < b ? a : b);

export const clampMinZero = (c: Cents): Cents => (c < 0 ? (0 as Cents) : c);

export const formatUSD = (c: Cents): string => {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}$${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")}`;
};

export const parseUSD = (raw: string): Cents | undefined => {
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  return dollars(n);
};
