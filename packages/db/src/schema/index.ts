export * from "./profile.ts";
export * from "./entity.ts";
export * from "./clients.ts";
export * from "./income.ts";
export * from "./time.ts";
export * from "./vehicles.ts";
export * from "./home-office.ts";
export * from "./expenses.ts";
export * from "./retirement.ts";
export * from "./payments.ts";
export * from "./documents.ts";
export * from "./history.ts";
export * from "./tax-year-cache.ts";
export * from "./vault.ts";

import { profile } from "./profile.ts";
import { entity, spouse } from "./entity.ts";
import { client } from "./clients.ts";
import { income } from "./income.ts";
import { timeEntry } from "./time.ts";
import { vehicle, mileage } from "./vehicles.ts";
import { homeOffice } from "./home-office.ts";
import { expense } from "./expenses.ts";
import { retirementContribution } from "./retirement.ts";
import { estimatedPayment, w2Job } from "./payments.ts";
import { document, documentFolder, documentLink } from "./documents.ts";
import { history } from "./history.ts";
import { taxYearCache } from "./tax-year-cache.ts";
import { meta, vaultApplied } from "./vault.ts";

export const tables = {
  profile,
  entity,
  spouse,
  client,
  income,
  timeEntry,
  vehicle,
  mileage,
  homeOffice,
  expense,
  retirementContribution,
  w2Job,
  estimatedPayment,
  documentFolder,
  document,
  documentLink,
  history,
  taxYearCache,
  vaultApplied,
  meta,
} as const;
