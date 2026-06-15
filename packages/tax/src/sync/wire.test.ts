import { describe, expect, it } from "vitest";
import { config2026 } from "../config/2026.ts";
import { config2025 } from "../config/2025.ts";
import {
  DEFAULT_TAX_DATA_BASE_URL,
  TAX_YEAR_WIRE_SCHEMA_VERSION,
  taxYearDataUrl,
  taxYearWireSchema,
  wireToYearConfig,
  yearConfigToWire,
} from "./wire.ts";

describe("taxYearWireSchema", () => {
  it("accepts a valid 2026 wire payload", () => {
    const wire = yearConfigToWire(config2026, "test", "2026-01-15T00:00:00.000Z");
    const parsed = taxYearWireSchema.safeParse(wire);
    expect(parsed.success).toBe(true);
  });

  it("rejects payloads with the wrong schemaVersion", () => {
    const wire = yearConfigToWire(config2026, "test", "2026-01-15T00:00:00.000Z");
    const bad = { ...wire, schemaVersion: "v999" };
    expect(taxYearWireSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects out-of-range years", () => {
    const wire = yearConfigToWire(config2026, "test", "2026-01-15T00:00:00.000Z");
    expect(taxYearWireSchema.safeParse({ ...wire, year: 1850 }).success).toBe(false);
    expect(taxYearWireSchema.safeParse({ ...wire, year: 3000 }).success).toBe(false);
  });

  it("rejects malformed quarterly due dates", () => {
    const wire = yearConfigToWire(config2026, "test", "2026-01-15T00:00:00.000Z");
    expect(
      taxYearWireSchema.safeParse({
        ...wire,
        quarterlyDueDates: ["2026/04/15", "2026-06-15", "2026-09-15", "2027-01-15"],
      }).success,
    ).toBe(false);
  });

  it("rejects rates outside [0, 1]", () => {
    const wire = yearConfigToWire(config2026, "test", "2026-01-15T00:00:00.000Z");
    expect(taxYearWireSchema.safeParse({ ...wire, mileageRatePerMile: -1 }).success).toBe(false);
    // brackets.mfj[0].rate of 1.5 → > 1.0 → reject
    const bad = JSON.parse(JSON.stringify(wire));
    bad.brackets.mfj[0].rate = 1.5;
    expect(taxYearWireSchema.safeParse(bad).success).toBe(false);
  });
});

describe("wireToYearConfig — round-trip", () => {
  it("2026 wire → YearConfig matches the hardcoded config", () => {
    const wire = yearConfigToWire(config2026, "src", "2026-01-15T00:00:00.000Z");
    const back = wireToYearConfig(wire);
    expect(back).toEqual(config2026);
  });

  it("2025 wire → YearConfig matches the hardcoded config", () => {
    const wire = yearConfigToWire(config2025, "src", "2025-01-15T00:00:00.000Z");
    const back = wireToYearConfig(wire);
    expect(back).toEqual(config2025);
  });

  it("dollars-to-cents conversion is exact (no float drift)", () => {
    const wire = yearConfigToWire(config2026, "src", "2026-01-15T00:00:00.000Z");
    const back = wireToYearConfig(wire);
    expect(back.ssWageBase).toBe(config2026.ssWageBase);
    expect(back.standardDeduction.mfj).toBe(config2026.standardDeduction.mfj);
    expect(back.qbi.taxableIncomeLimit.mfj).toBe(config2026.qbi.taxableIncomeLimit.mfj);
  });
});

describe("taxYearDataUrl", () => {
  it("uses the default base + the schema version path", () => {
    expect(taxYearDataUrl(2026)).toBe(
      `${DEFAULT_TAX_DATA_BASE_URL}/${TAX_YEAR_WIRE_SCHEMA_VERSION}/2026.json`,
    );
  });

  it("respects an override base URL", () => {
    expect(taxYearDataUrl(2026, "https://example.com/data")).toBe(
      `https://example.com/data/${TAX_YEAR_WIRE_SCHEMA_VERSION}/2026.json`,
    );
  });
});
