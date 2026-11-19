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

// ─── Parsing ────────────────────────────────────────────────────────────────
// The one syntax rule for amounts and whole numbers typed by a person or read
// from a CSV cell. Callers apply their own range rules to the typed result.

/** Why a cell is not an amount, so each caller can word its own message. */
export type MoneyRejection = "empty" | "syntax" | "negative" | "decimals" | "too_large";
export type ParsedMoney = { ok: true; cents: Cents } | { ok: false; reason: MoneyRejection };

// Plain digits, an optional `$`, commas only between thousands groups, and an
// optional decimal part (".5" and "5." are fine). A minus may sit on either
// side of the `$`. No `+`, exponent, hex, or non-ASCII digits.
const MONEY = /^(-?)\$?\s*(-?)(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/;

/**
 * Read an amount as integer cents, without float arithmetic. A sign is read
 * only when `signed` is set; otherwise "-50" is rejected as `negative`.
 */
export const parseMoney = (raw: string, { signed = false } = {}): ParsedMoney => {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  const m = MONEY.exec(trimmed);
  if (!m || (m[1] && m[2])) return { ok: false, reason: "syntax" };
  const whole = m[3]!.replace(/,/g, "");
  const frac = m[4] ?? "";
  if (whole === "" && frac === "") return { ok: false, reason: "syntax" };
  const negative = Boolean(m[1] || m[2]);
  if (negative && !signed) return { ok: false, reason: "negative" };
  if (frac.length > 2) return { ok: false, reason: "decimals" };
  // A whole part longer than 16 digits is past the safe-integer range in cents.
  if (whole.length > 16) return { ok: false, reason: "too_large" };
  const value = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) return { ok: false, reason: "too_large" };
  return { ok: true, cents: (negative ? -value || 0 : value) as Cents };
};

/** Amounts entered in the app must be below $100,000,000. */
export const AMOUNT_CEILING_CENTS = 100_000_000_00 as Cents;

/** `positive`: income, expenses, rates. `nonNegative`: spouse wages, withholding. */
export type AmountFloor = "positive" | "nonNegative";

/** Range rule for amounts entered in the app; null when the amount is in range. */
export const checkAmountRange = (
  c: Cents,
  floor: AmountFloor,
): "below_floor" | "too_large" | null => {
  if (c >= AMOUNT_CEILING_CENTS) return "too_large";
  if (floor === "positive" ? c <= 0 : c < 0) return "below_floor";
  return null;
};

export type ParsedWholeNumber =
  | { ok: true; value: number }
  | { ok: false; reason: Exclude<MoneyRejection, "decimals"> };

const WHOLE = /^(-?)(\d+)$/;

/** Read a whole number: plain ASCII digits, a minus only when `signed` is set. */
export const parseWholeNumber = (raw: string, { signed = false } = {}): ParsedWholeNumber => {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  const m = WHOLE.exec(trimmed);
  if (!m) return { ok: false, reason: "syntax" };
  if (m[1] && !signed) return { ok: false, reason: "negative" };
  const value = Number(m[2]);
  if (!Number.isSafeInteger(value)) return { ok: false, reason: "too_large" };
  return { ok: true, value: m[1] ? -value || 0 : value };
};

/** An inclusive range for a whole-number field. */
export type WholeRange = { readonly min: number; readonly max: number };

export const WHOLE_RANGES = {
  tripMiles: { min: 1, max: 9_999 },
  leadDays: { min: 1, max: 365 },
  dependents: { min: 0, max: 99 },
  sqft: { min: 0, max: 99_999 },
  mpg: { min: 0, max: 999 },
} as const satisfies Record<string, WholeRange>;

export const FIRST_VEHICLE_YEAR = 1900;

/** Model years on sale now: next year's models are already out. */
export const vehicleYearRange = (today: Date = new Date()): WholeRange => ({
  min: FIRST_VEHICLE_YEAR,
  max: today.getFullYear() + 1,
});

export const inWholeRange = (n: number, { min, max }: WholeRange): boolean => n >= min && n <= max;
