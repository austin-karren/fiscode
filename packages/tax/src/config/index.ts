import type { YearConfig } from "../types.ts";
import { config2025 } from "./2025.ts";
import { config2026 } from "./2026.ts";

const REGISTRY: Record<number, YearConfig> = {
  2025: config2025,
  2026: config2026,
};

export const getYearConfig = (year: number): YearConfig => {
  const exact = REGISTRY[year];
  if (exact) return exact;
  const known = Object.keys(REGISTRY)
    .map(Number)
    .sort((a, b) => a - b);
  const nearest = known.reduce((best, y) =>
    Math.abs(y - year) < Math.abs(best - year) ? y : best,
  );
  // eslint-disable-next-line no-console
  console.warn(
    `[fiscode/tax] no config for ${year}; falling back to ${nearest}. Values may be stale — verify against IRS/SSA.`,
  );
  return { ...REGISTRY[nearest]!, year };
};

export const hasExactConfig = (year: number): boolean => year in REGISTRY;

export { config2025, config2026 };
