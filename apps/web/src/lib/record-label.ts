import {
  cents,
  ENTITY_TYPE_LABELS,
  formatUSD,
  HOME_OFFICE_METHOD_LABELS,
  labelFor,
} from "@fiscode/core";

import { formatDate } from "./format-date";

/**
 * Which record a row's Edit or Delete button acts on, for its accessible
 * name ("Delete income Jan 15, 2026, $1,200.00"). Seen, the buttons just say
 * Edit and Delete; a screen reader moving between buttons hears the record.
 */
export const recordLabel = {
  income: (r: { date: string; amountCents: number }) =>
    `income ${formatDate(r.date)}, ${formatUSD(cents(r.amountCents))}`,
  expense: (r: { date: string; amountCents: number }) =>
    `expense ${formatDate(r.date)}, ${formatUSD(cents(r.amountCents))}`,
  mileage: (r: { date: string; businessMiles: number }) =>
    `trip ${formatDate(r.date)}, ${r.businessMiles} miles`,
  time: (r: { date: string; minutes: number }) =>
    `time ${formatDate(r.date)}, ${r.minutes / 60} hours`,
  client: (r: { name: string }) => `client ${r.name}`,
  vehicle: (r: { make: string; model: string; year: number | null }) =>
    `vehicle ${[r.year, r.make, r.model].filter(Boolean).join(" ")}`,
  entity: (r: { type: string; startDate: string }) =>
    `${labelFor(ENTITY_TYPE_LABELS, r.type)} period from ${formatDate(r.startDate)}`,
  spouse: (r: { startDate: string }) => `spouse block from ${formatDate(r.startDate)}`,
  homeOffice: (r: { method: string; startDate: string }) =>
    `${labelFor(HOME_OFFICE_METHOD_LABELS, r.method)} home office from ${formatDate(r.startDate)}`,
};
