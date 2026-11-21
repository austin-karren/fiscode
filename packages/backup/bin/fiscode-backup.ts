#!/usr/bin/env bun
// Headless backups (contract: d-data drafts/contract-backup.md). Run with Bun from the repo:
//   bun packages/backup/bin/fiscode-backup.ts <command> ...
// Commands:
//   verify <backup.zip.age> [--allow-missing]   every check a restore makes; exit 1 on a problem
//   restore <backup.zip.age> --to <dir>         into a new, empty profile directory
//   backup --from <dir> --out <backup.zip.age> [--created-at <iso>]
//   check-roundtrip <backup.zip.age>            restore, back up again, compare the decrypted zips
//   summary <backup.zip.age>                    JSON: counts, dates, schema, document paths
// The passphrase comes from FISCODE_BACKUP_PASSPHRASE, else the file FISCODE_BACKUP_PASSPHRASE_FILE
// (default ~/.config/fiscode/backup-passphrase, chmod 600), else a prompt that doesn't echo. Never an
// argument: arguments show in `ps` and in shell history.
import { closeSync, openSync, readSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  backupDir,
  checkRoundtrip,
  restoreBackupToDir,
  describeMissing,
  resolvePassphrase,
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
  fiscode-backup verify <backup.zip.age> [--allow-missing]   (exit 3 when files are listed as missing)
  fiscode-backup restore <backup.zip.age> --to <dir>
  fiscode-backup backup --from <dir> --out <backup.zip.age> [--created-at <iso>]
  fiscode-backup check-roundtrip <backup.zip.age>
  fiscode-backup summary <backup.zip.age>
Passphrase: FISCODE_BACKUP_PASSPHRASE, else FISCODE_BACKUP_PASSPHRASE_FILE\n(default ~/.config/fiscode/backup-passphrase, chmod 600), else a prompt in a terminal.`;

/** One line from the terminal with echo off. Undefined when there's no terminal. */
const promptHidden = (label: string): string | undefined => {
  let fd: number;
  try {
    fd = openSync("/dev/tty", "r+");
  } catch {
    return undefined;
  }
  const stty = (arg: string) => spawnSync("stty", [arg], { stdio: [fd, "ignore", "ignore"] });
  try {
    writeFileSync(fd, label);
    stty("-echo");
    const bytes: number[] = [];
    const one = Buffer.alloc(1);
    while (readSync(fd, one, 0, 1, null) === 1 && one[0] !== 0x0a) {
      if (one[0] !== 0x0d) bytes.push(one[0]!);
    }
    return Buffer.from(bytes).toString("utf8");
  } finally {
    stty("echo");
    writeFileSync(fd, "\n");
    closeSync(fd);
  }
};

const passphrase = (confirm: boolean): string =>
  resolvePassphrase(process.env, () => {
    const first = promptHidden("Backup passphrase: ");
    if (first !== undefined && confirm && promptHidden("Again: ") !== first) {
      throw new Error("The passphrases don't match. Nothing was written.");
    }
    return first;
  });

const main = async (): Promise<number> => {
  if (args.some((a) => a.startsWith("--passphrase") || a.startsWith("--password"))) {
    console.error(
      "The passphrase is never an argument (it would show in ps and shell history). Set FISCODE_BACKUP_PASSPHRASE or answer the prompt.",
    );
    return 2;
  }
  const [command, target] = args;
  switch (command) {
    case "verify": {
      const { manifest: m, missing } = await verifyBackup(
        need(target, "the backup file"),
        passphrase(false),
      );
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
        passphrase(false),
      );
      console.log(`restored ${m.counts.rows} rows and ${m.counts.blobs} files into ${to}`);
      const note = describeMissing(missing);
      if (note) console.log(note);
      return 0;
    }
    case "backup": {
      const out = need(flag("--out"), "--out <backup.zip.age>");
      const from = need(flag("--from"), "--from <dir>");
      const { bytes, manifest } = await backupDir(from, {
        createdAt: flag("--created-at") ?? new Date().toISOString(),
        passphrase: passphrase(true),
      });
      writeFileSync(out, bytes);
      console.log(`wrote ${out}: ${manifest.counts.rows} rows, ${manifest.counts.blobs} files`);
      return 0;
    }
    case "check-roundtrip": {
      const { identical } = await checkRoundtrip(
        need(target, "the backup file"),
        passphrase(false),
      );
      console.log(
        identical
          ? "identical (decrypted contents)"
          : "DIFFERENT: the restored profile backs up to other contents",
      );
      return identical ? 0 : 1;
    }
    case "summary": {
      console.log(
        JSON.stringify(
          await summarizeBackup(need(target, "the backup file"), passphrase(false)),
          null,
          2,
        ),
      );
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
