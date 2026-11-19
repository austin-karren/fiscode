import { parseUSD } from "@fiscode/core";
import { z } from "zod";

/**
 * Field schemas shared by the add forms and their edit dialogs, so both
 * reject the same input with the same message. Each takes the input's string
 * and returns the typed value. Messages say what is allowed.
 *
 * `Number()` alone is too loose for a form: it reads "1e3", "0x10" and
 * "-50". These schemas only accept plain digits with an optional decimal part.
 */

const PLAIN_DECIMAL = /^(\d+\.?\d*|\.\d+)$/;
const PLAIN_INTEGER = /^\d+$/;
const GROUPED_THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d*)?$/;

const fail = (ctx: z.RefinementCtx, message: string) => {
  ctx.addIssue({ code: "custom", message });
  return z.NEVER;
};

// ─── Money ──────────────────────────────────────────────────────────────────

/** Amounts must be below this many dollars. */
const AMOUNT_CEILING_DOLLARS = 100_000_000;

const parseAmount = (raw: string, ctx: z.RefinementCtx, allowZero: boolean) => {
  // "$1,234.56" is fine: the symbol and spaces are dropped, and so are commas
  // that group thousands. "12,50" is not read as 1250.
  const unsigned = raw.replace(/[$\s]/g, "");
  const cleaned = GROUPED_THOUSANDS.test(unsigned) ? unsigned.replace(/,/g, "") : unsigned;
  const hint = allowZero
    ? "Enter an amount of 0 or more, like 12.50"
    : "Enter an amount greater than 0, like 12.50";
  if (!PLAIN_DECIMAL.test(cleaned)) return fail(ctx, hint);
  if (/\.\d{3,}$/.test(cleaned)) return fail(ctx, "Use at most 2 decimal places, like 12.50");
  const dollars = Number(cleaned);
  if (dollars >= AMOUNT_CEILING_DOLLARS) return fail(ctx, "Enter an amount below $100,000,000");
  if (dollars === 0 && !allowZero) return fail(ctx, hint);
  return parseUSD(cleaned)!;
};

/** A required amount greater than 0, as cents. */
export const moneyAmount = z.string().transform((s, ctx) => parseAmount(s, ctx, false));

/** Blank is no value (null); anything else must be an amount greater than 0. */
export const optionalMoneyAmount = z
  .string()
  .transform((s, ctx) => (s.trim() === "" ? null : parseAmount(s, ctx, false)));

/** Blank is no value (null); anything else must be an amount of 0 or more. */
export const optionalMoneyAmountOrZero = z
  .string()
  .transform((s, ctx) => (s.trim() === "" ? null : parseAmount(s, ctx, true)));

// ─── Hours ──────────────────────────────────────────────────────────────────

/** Hours on one time entry: above 0, at most 24, in quarter-hour steps. */
export const hoursWorked = z.string().transform((s, ctx): number => {
  const trimmed = s.trim();
  if (!PLAIN_DECIMAL.test(trimmed)) return fail(ctx, "Enter hours greater than 0, like 1.5");
  const hours = Number(trimmed);
  if (hours === 0) return fail(ctx, "Enter hours greater than 0, like 1.5");
  if (hours > 24) return fail(ctx, "Enter 24 hours or fewer for one day");
  if (!Number.isInteger(hours * 4)) {
    return fail(ctx, "Enter hours in quarter-hour steps, like 1.25");
  }
  return hours;
});

// ─── Whole numbers ──────────────────────────────────────────────────────────

const inRange = (
  raw: string,
  ctx: z.RefinementCtx,
  min: number,
  max: number,
  message: string,
): number => {
  const trimmed = raw.trim();
  if (!PLAIN_INTEGER.test(trimmed)) return fail(ctx, message);
  const n = Number(trimmed);
  if (n < min || n > max) return fail(ctx, message);
  return n;
};

const rangeMessage = (min: number, max: number) =>
  `Enter a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}`;

const wholeNumber = (min: number, max: number) =>
  z.string().transform((s, ctx) => inRange(s, ctx, min, max, rangeMessage(min, max)));

const optionalWholeNumber = (min: number, max: number) =>
  z
    .string()
    .transform((s, ctx) =>
      s.trim() === "" ? null : inRange(s, ctx, min, max, rangeMessage(min, max)),
    );

/** Business miles on one trip. */
export const tripMiles = wholeNumber(1, 9_999);
/** Days of lead time before a deadline. */
export const leadDays = wholeNumber(1, 365);
/** Dependents on the return. */
export const dependentsCount = wholeNumber(0, 99);
/** Square feet of an office or a home; blank is no value. */
export const optionalSqft = optionalWholeNumber(0, 99_999);
/** Miles per gallon; blank is no value. */
export const optionalMpg = optionalWholeNumber(0, 999);

const FIRST_VEHICLE_YEAR = 1900;

/** A vehicle's model year; blank is no value. Next year's models are on sale. */
export const optionalVehicleYear = z.string().transform((s, ctx) => {
  if (s.trim() === "") return null;
  const last = new Date().getFullYear() + 1;
  return inRange(
    s,
    ctx,
    FIRST_VEHICLE_YEAR,
    last,
    `Enter a 4-digit year from ${FIRST_VEHICLE_YEAR} to ${last}`,
  );
});
