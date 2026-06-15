#!/usr/bin/env bun
/**
 * Generate the canonical example CSV that the docs site serves as a download.
 * Run via `bun run example:csv` from the repo root. Writes to:
 *
 *   apps/fumadocs/public/downloads/example.csv
 *
 * The actual bundle lives in `src/example.ts` so the script and the
 * `example.test.ts` round-trip test share the same source of truth.
 * Re-run this whenever the CSV schema changes — keeps the download in sync
 * with packages/csv/src/schema.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE_FIXED_TIMESTAMP, exampleBundle, exportBundle } from "../src/index.ts";

const csv = exportBundle(exampleBundle(), { scope: "full", exportedAt: EXAMPLE_FIXED_TIMESTAMP });

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "apps", "fumadocs", "public", "downloads");
const outPath = join(outDir, "example.csv");
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, csv, "utf8");

console.log(`Wrote ${outPath} (${csv.length} bytes, ${csv.split("\n").length} lines)`);
