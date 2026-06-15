import type { YearConfig } from "../types.ts";
import { getOverlayYearConfig } from "../sync/overlay.ts";
import { config2025 } from "./2025.ts";
import { config2026 } from "./2026.ts";

const REGISTRY: Record<number, YearConfig> = {
  2025: config2025,
  2026: config2026,
};

/**
 * Resolve a YearConfig with this precedence:
 *   1. Remote-mirrored overlay (populated from cache + foreground sync)
 *   2. Hardcoded registry (2025, 2026)
 *   3. Nearest-year fallback (with a console warning)
 */
export const getYearConfig = (year: number): YearConfig => {
  const overlay = getOverlayYearConfig(year);
  if (overlay) return overlay;
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

/** Source of the resolved year config (for UI: "remote" vs "hardcoded"). */
export const getYearConfigSource = (
  year: number,
): { source: "remote" | "hardcoded" | "fallback"; usedYear: number } => {
  if (getOverlayYearConfig(year)) return { source: "remote", usedYear: year };
  if (year in REGISTRY) return { source: "hardcoded", usedYear: year };
  const known = Object.keys(REGISTRY)
    .map(Number)
    .sort((a, b) => a - b);
  const nearest = known.reduce((best, y) =>
    Math.abs(y - year) < Math.abs(best - year) ? y : best,
  );
  return { source: "fallback", usedYear: nearest };
};

export const hasExactConfig = (year: number): boolean => year in REGISTRY;

/** Year keys with a hardcoded fallback config baked into the bundle. */
export const HARDCODED_CONFIG_YEARS = Object.keys(REGISTRY)
  .map(Number)
  .sort((a, b) => a - b);

export { config2025, config2026 };
