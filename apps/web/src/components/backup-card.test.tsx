import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.fn(async () => {});
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@fiscode/db", () => ({
  // The vault migration is done: every write is on (vault PR 9).
  getVaultMigrationState: (
    (done) => () =>
      done
  )({ phase: "done" }),
  onVaultMigrationState: () => () => {},
  buildBundle: vi.fn(async () => ({})),
}));
vi.mock("@fiscode/backup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fiscode/backup")>()),
  createBackup: vi.fn(),
  readBackup: vi.fn(),
  planBackupRestore: vi.fn(),
  restoreBackup: vi.fn(async () => {}),
}));

import { createBackup, planBackupRestore, readBackup, restoreBackup } from "@fiscode/backup";
import { BackupFileCorruptError, BackupPassphraseError } from "@fiscode/core";
import { toast } from "sonner";

import { BackupCard } from "./backup-card";
import { passphraseStrength } from "../lib/backup-view";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const PASS = "demo walk passphrase";
const ageFile = () =>
  new File(["age-encryption.org/v1\n-> scrypt demo\n"], "fiscode-backup-2026-11-20.zip.age");

const ready = {
  ok: true,
  manifest: { createdAt: "2026-11-20T10:00:00.000Z" },
  bundle: { profile: { id: "p" } },
  documents: { files: 2, bytes: 2048 },
  missing: [{ sha256: "x", documentIds: ["d1"], names: ["demo-receipt.pdf"] }],
} as never;

const plan = {
  mode: "restore",
  current: { live: 3, deleted: 0, history: 1 },
  written: { live: 5, deleted: 0, history: 2 },
  removed: { live: 1, deleted: 0 },
  snapshot: true,
  refusal: undefined,
  documents: { files: 2, bytes: 2048 },
} as never;

describe("Back up everything", () => {
  const open = () => {
    render(<BackupCard />);
    fireEvent.click(screen.getByRole("button", { name: "Back up everything" }));
    return screen.findByRole("dialog");
  };

  it("says a lost passphrase loses the backup, and rates its strength", async () => {
    const dialog = await open();
    expect(within(dialog).getByText(/Nobody can recover a forgotten passphrase/)).toBeVisible();
    const field = within(dialog).getByLabelText("Passphrase");
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining("A lost passphrase loses the backup."),
    );
    expect(field).toHaveAccessibleDescription(expect.stringContaining("Strength: Too short"));
    fireEvent.change(field, { target: { value: PASS } });
    expect(field).toHaveAccessibleDescription(expect.stringContaining("Strength: Strong"));
  });

  it("refuses a short passphrase and a mismatch, and says why on each field", async () => {
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText("Passphrase"), { target: { value: "short" } });
    fireEvent.change(within(dialog).getByLabelText("Passphrase again"), {
      target: { value: "other" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Back up" }));
    expect(await within(dialog).findByText("Use at least 12 characters (5 so far).")).toBeVisible();
    expect(within(dialog).getByText("The two passphrases don't match.")).toBeVisible();
    expect(createBackup).not.toHaveBeenCalled();
  });

  it("backs up with the passphrase, downloads the file, and forgets the passphrase", async () => {
    const url = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    vi.mocked(createBackup).mockImplementation(async ({ onProgress }) => {
      onProgress?.({ phase: "zipping", done: 1, total: 3 });
      return {
        blob: new Blob(["x"]),
        fileName: "fiscode-backup-2026-11-20.zip.age",
        manifest: { missing: [{ sha256: "x", documentIds: ["d1", "d2"] }] } as never,
      };
    });
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText("Passphrase"), { target: { value: PASS } });
    fireEvent.change(within(dialog).getByLabelText("Passphrase again"), {
      target: { value: PASS },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Back up" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Backed up to fiscode-backup-2026-11-20.zip.age.",
        {
          // REVIEW #88 r1 nit: documents without a file here are named at backup time.
          description: "2 documents have no file on this device and are backed up without it.",
        },
      ),
    );
    expect(vi.mocked(createBackup).mock.calls[0]![0].passphrase).toBe(PASS);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Back up everything" }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("Passphrase")).toHaveValue("");
    url.mockRestore();
  });
});

