import { z } from "zod";
import { parseUSD } from "./money.ts";

/**
 * Shared zod validators for numeric form/CSV inputs. Centralized so that the
 * CSV import layer and every web-app form share the same accept/reject
 * semantics — what zod rejects in a CSV is what a form will refuse to submit,
 * and vice versa.
 *
 * All form-input validators take a STRING (HTML inputs always emit strings)
 * and either parse to a typed value or surface a zod error. Empty-string
 * handling is encoded in the variant: `*` variants reject blanks; `optional*`
 * variants treat blanks as null.
 *
 * The input type is kept as a plain `string` (no preprocess to unknown, no
 * `.optional()` that would surface `string | undefined`) so that the
 * StandardSchema interface used by @tanstack/react-form lines up exactly
 * with the form's `string`-typed field values.
 */

const parseInt10 = (s: string): number => Number(s.trim());

/** A non-empty string that parses to a finite number. */
export const numericString = z.string().transform((s, ctx): number => {
  const trimmed = s.trim();
  if (trimmed === "") {
    ctx.addIssue({ code: "custom", message: "Required" });
    return z.NEVER;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "Must be a number" });
    return z.NEVER;
  }
  return n;
});

/** Non-empty, parses to a finite non-negative number. */
export const nonNegativeNumericString = z.string().transform((s, ctx): number => {
  const trimmed = s.trim();
  if (trimmed === "") {
    ctx.addIssue({ code: "custom", message: "Required" });
    return z.NEVER;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "Must be a number" });
    return z.NEVER;
  }
  if (n < 0) {
    ctx.addIssue({ code: "custom", message: "Must be ≥ 0" });
    return z.NEVER;
  }
  return n;
});

/** Non-empty, parses to a finite strictly positive number. */
export const positiveNumericString = z.string().transform((s, ctx): number => {
  const trimmed = s.trim();
  if (trimmed === "") {
    ctx.addIssue({ code: "custom", message: "Required" });
    return z.NEVER;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "Must be a number" });
    return z.NEVER;
  }
  if (n <= 0) {
    ctx.addIssue({ code: "custom", message: "Must be greater than 0" });
    return z.NEVER;
  }
  return n;
});

/** Non-empty integer. */
export const integerString = z.string().transform((s, ctx): number => {
  const trimmed = s.trim();
  if (trimmed === "") {
    ctx.addIssue({ code: "custom", message: "Required" });
    return z.NEVER;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    ctx.addIssue({ code: "custom", message: "Must be a whole number" });
    return z.NEVER;
  }
  return n;
});

/** Non-negative integer (zero allowed). */
export const nonNegativeIntegerString = z.string().transform((s, ctx): number => {
  const trimmed = s.trim();
  if (trimmed === "") {
    ctx.addIssue({ code: "custom", message: "Required" });
    return z.NEVER;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    ctx.addIssue({ code: "custom", message: "Must be a whole number" });
    return z.NEVER;
  }
  if (n < 0) {
    ctx.addIssue({ code: "custom", message: "Must be ≥ 0" });
    return z.NEVER;
  }
  return n;
});

/** Strictly positive integer (≥ 1). */
export const positiveIntegerString = z.string().transform((s, ctx): number => {
  const trimmed = s.trim();
  if (trimmed === "") {
    ctx.addIssue({ code: "custom", message: "Required" });
    return z.NEVER;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    ctx.addIssue({ code: "custom", message: "Must be a whole number" });
    return z.NEVER;
  }
  if (n < 1) {
    ctx.addIssue({ code: "custom", message: "Must be at least 1" });
    return z.NEVER;
  }
  return n;
});

/** Optional integer: empty (or whitespace) → null; otherwise integer. */
export const optionalIntegerString = z.string().transform((s, ctx): number | null => {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    ctx.addIssue({ code: "custom", message: "Must be a whole number" });
    return z.NEVER;
  }
  return n;
});

/** Optional non-negative integer: empty → null; "0" allowed; negatives rejected. */
export const optionalNonNegativeIntegerString = z.string().transform((s, ctx): number | null => {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    ctx.addIssue({ code: "custom", message: "Must be a whole number" });
    return z.NEVER;
  }
  if (n < 0) {
    ctx.addIssue({ code: "custom", message: "Must be ≥ 0" });
    return z.NEVER;
  }
  return n;
});

/** USD string ($1,234.56, 1234, etc.) parsing to Cents. Rejects empty. */
export const usdString = z.string().transform((s, ctx): number => {
  const parsed = parseUSD(s);
  if (parsed === undefined) {
    ctx.addIssue({ code: "custom", message: "Enter a valid amount" });
    return z.NEVER;
  }
  return parsed;
});

/** Optional USD string: blank → null; otherwise parses to Cents. */
export const optionalUsdString = z.string().transform((s, ctx): number | null => {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const parsed = parseUSD(trimmed);
  if (parsed === undefined) {
    ctx.addIssue({ code: "custom", message: "Enter a valid amount" });
    return z.NEVER;
  }
  return parsed;
});

/** ISO date YYYY-MM-DD. Rejects anything else. */
export const isoDateString = z.string().transform((s, ctx): string => {
  const trimmed = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    ctx.addIssue({ code: "custom", message: "Use YYYY-MM-DD" });
    return z.NEVER;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: "custom", message: "Not a real date" });
    return z.NEVER;
  }
  return trimmed;
});

/** Optional ISO date: blank → null; otherwise must match YYYY-MM-DD. */
export const optionalIsoDateString = z.string().transform((s, ctx): string | null => {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    ctx.addIssue({ code: "custom", message: "Use YYYY-MM-DD" });
    return z.NEVER;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: "custom", message: "Not a real date" });
    return z.NEVER;
  }
  return trimmed;
});

/**
 * CSV-cell helpers — semantically similar to the form helpers but tagged
 * separately so the call site can be explicit about wire-format vs form-input.
 * (papaparse always emits string, never undefined, for a known column.)
 */

/** CSV integer cell: "" → null; anything else must parse to a finite integer. */
export const csvOptionalInteger = z.string().transform((s, ctx): number | null => {
  if (s === "") return null;
  const n = Number(s.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    ctx.addIssue({ code: "custom", message: `Expected an integer, got "${s}"` });
    return z.NEVER;
  }
  return n;
});

/** CSV required integer cell (rejects empty + non-numeric). */
export const csvRequiredInteger = z.string().transform((s, ctx): number => {
  const trimmed = s.trim();
  if (trimmed === "") {
    ctx.addIssue({ code: "custom", message: "Required integer field is empty" });
    return z.NEVER;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    ctx.addIssue({ code: "custom", message: `Expected an integer, got "${s}"` });
    return z.NEVER;
  }
  return n;
});

/** CSV boolean cell: "" → false, "0" → false, "1" → true. Else rejected. */
export const csvBoolean = z
  .union([z.literal(""), z.literal("0"), z.literal("1")])
  .transform((s): boolean => s === "1");

/** CSV ISO date cell: required, YYYY-MM-DD only. */
export const csvIsoDate = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), { message: "Use YYYY-MM-DD" });

/** CSV ISO date cell, optional: "" → null. */
export const csvOptionalIsoDate = z.string().transform((s, ctx): string | null => {
  if (s === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    ctx.addIssue({ code: "custom", message: `Expected YYYY-MM-DD, got "${s}"` });
    return z.NEVER;
  }
  return s;
});

// Internal: previously used to coerce strings; kept for any direct callers.
export { parseInt10 };
