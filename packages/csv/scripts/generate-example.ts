#!/usr/bin/env bun
/**
 * Generate the canonical example CSV that the docs site serves as a download.
 * Run via `bun run example:csv` from the repo root. Writes to:
 *
 *   apps/fumadocs/public/downloads/example.csv
 *
 * The bundle here intentionally exercises every record_type so a reader
 * copying-and-pasting has a concrete example of each row shape. Values are
 * synthetic but realistic (a sole-prop consultant, mid-year, MFJ).
 *
 * Re-run this whenever the CSV schema changes — keeps the download in sync
 * with packages/csv/src/schema.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportBundle, type Bundle } from "../src/index.ts";

const FIXED = "2026-06-04T12:00:00.000Z";

const bundle: Bundle = {
  profile: {
    id: "profile",
    filingStatus: "mfj",
    state: "UT",
    seStartDate: "2024-01-01",
    dependents: 0,
    tracksRoth: true,
    usesRetirement: true,
    quarterlyMethod: "annualized",
    prepLeadDays: 14,
    createdAt: FIXED,
    updatedAt: FIXED,
  },
  entities: [
    {
      id: "ent_01HXSP00ENTITY0000000",
      type: "sole_prop",
      startDate: "2024-01-01",
      endDate: null,
      notes: "Filed DBA in Q1 2024.",
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  spouses: [
    {
      id: "sp_01HXSP00SPOUSE0000001",
      startDate: "2024-01-01",
      endDate: null,
      annualW2WagesCents: 45_000_00,
      annualFederalWithholdingCents: 4_500_00,
      annualStateWithholdingCents: 1_800_00,
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  clients: [
    {
      id: "cl_01HXSP00CLIENT0000001",
      name: "Stable Commission Co",
      type: "recurring",
      notes: "Monthly retainer + bonus structure.",
      defaultRateCents: null,
      defaultCommissionRate: 600,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
    {
      id: "cl_01HXSP00CLIENT0000002",
      name: "Ad-hoc Consulting",
      type: "consulting",
      notes: null,
      defaultRateCents: 15_000_00,
      defaultCommissionRate: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  income: [
    {
      id: "in_01HXSP00INCOME0000001",
      date: "2026-01-15",
      clientId: "cl_01HXSP00CLIENT0000001",
      amountCents: 10_000_00,
      sourceType: "1099",
      kind: "recurring",
      description: "January retainer",
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
    {
      id: "in_01HXSP00INCOME0000002",
      date: "2026-03-31",
      clientId: "cl_01HXSP00CLIENT0000001",
      amountCents: 3_500_00,
      sourceType: "1099",
      kind: "bonus",
      description: "Q1 commission bonus",
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
    {
      id: "in_01HXSP00INCOME0000003",
      date: "2026-07-10",
      clientId: "cl_01HXSP00CLIENT0000002",
      amountCents: 6_250_00,
      sourceType: "1099",
      kind: "consulting",
      description: "Q3 engagement",
      notes: "Includes $250 travel reimbursement (deducted separately).",
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  timeEntries: [
    {
      id: "te_01HXSP00TIME000000001",
      date: "2026-01-15",
      clientId: "cl_01HXSP00CLIENT0000001",
      minutes: 480,
      description: "Full day onsite",
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  vehicles: [
    {
      id: "v_01HXSP00VEHICLE000001",
      make: "Toyota",
      model: "RAV4",
      year: 2022,
      mpg: 28,
      method: "standard_mileage",
      inServiceDate: "2024-01-01",
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  mileage: [
    {
      id: "mi_01HXSP00MILEAGE000001",
      date: "2026-02-10",
      vehicleId: "v_01HXSP00VEHICLE000001",
      businessMiles: 47,
      purpose: "Client visit (Stable Commission Co)",
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
    {
      id: "mi_01HXSP00MILEAGE000002",
      date: "2026-07-08",
      vehicleId: "v_01HXSP00VEHICLE000001",
      businessMiles: 124,
      purpose: "Conference (Ad-hoc Consulting)",
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  homeOffice: [
    {
      id: "ho_01HXSP00HOMEOFFICE001",
      startDate: "2024-01-01",
      endDate: null,
      method: "simplified",
      officeSqft: 150,
      homeSqft: 2000,
      monthlyRentMortgageCents: null,
      monthlyUtilitiesCents: null,
      monthlyInsuranceCents: null,
      regularExclusiveAck: true,
      notes: null,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  expenses: [
    {
      id: "ex_01HXSP00EXPENSE000001",
      date: "2026-01-20",
      amountCents: 89_999,
      category: "equipment",
      clientId: null,
      description: "Standing desk",
      reason: "Home-office setup stipend purchase.",
      notes: null,
      flagForSection179: true,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
    {
      id: "ex_01HXSP00EXPENSE000002",
      date: "2026-03-05",
      amountCents: 12_000,
      category: "software_subs",
      clientId: null,
      description: "Linear annual subscription",
      reason: "PM tooling",
      notes: null,
      flagForSection179: false,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
    {
      id: "ex_01HXSP00EXPENSE000003",
      date: "2026-07-09",
      amountCents: 25_000,
      category: "travel",
      clientId: "cl_01HXSP00CLIENT0000002",
      description: "Conference hotel + airfare",
      reason: null,
      notes: null,
      flagForSection179: false,
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
  retirementContributions: [
    {
      id: "ret_01HXSP00RETIRE0000001",
      date: "2026-04-15",
      account: "roth_ira",
      amountCents: 7_000_00,
      notes: "Personal Roth (informational, not deducted).",
      createdAt: FIXED,
      updatedAt: FIXED,
      deletedAt: null,
    },
  ],
};

const csv = exportBundle(bundle, { scope: "full", exportedAt: FIXED });

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "apps", "fumadocs", "public", "downloads");
const outPath = join(outDir, "example.csv");
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, csv, "utf8");

console.log(`Wrote ${outPath} (${csv.length} bytes, ${csv.split("\n").length} lines)`);