describe("Restore from backup", () => {
  const openAndPick = async (variant: "dashboard" | "setup" = "dashboard") => {
    render(<BackupCard variant={variant} />);
    fireEvent.click(screen.getByRole("button", { name: "Restore from backup" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [ageFile()] },
    });
    return dialog;
  };

  it("asks again after a wrong passphrase, then shows the plan and restores", async () => {
    vi.mocked(readBackup)
      .mockRejectedValueOnce(new BackupPassphraseError("wrong"))
      .mockResolvedValueOnce(ready);
    vi.mocked(planBackupRestore).mockReturnValue(plan);
    const dialog = await openAndPick();
    const field = await within(dialog).findByLabelText("Passphrase");
    fireEvent.change(field, { target: { value: "not the one" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open backup" }));
    expect(
      await within(dialog).findByText(
        "That passphrase doesn't open this backup. Check it and try again. Nothing was changed.",
      ),
    ).toBeVisible();
    // REVIEW #88 r1 F1: focus returns to the field, its text selected to retype.
    const again = within(dialog).getByLabelText<HTMLInputElement>("Passphrase");
    await waitFor(() => expect(again).toHaveFocus());
    expect([again.selectionStart, again.selectionEnd]).toEqual([0, "not the one".length]);
    fireEvent.change(again, { target: { value: PASS } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open backup" }));
    expect(
      await within(dialog).findByText("2 document files (2 KB) will be written to this device."),
    ).toBeVisible();
    expect(within(dialog).getByText("You can undo this restore from History.")).toBeVisible();
    expect(within(dialog).getByText(/the state before this restore\.$/)).toBeVisible();
    // Focus moves in an effect, after the confirm step renders.
    const restore = within(dialog).getByRole("button", { name: "Restore" });
    await waitFor(() => expect(restore).toHaveFocus());
    expect(within(dialog).getByText("demo-receipt.pdf")).toBeVisible();
    expect(vi.mocked(readBackup).mock.calls[1]![1]?.passphrase).toBe(PASS);
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreBackup).toHaveBeenCalled());
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(
      "Restored fiscode-backup-2026-11-20.zip.age, with 2 files.",
    );
  });

  it("sends a damaged file back to choosing a file, not to the passphrase", async () => {
    vi.mocked(readBackup).mockRejectedValueOnce(new BackupFileCorruptError());
    const dialog = await openAndPick();
    fireEvent.change(await within(dialog).findByLabelText("Passphrase"), {
      target: { value: PASS },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open backup" }));
    const line = await within(dialog).findByText(/Try another copy of the backup\.$/);
    // REVIEW #88 r1 F1: focus goes to the alert, not the page body.
    await waitFor(() => expect(line.closest("[tabindex]")).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "Choose backup file" })).toBeVisible();
    expect(within(dialog).queryByLabelText("Passphrase")).not.toBeInTheDocument();
  });

  it("shows a refused file's headline and reasons", async () => {
    vi.mocked(readBackup).mockResolvedValueOnce({
      ok: false,
      headline: "This file isn't a fiscode CSV.",
      detail: undefined,
      errors: [],
    } as never);
    const dialog = await openAndPick();
    fireEvent.change(await within(dialog).findByLabelText("Passphrase"), {
      target: { value: PASS },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open backup" }));
    expect(await within(dialog).findByText("This file isn't a fiscode CSV.")).toBeVisible();
  });

  it("on the setup screen, restores into the empty profile without a confirm step", async () => {
    vi.mocked(readBackup).mockResolvedValueOnce(ready);
    const dialog = await openAndPick("setup");
    fireEvent.change(await within(dialog).findByLabelText("Passphrase"), {
      target: { value: PASS },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open backup" }));
    await waitFor(() => expect(restoreBackup).toHaveBeenCalled());
    expect(planBackupRestore).not.toHaveBeenCalled();
  });
});

describe("backup passphrase nits (REVIEW #88 r1)", () => {
  it("asks for the second entry when it's empty, and drops 'too short' once long enough", async () => {
    render(<BackupCard />);
    fireEvent.click(screen.getByRole("button", { name: "Back up everything" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Passphrase");
    fireEvent.change(field, { target: { value: "short1" } });
    fireEvent.blur(field);
    expect(within(dialog).getByText("Use at least 12 characters (6 so far).")).toBeVisible();
    fireEvent.change(field, { target: { value: PASS } });
    expect(within(dialog).queryByText(/so far/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Back up" }));
    expect(await within(dialog).findByText("Enter the passphrase again.")).toBeVisible();
  });
});

describe("arriving by a #backup link (REVIEW #88 r1 F1)", () => {
  it("puts focus on Restore from backup", () => {
    window.location.hash = "#backup";
    render(<BackupCard />);
    expect(screen.getByRole("button", { name: "Restore from backup" })).toHaveFocus();
    window.location.hash = "";
  });
});

describe("passphrase strength", () => {
  it.each([
    ["eleven char", "Too short"],
    ["twelve chars", "Weak"],
    ["Twelve chars1", "Fair"],
    ["four plain demo words", "Strong"],
  ])("%j is %s", (value, label) => {
    expect(passphraseStrength(value, 12).label).toBe(label);
  });
});
