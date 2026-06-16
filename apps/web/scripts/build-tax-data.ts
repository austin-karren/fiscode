#!/usr/bin/env bun
/**
 * Generate static tax-year wire payloads into apps/web/public/tax-data/v1/{year}.json
 * so the SPA can fetch them same-origin at runtime. Runs as a prebuild/predev hook.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  TAX_YEAR_WIRE_SCHEMA_VERSION,
  config2025,
  config2026,
  yearConfigToWire,
} from "@fiscode/tax";

const generatedAt = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString();

const PAYLOADS = [
  { year: 2025, cfg: config2025 },
  { year: 2026, cfg: config2026 },
];

const outDir = resolve(import.meta.dir, "..", "public", "tax-data", TAX_YEAR_WIRE_SCHEMA_VERSION);

for (const { year, cfg } of PAYLOADS) {
  const wire = yearConfigToWire(cfg, `fiscode-bundled ${year}`, generatedAt);
  const path = resolve(outDir, `${year}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(wire, null, 2)}\n`);
  console.log(`[build-tax-data] wrote ${path}`);
}
