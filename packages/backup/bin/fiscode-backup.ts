#!/usr/bin/env bun
// Headless backups (contract: d-data drafts/contract-backup.md). Run with Bun from the repo:
//   bun packages/backup/bin/fiscode-backup.ts <command> ...
// Commands:
//   verify <backup.zip> [--allow-missing]                                 every check a restore makes; exit 1 on a problem
//   restore <backup.zip> --to <dir>                     into a new, empty profile directory
//   backup --from <dir> --out <backup.zip> [--created-at <iso>]
//   check-roundtrip <backup.zip>                        restore, back up again, compare bytes; exit 0 = same
//   summary <backup.zip>                                JSON: counts, dates, schema, document paths
import { writeFileSync } from "node:fs";
import {
  backupDir,
  checkRoundtrip,
  restoreBackupToDir,
  describeMissing,
  summarizeBackup,
  verifyBackup,
} from "../src/node.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const need = (value: string | undefined, what: string): string => {
  if (!value) throw new Error(`Missing ${what}. Run with no arguments for usage.`);
  return value;
};

const usage = `usage:
  fiscode-backup verify <backup.zip> [--allow-missing]   (exit 3 when files are listed as missing)
  fiscode-backup restore <backup.zip> --to <dir>
  fiscode-backup backup --from <dir> --out <backup.zip> [--created-at <iso>]
  fiscode-backup check-roundtrip <backup.zip>
  fiscode-backup summary <backup.zip>`;

const main = async (): Promise<number> => {
  const [command, target] = args;
  switch (command) {
    case "verify": {
      const { manifest: m, missing } = await verifyBackup(need(target, "the backup file"));
      console.log(
        `ok: ${m.counts.rows} rows, ${m.counts.documents} documents, ${m.counts.blobs} files, made ${m.createdAt}`,
      );
      const note = describeMissing(missing);
      if (note) console.log(note);
      return note && !args.includes("--allow-missing") ? 3 : 0;
    }
    case "restore": {
      const to = need(flag("--to"), "--to <dir>");
      const { manifest: m, missing } = await restoreBackupToDir(
        need(target, "the backup file"),
        to,
      );
      console.log(`restored ${m.counts.rows} rows and ${m.counts.blobs} files into ${to}`);
      const note = describeMissing(missing);
      if (note) console.log(note);
      return 0;
    }
    case "backup": {
      const out = need(flag("--out"), "--out <backup.zip>");
      const { bytes, manifest } = await backupDir(need(flag("--from"), "--from <dir>"), {
        createdAt: flag("--created-at") ?? new Date().toISOString(),
      });
      writeFileSync(out, bytes);
      console.log(`wrote ${out}: ${manifest.counts.rows} rows, ${manifest.counts.blobs} files`);
      return 0;
    }
    case "check-roundtrip": {
      const { identical } = await checkRoundtrip(need(target, "the backup file"));
      console.log(
        identical ? "identical" : "DIFFERENT: the restored profile backs up to other bytes",
      );
      return identical ? 0 : 1;
    }
    case "summary": {
      console.log(JSON.stringify(await summarizeBackup(need(target, "the backup file")), null, 2));
      return 0;
    }
    default:
      console.log(usage);
      return command ? 2 : 0;
  }
};

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
