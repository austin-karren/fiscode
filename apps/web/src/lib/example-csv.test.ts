import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXAMPLE_FIXED_TIMESTAMP,
  applyImport,
  emptyBundle,
  exampleBundle,
  exportBundle,
  parseCsv,
} from "@fiscode/csv";
import { buildBundle, importBundle, taxYearCacheRepo } from "@fiscode/db";
import { setupTestDb, teardownTestDb } from "@fiscode/db/test";

/**
 * Prove the published example.csv survives the full import chain users
 * actually trigger when they download it and click Import:
 *
 *   filesystem example.csv → parseCsv → applyImport → importBundle →
 *   buildBundle → equals exampleBundle()
 *
 * If a schema change ever lands without regenerating the download, or the
 * importer drops a field, the production example becomes a footgun. This
 * test catches that.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_CSV_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "fumadocs",
  "public",
  "downloads",
  "example.csv",
);

const sortById = <T extends { id: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

const normalize = <T extends { id: string }>(rows: T[]): T[] => sortById(rows);

let sqlite: ReturnType<typeof setupTestDb>;
beforeEach(() => {
  sqlite = setupTestDb();
});
afterEach(() => {
  teardownTestDb(sqlite);
});

describe("published example.csv — full import chain", () => {
  it("the on-disk example.csv matches what `bun run example:csv` would emit", () => {
    const expected = exportBundle(exampleBundle(), {
      scope: "full",
      exportedAt: EXAMPLE_FIXED_TIMESTAMP,
    });
    const onDisk = readFileSync(EXAMPLE_CSV_PATH, "utf8");
    expect(onDisk).toBe(expected);
  });

  it("parseCsv accepts the published file with zero validation errors", () => {
    const onDisk = readFileSync(EXAMPLE_CSV_PATH, "utf8");
    const { bundle, validationErrors } = parseCsv(onDisk);
    expect(validationErrors).toEqual([]);
    // The parsed bundle equals the in-memory bundle (modulo array ordering).
    const reference = exampleBundle();
    expect(bundle.profile).toEqual(reference.profile);
    expect(normalize(bundle.clients)).toEqual(normalize(reference.clients));
    expect(normalize(bundle.income)).toEqual(normalize(reference.income));
    expect(normalize(bundle.expenses)).toEqual(normalize(reference.expenses));
    expect(normalize(bundle.mileage)).toEqual(normalize(reference.mileage));
    expect(normalize(bundle.entities)).toEqual(normalize(reference.entities));
    expect(normalize(bundle.spouses)).toEqual(normalize(reference.spouses));
    expect(normalize(bundle.timeEntries)).toEqual(normalize(reference.timeEntries));
    expect(normalize(bundle.vehicles)).toEqual(normalize(reference.vehicles));
    expect(normalize(bundle.homeOffice)).toEqual(normalize(reference.homeOffice));
    expect(normalize(bundle.retirementContributions)).toEqual(
      normalize(reference.retirementContributions),
    );
  });

  it("Import → overwrite path lands every row in the DB and buildBundle reads them back", async () => {
    const onDisk = readFileSync(EXAMPLE_CSV_PATH, "utf8");
    const { bundle: parsed, validationErrors } = parseCsv(onDisk);
    expect(validationErrors).toEqual([]);

    // This is what the import-card.tsx component actually does:
    const applied = applyImport(emptyBundle(), parsed, "overwrite");
    await importBundle(applied.next, "import-overwrite");

    const round = await buildBundle();
    const reference = exampleBundle();

    // Every record_type made it through.
    expect(round.profile?.filingStatus).toBe("mfj");
    expect(round.entities).toHaveLength(reference.entities.length);
    expect(round.spouses).toHaveLength(reference.spouses.length);
    expect(round.clients).toHaveLength(reference.clients.length);
    expect(round.income).toHaveLength(reference.income.length);
    expect(round.timeEntries).toHaveLength(reference.timeEntries.length);
    expect(round.vehicles).toHaveLength(reference.vehicles.length);
    expect(round.mileage).toHaveLength(reference.mileage.length);
    expect(round.homeOffice).toHaveLength(reference.homeOffice.length);
    expect(round.expenses).toHaveLength(reference.expenses.length);
    expect(round.retirementContributions).toHaveLength(reference.retirementContributions.length);

    // Field-exact equality (modulo ordering) on the rows that the tax engine
    // cares about — these are the ones a user actually depends on.
    expect(normalize(round.income)).toEqual(normalize(reference.income));
    expect(normalize(round.expenses)).toEqual(normalize(reference.expenses));
    expect(normalize(round.mileage)).toEqual(normalize(reference.mileage));
    expect(normalize(round.homeOffice)).toEqual(normalize(reference.homeOffice));
  });

  it("Import → append path on a fresh DB produces the same end state as overwrite", async () => {
    const onDisk = readFileSync(EXAMPLE_CSV_PATH, "utf8");
    const { bundle: parsed } = parseCsv(onDisk);
    const applied = applyImport(emptyBundle(), parsed, "append");
    expect(applied.conflicts).toEqual([]);
    await importBundle(applied.next, "import-append");

    const round = await buildBundle();
    expect(round.profile?.state).toBe("UT");
    expect(round.income.map((r) => r.id).sort()).toEqual(
      exampleBundle()
        .income.map((r) => r.id)
        .sort(),
    );
  });

  it("import history is recorded (revertible)", async () => {
    const onDisk = readFileSync(EXAMPLE_CSV_PATH, "utf8");
    const { bundle: parsed } = parseCsv(onDisk);
    await importBundle(applyImport(emptyBundle(), parsed, "overwrite").next, "import-overwrite");

    // The tax_year_cache table should still be empty after a data import
    // (it's a separate cache, not part of the user-bundle).
    const cache = await taxYearCacheRepo.list();
    expect(cache).toEqual([]);
  });
});
