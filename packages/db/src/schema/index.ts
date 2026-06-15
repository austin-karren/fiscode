export * from "./profile.ts";
export * from "./entity.ts";
export * from "./clients.ts";
export * from "./income.ts";
export * from "./time.ts";
export * from "./vehicles.ts";
export * from "./home-office.ts";
export * from "./expenses.ts";
export * from "./retirement.ts";
export * from "./history.ts";
export * from "./tax-year-cache.ts";

import { profile } from "./profile.ts";
import { entity, spouse } from "./entity.ts";
import { client } from "./clients.ts";
import { income } from "./income.ts";
import { timeEntry } from "./time.ts";
import { vehicle, mileage } from "./vehicles.ts";
import { homeOffice } from "./home-office.ts";
import { expense } from "./expenses.ts";
import { retirementContribution } from "./retirement.ts";
import { history } from "./history.ts";
import { taxYearCache } from "./tax-year-cache.ts";

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
  history,
  taxYearCache,
} as const;
