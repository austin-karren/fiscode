import { type Cents, cents } from "@fiscode/core";
import type { YearConfig } from "./types.ts";

/**
 * The business mileage rate in force on `date` (dollars per mile): the last
 * rate whose `from` is on or before the date. A date before the first rate,
 * or in a fallback year, gets the nearest rate the config knows.
 */
export const mileageRateOn = (cfg: YearConfig, date: string): number => {
  let rate = cfg.mileageRates[0]!.ratePerMile;
  for (const r of cfg.mileageRates) if (r.from <= date) rate = r.ratePerMile;
  return rate;
};

/**
 * The standard-mileage deduction for `trips`, each at the rate in force on
 * its date. Miles are summed per rate first, so the result is rounded once
 * per rate, in integer math (rates are whole tenths of a cent).
 */
export const mileageDeduction = (
  trips: ReadonlyArray<{ date: string; businessMiles: number }>,
  cfg: YearConfig,
): Cents => {
  const milesByRate = new Map<number, number>();
  for (const t of trips) {
    const rate = mileageRateOn(cfg, t.date);
    milesByRate.set(rate, (milesByRate.get(rate) ?? 0) + t.businessMiles);
  }
  let total = 0;
  for (const [rate, miles] of milesByRate) {
    const tenthsOfCent = Math.round(rate * 1000);
    total += Math.round((miles * tenthsOfCent) / 10);
  }
  return cents(total);
};
