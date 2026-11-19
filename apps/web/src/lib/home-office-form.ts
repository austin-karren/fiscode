import { parseWholeNumber } from "@fiscode/core";
import { z } from "zod";

import { optionalMoneyAmountOrZero, optionalSqft } from "./field-schemas";

/**
 * Rules shared by the home office add form and its Edit dialog (d-data #53,
 * "Contract for d-ux").
 */

/** The office cannot be larger than the home: the engine would deduct $0. */
export const AREA_MESSAGE = "Larger than the home";

/** "You can use the simplified method for only one home" a year (IRS). */
export const SECOND_SIMPLIFIED_MESSAGE = "One simplified home a year";

const whole = (raw: string): number | undefined => {
  const parsed = parseWholeNumber(raw);
  return parsed.ok ? parsed.value : undefined;
};

/**
 * The office field's message when both areas are whole numbers and the
 * office is the larger. Blank or unreadable input is left to each field's own
 * validator.
 */
export const officeAreaError = (officeSqft: string, homeSqft: string): string | undefined => {
  const office = whole(officeSqft);
  const home = whole(homeSqft);
  return office !== undefined && home !== undefined && office > home ? AREA_MESSAGE : undefined;
};

type Config = {
  id?: string;
  method: string;
  startDate: string;
  endDate: string | null;
  deletedAt?: string | null;
};

const yearOfIso = (iso: string) => Number(iso.slice(0, 4));

/**
 * Whether `candidate`, a simplified config, shares a calendar year with
 * another live simplified config. The row being edited (same id) does not
 * count.
 *
 * Each config is in use from its start until its end date, or until the next
 * config starts, whichever is earlier: a config "applies until the next one
 * starts", and the engine gives shared days to the later start (a move).
 */
export const overlapsSimplified = (rows: readonly Config[], candidate: Config): boolean => {
  if (candidate.method !== "simplified") return false;
  const live = rows.filter((r) => !r.deletedAt && !(candidate.id && r.id === candidate.id));
  const all = [...live, candidate].sort((a, b) => a.startDate.localeCompare(b.startDate));
  // The calendar years each config is in use.
  const span = (c: Config): [number, number] => {
    const next = all.find((o) => o !== c && o.startDate > c.startDate);
    const endYear = c.endDate ? yearOfIso(c.endDate) : Number.POSITIVE_INFINITY;
    // It stops the day before the next one starts: that day's year, or the
    // year before when the next starts on Jan 1.
    const nextYear = next
      ? next.startDate.slice(5) === "01-01"
        ? yearOfIso(next.startDate) - 1
        : yearOfIso(next.startDate)
      : Number.POSITIVE_INFINITY;
    return [yearOfIso(c.startDate), Math.min(endYear, nextYear)];
  };
  const [from, to] = span(candidate);
  return live.some((r) => {
    if (r.method !== "simplified") return false;
    const [rFrom, rTo] = span(r);
    return rFrom <= to && from <= rTo;
  });
};

/** The fields of a home office config, as the form holds them. */
export const homeOfficeFieldSchemas = {
  startDate: z.date({ message: "Pick a start date" }),
  endDate: z.date().optional(),
  method: z.enum(["simplified", "actual"], { message: "Pick a method" }),
  officeSqft: optionalSqft,
  homeSqft: optionalSqft,
  rentMortgage: optionalMoneyAmountOrZero,
  utilities: optionalMoneyAmountOrZero,
  insurance: optionalMoneyAmountOrZero,
};

/** Office no larger than the home, checked on submit as on blur. */
export const withAreaCheck = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((value, ctx) => {
    const v = value as { officeSqft: number | null; homeSqft: number | null };
    if (v.officeSqft !== null && v.homeSqft !== null && v.officeSqft > v.homeSqft) {
      ctx.addIssue({ code: "custom", path: ["officeSqft"], message: AREA_MESSAGE });
    }
  });

/** Cents as the money field's text ("1375.00"), blank for none. */
export const centsField = (c: number | null): string => (c === null ? "" : (c / 100).toFixed(2));
