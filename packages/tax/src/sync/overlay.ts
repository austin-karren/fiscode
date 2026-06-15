import type { YearConfig } from "../types.ts";

/**
 * In-memory overlay of remotely-sourced year configs. The web app populates
 * this on boot by reading the on-disk cache; subsequent foreground syncs
 * update both the cache AND the overlay so the running session sees fresh
 * numbers without reload.
 *
 * The overlay is checked BEFORE the hardcoded config registry in
 * `getYearConfig`. Hardcoded values become the fallback for years not yet
 * mirrored.
 */

const _overlay = new Map<number, YearConfig>();
const _meta = new Map<number, OverlayMeta>();

export type OverlayMeta = {
  fetchedAt: string;
  source: string;
  sourceUrl: string;
  schemaVersion: string;
};

export const registerOverlayYearConfig = (cfg: YearConfig, meta: OverlayMeta): void => {
  _overlay.set(cfg.year, cfg);
  _meta.set(cfg.year, meta);
};

export const getOverlayYearConfig = (year: number): YearConfig | undefined => _overlay.get(year);

export const getOverlayMeta = (year: number): OverlayMeta | undefined => _meta.get(year);

export const listOverlayYears = (): number[] => Array.from(_overlay.keys()).sort();

export const clearOverlay = (): void => {
  _overlay.clear();
  _meta.clear();
};
