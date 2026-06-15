#!/usr/bin/env bun
/**
 * Smoke test: stand up a local HTTP server serving the v1 wire format for
 * the 2026 tax year, then exercise the fetch → zod-validate → wireToYearConfig
 * chain against it. Pass/fail printed; exit 0 on success, 1 on failure.
 *
 * Usage:  bun packages/tax/scripts/smoke-fetch.ts
 */
import { createServer } from "node:http";
import { config2025, config2026 } from "../src/config/index.ts";
import {
  TAX_YEAR_WIRE_SCHEMA_VERSION,
  taxYearDataUrl,
  taxYearWireSchema,
  wireToYearConfig,
  yearConfigToWire,
} from "../src/sync/wire.ts";

const PORT = 8765;
const BASE = `http://localhost:${PORT}/tax-data`;

const PAYLOADS = {
  2025: yearConfigToWire(config2025, "smoke-test 2025", "2025-01-15T00:00:00.000Z"),
  2026: yearConfigToWire(config2026, "smoke-test 2026", "2026-01-15T00:00:00.000Z"),
};

const server = createServer((req, res) => {
  // Path convention: /tax-data/v1/{year}.json
  const match = req.url?.match(/\/tax-data\/v1\/(\d{4})\.json$/);
  if (!match) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const year = Number(match[1]) as keyof typeof PAYLOADS;
  const payload = PAYLOADS[year];
  if (!payload) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`no fixture for year ${year}`);
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json",
    etag: `W/"smoke-${year}"`,
  });
  res.end(JSON.stringify(payload));
});

await new Promise<void>((resolve) => server.listen(PORT, resolve));

type Step = { name: string; ok: boolean; detail?: string };
const steps: Step[] = [];
const log = (s: Step) => {
  steps.push(s);
  const tag = s.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${tag} ${s.name}${s.detail ? ` — ${s.detail}` : ""}`);
};

const fetchAndValidate = async (year: number) => {
  const url = taxYearDataUrl(year, BASE);
  console.log(`\nfetch ${url}`);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  log({ name: "HTTP 200 OK", ok: res.status === 200, detail: `status=${res.status}` });
  log({
    name: "Content-Type is application/json",
    ok: (res.headers.get("content-type") ?? "").startsWith("application/json"),
  });
  log({
    name: "Server provided an ETag",
    ok: !!res.headers.get("etag"),
    detail: res.headers.get("etag") ?? "(none)",
  });

  const json = await res.json();
  const parsed = taxYearWireSchema.safeParse(json);
  log({
    name: "Payload passes zod schema",
    ok: parsed.success,
    detail: parsed.success
      ? `schemaVersion=${parsed.data.schemaVersion}, source="${parsed.data.source}"`
      : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  });
  if (!parsed.success) return false;

  log({
    name: `Payload year matches request (${year})`,
    ok: parsed.data.year === year,
  });
  log({
    name: `schemaVersion is "${TAX_YEAR_WIRE_SCHEMA_VERSION}"`,
    ok: parsed.data.schemaVersion === TAX_YEAR_WIRE_SCHEMA_VERSION,
  });

  const cfg = wireToYearConfig(parsed.data);
  const reference = year === 2026 ? config2026 : config2025;

  log({
    name: "ssWageBase round-trips exactly (cents)",
    ok: cfg.ssWageBase === reference.ssWageBase,
    detail: `${cfg.ssWageBase} === ${reference.ssWageBase}`,
  });
  log({
    name: "standardDeduction.mfj round-trips exactly",
    ok: cfg.standardDeduction.mfj === reference.standardDeduction.mfj,
    detail: `${cfg.standardDeduction.mfj} === ${reference.standardDeduction.mfj}`,
  });
  log({
    name: "mileageRatePerMile preserved",
    ok: cfg.mileageRatePerMile === reference.mileageRatePerMile,
    detail: `${cfg.mileageRatePerMile} === ${reference.mileageRatePerMile}`,
  });
  log({
    name: "quarterlyDueDates preserved",
    ok: JSON.stringify(cfg.quarterlyDueDates) === JSON.stringify(reference.quarterlyDueDates),
    detail: JSON.stringify(cfg.quarterlyDueDates),
  });
  const deepEqual = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === "object" && typeof b === "object") {
      const ao = a as Record<string, unknown>;
      const bo = b as Record<string, unknown>;
      const aKeys = Object.keys(ao);
      const bKeys = Object.keys(bo);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every((k) => deepEqual(ao[k], bo[k]));
    }
    return false;
  };
  log({
    name: "Full YearConfig deep-equals reference",
    ok: deepEqual(cfg, reference),
  });

  return true;
};

const test404 = async () => {
  const url = `${BASE}/v1/2099.json`;
  console.log(`\nfetch ${url} (expecting 404)`);
  const res = await fetch(url);
  log({ name: "Unknown year returns 404", ok: res.status === 404, detail: `status=${res.status}` });
};

const testBadPayload = async () => {
  // Stand up a one-shot bad responder on a different path.
  console.log("\nfetch http://localhost:8765/bad.json (malformed JSON)");
  const url = `http://localhost:${PORT}/bad.json`;
  const res = await fetch(url);
  log({ name: "Unknown path returns 404", ok: res.status === 404 });
};

try {
  await fetchAndValidate(2026);
  await fetchAndValidate(2025);
  await test404();
  await testBadPayload();
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const failed = steps.filter((s) => !s.ok);
console.log(
  `\n${steps.length - failed.length}/${steps.length} checks passed` +
    (failed.length === 0 ? " — \x1b[32mOK\x1b[0m" : ` — \x1b[31mFAILED\x1b[0m`),
);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exit(1);
}
process.exit(0);
