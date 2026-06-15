import { afterEach, describe, expect, it } from "vitest";
import { config2026 } from "../config/2026.ts";
import { getYearConfig, getYearConfigSource } from "../config/index.ts";
import {
  clearOverlay,
  getOverlayMeta,
  getOverlayYearConfig,
  listOverlayYears,
  registerOverlayYearConfig,
} from "./overlay.ts";

afterEach(() => clearOverlay());

describe("overlay registry", () => {
  it("registers and reads back a config + meta", () => {
    registerOverlayYearConfig(config2026, {
      fetchedAt: "2026-01-01T00:00:00Z",
      source: "test",
      sourceUrl: "https://example.com/2026.json",
      schemaVersion: "v1",
    });
    expect(getOverlayYearConfig(2026)?.year).toBe(2026);
    expect(getOverlayMeta(2026)?.source).toBe("test");
    expect(listOverlayYears()).toEqual([2026]);
  });

  it("clear empties the registry", () => {
    registerOverlayYearConfig(config2026, {
      fetchedAt: "2026-01-01T00:00:00Z",
      source: "test",
      sourceUrl: "x",
      schemaVersion: "v1",
    });
    clearOverlay();
    expect(getOverlayYearConfig(2026)).toBeUndefined();
    expect(listOverlayYears()).toEqual([]);
  });
});

describe("getYearConfig — overlay precedence", () => {
  it("returns the overlay config when one is registered", () => {
    const tweaked = { ...config2026, ssWageBase: 999_999_99 as never };
    registerOverlayYearConfig(tweaked, {
      fetchedAt: "2026-01-01T00:00:00Z",
      source: "test-override",
      sourceUrl: "x",
      schemaVersion: "v1",
    });
    expect(getYearConfig(2026).ssWageBase).toBe(999_999_99);
    expect(getYearConfigSource(2026)).toEqual({ source: "remote", usedYear: 2026 });
  });

  it("falls back to hardcoded when no overlay is registered", () => {
    expect(getYearConfig(2026).ssWageBase).toBe(config2026.ssWageBase);
    expect(getYearConfigSource(2026)).toEqual({ source: "hardcoded", usedYear: 2026 });
  });

  it("reports source 'fallback' for unknown years", () => {
    // Suppress the warn for cleanliness.
    const warn = console.warn;
    console.warn = () => {};
    try {
      const r = getYearConfigSource(2030);
      expect(r.source).toBe("fallback");
      expect(r.usedYear).toBe(2026);
    } finally {
      console.warn = warn;
    }
  });
});
