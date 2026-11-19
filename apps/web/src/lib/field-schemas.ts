import {
  checkAmountRange,
  inWholeRange,
  parseMoney,
  parseWholeNumber,
  vehicleYearRange,
  WHOLE_RANGES,
  type WholeRange,
} from "@fiscode/core";
import { z } from "zod";

/**
 * Field schemas shared by the add forms and their edit dialogs, so both
 * reject the same input with the same message. Each takes the input's string
 * and returns the typed value. Messages say what is allowed.
 *
 * The syntax and range rules live in @fiscode/core (`parseMoney`,
 * `parseWholeNumber`, `checkAmountRange`, `WHOLE_RANGES`); this file words
 * the messages.
 */

const PLAIN_DECIMAL = /^(\d+\.?\d*|\.\d+)$/;

const fail = (ctx: z.RefinementCtx, message: string) => {
  ctx.addIssue({ code: "custom", message });
  return z.NEVER;
};

// ─── Money ──────────────────────────────────────────────────────────────────

const parseAmount = (raw: string, ctx: z.RefinementCtx, allowZero: boolean) => {
  const hint = allowZero
    ? "Enter an amount of 0 or more, like 12.50"
    : "Enter an amount greater than 0, like 12.50";
  const ceiling = "Enter an amount below $100,000,000";
  const parsed = parseMoney(raw);
  if (!parsed.ok) {
    if (parsed.reason === "decimals") return fail(ctx, "Use at most 2 decimal places, like 12.50");
    if (parsed.reason === "too_large") return fail(ctx, ceiling);
    return fail(ctx, hint);
  }
  const range = checkAmountRange(parsed.cents, allowZero ? "nonNegative" : "positive");
  if (range === "too_large") return fail(ctx, ceiling);
  if (range === "below_floor") return fail(ctx, hint);
  return parsed.cents;
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

/**
 * Stored minutes as the hours text the time form takes: the nearest quarter
 * hour, at least 0.25. A row imported with odd minutes (83) would otherwise
 * fill the form with "1.3833333333333333", which the form then refuses.
 */
export const hoursField = (minutes: number): string =>
  String(Math.max(1, Math.round(minutes / 15)) / 4);

// ─── Whole numbers ──────────────────────────────────────────────────────────

const inRange = (raw: string, ctx: z.RefinementCtx, range: WholeRange, message: string) => {
  const parsed = parseWholeNumber(raw);
  if (!parsed.ok || !inWholeRange(parsed.value, range)) return fail(ctx, message);
  return parsed.value;
};

const rangeMessage = ({ min, max }: WholeRange) =>
  `Enter a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}`;

const wholeNumber = (range: WholeRange) =>
  z.string().transform((s, ctx) => inRange(s, ctx, range, rangeMessage(range)));

const optionalWholeNumber = (range: WholeRange) =>
  z
    .string()
    .transform((s, ctx) => (s.trim() === "" ? null : inRange(s, ctx, range, rangeMessage(range))));

/** Business miles on one trip. */
export const tripMiles = wholeNumber(WHOLE_RANGES.tripMiles);
/** Days of lead time before a deadline. */
export const leadDays = wholeNumber(WHOLE_RANGES.leadDays);
/** Dependents on the return. */
export const dependentsCount = wholeNumber(WHOLE_RANGES.dependents);
/** Square feet of an office or a home; blank is no value. */
export const optionalSqft = optionalWholeNumber(WHOLE_RANGES.sqft);
/** Miles per gallon; blank is no value. */
export const optionalMpg = optionalWholeNumber(WHOLE_RANGES.mpg);

/** A vehicle's model year; blank is no value. Next year's models are on sale. */
export const optionalVehicleYear = z.string().transform((s, ctx) => {
  if (s.trim() === "") return null;
  const range = vehicleYearRange();
  return inRange(s, ctx, range, `Enter a 4-digit year from ${range.min} to ${range.max}`);
});
