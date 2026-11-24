import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The backup's file name uses the LOCAL date, as the CSV export's does. Pin a zone behind UTC
// for this file (CI runs in UTC, where a UTC date can't show the bug): 22:55 on Nov 20 in Denver
// is 05:55 on Nov 21 in UTC.
const originalTz = process.env.TZ;
process.env.TZ = "America/Denver";

const { exampleBundle } = await import("@fiscode/csv");
const { __setVaultStoreForTests, importBundle, memoryDir, vaultStore } =
  await import("@fiscode/db");
const { setupTestDb, teardownTestDb } = await import("@fiscode/db/test");
const { createBackup } = await import("./index.ts");
const { checkRoundtrip } = await import("./node.ts");

const PASS = "throwaway-test-passphrase";
const LATE_EVENING = "2026-11-21T05:55:00.000Z"; // 22:55 on 2026-11-20 in Denver

let sqlite: Database.Database;
beforeEach(async () => {
  sqlite = setupTestDb();
  __setVaultStoreForTests(vaultStore(memoryDir()));
  await importBundle(exampleBundle() as never, "import-restore");
});
afterEach(() => {
  vi.useRealTimers();
  __setVaultStoreForTests(undefined);
  teardownTestDb(sqlite);
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("backup file name: the local date", () => {
  it("runs in a timezone behind UTC", () => {
    expect(new Date(LATE_EVENING).getDate()).toBe(20);
  });

  it("a backup at 22:55 local on Nov 20 is named for Nov 20, inside and out", async () => {
    const { fileName, manifest } = await createBackup({
      createdAt: LATE_EVENING,
      passphrase: PASS,
      scryptWorkFactor: 10,
    });
    expect(fileName).toBe("fiscode-backup-2026-11-20.zip.age");
    expect(manifest.csv.path).toBe("exports/fiscode-full-backup-2026-11-20.csv");
    expect(manifest.createdAt).toBe(LATE_EVENING); // the instant itself stays UTC
  });

  it("with no createdAt, 'now' is named for today's local date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(LATE_EVENING));
    const { fileName } = await createBackup({ passphrase: PASS, scryptWorkFactor: 10 });
    expect(fileName).toBe("fiscode-backup-2026-11-20.zip.age");
  });

  it("check-roundtrip on a machine in UTC (as CI) rebuilds under the backup's own date: the same zip", async () => {
    const backup = await createBackup({
      createdAt: LATE_EVENING,
      passphrase: PASS,
      scryptWorkFactor: 10,
    });
    const dir = mkdtempSync(join(tmpdir(), "fiscode-backup-tz-"));
    const path = join(dir, backup.fileName);
    writeFileSync(path, new Uint8Array(await backup.blob.arrayBuffer()));
    // Another process, as another machine: its UTC date of createdAt is Nov 21.
    const bin = fileURLToPath(new URL("../bin/fiscode-backup.ts", import.meta.url));
    try {
      const r = spawnSync("bun", [bin, "check-roundtrip", path], {
        encoding: "utf8",
        env: { ...process.env, TZ: "UTC", FISCODE_BACKUP_PASSPHRASE: PASS },
      });
      expect(r.stderr).toBe("");
      expect(r.stdout.trim()).toBe("identical (decrypted contents)");
      expect(r.status).toBe(0);
      // Here too (Denver), still the same zip.
      teardownTestDb(sqlite);
      expect(await checkRoundtrip(path, PASS)).toMatchObject({ identical: true, sameZip: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      sqlite = setupTestDb();
    }
  });
});
