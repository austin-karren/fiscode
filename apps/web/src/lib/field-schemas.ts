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
 * and returns the typed value. Messages say what is allowed, one short line
 * per kind of failure: each must fit the one message line reserved under a
 * field, in the narrowest add-form column (about 140 px at 1440).
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
  const floor = allowZero ? "Must be $0 or more" : "Must be more than $0";
  const parsed = parseMoney(raw);
  if (!parsed.ok) {
    if (parsed.reason === "decimals") return fail(ctx, "Use 2 decimals at most");
    if (parsed.reason === "too_large") return fail(ctx, "Too large");
    return fail(ctx, "Enter an amount, like 12.50");
  }
  const range = checkAmountRange(parsed.cents, allowZero ? "nonNegative" : "positive");
  if (range === "too_large") return fail(ctx, "Too large");
  if (range === "below_floor") return fail(ctx, floor);
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

// h:mm, the exact form of a stored value that is not a quarter hour ("1:23").
const HOURS_MINUTES = /^(\d{1,2}):([0-5]\d)$/;

/**
 * Hours on one time entry: above 0, at most 24. Typed as decimal hours in
 * quarter-hour steps ("1.25"), or as h:mm to the minute ("1:23"), which is
 * how the form shows a stored value off the quarter-hour step.
 */
export const hoursWorked = z.string().transform((s, ctx): number => {
  const trimmed = s.trim();
  const hm = HOURS_MINUTES.exec(trimmed);
  if (hm) {
    const minutes = Number(hm[1]) * 60 + Number(hm[2]);
    if (minutes === 0) return fail(ctx, "Must be more than 0");
    if (minutes > 24 * 60) return fail(ctx, "24 hours at most");
    return minutes / 60;
  }
  if (!PLAIN_DECIMAL.test(trimmed)) return fail(ctx, "Enter hours, like 1.5");
  const hours = Number(trimmed);
  if (hours === 0) return fail(ctx, "Must be more than 0");
  if (hours > 24) return fail(ctx, "24 hours at most");
  if (!Number.isInteger(hours * 4)) return fail(ctx, "Use quarter hours, like 1.25");
  return hours;
});

/**
 * Stored minutes as the hours text the time form takes, never rounded: decimal
 * hours on a quarter-hour step (75 → "1.25"), h:mm otherwise (83 → "1:23").
 * Saving the text unchanged stores the same minutes.
 */
export const hoursField = (minutes: number): string =>
  minutes > 0 && minutes % 15 === 0
    ? String(minutes / 60)
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

// ─── Whole numbers ──────────────────────────────────────────────────────────

// Not a whole number at all, or one outside the range: a message for each.
// Bounds read with thousands separators ("9,999"); a year passes String.
const inRange = (
  raw: string,
  ctx: z.RefinementCtx,
  range: WholeRange,
  notANumber: string,
  n: (v: number) => string = (v) => v.toLocaleString("en-US"),
) => {
  const parsed = parseWholeNumber(raw);
  if (!parsed.ok) return fail(ctx, notANumber);
  if (!inWholeRange(parsed.value, range)) {
    return fail(ctx, `Must be ${n(range.min)} to ${n(range.max)}`);
  }
  return parsed.value;
};

const WHOLE = "Enter a whole number";

const wholeNumber = (range: WholeRange) =>
  z.string().transform((s, ctx) => inRange(s, ctx, range, WHOLE));

const optionalWholeNumber = (range: WholeRange) =>
  z.string().transform((s, ctx) => (s.trim() === "" ? null : inRange(s, ctx, range, WHOLE)));

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
  return inRange(s, ctx, range, "Enter a 4-digit year", String);
});
