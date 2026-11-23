import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: { phase: "done" } as object }));
vi.mock("@fiscode/db", () => ({
  getVaultMigrationState: () => state.current,
  onVaultMigrationState: () => () => {},
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@fiscode/backup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fiscode/backup")>()),
  exportVault: vi.fn(),
}));
vi.mock("../lib/backup-view", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/backup-view")>()),
  downloadBlob: vi.fn(),
}));

import { exportVault, type ExportVaultProgress } from "@fiscode/backup";
import { StorageQuotaError, VaultBusyError } from "@fiscode/core";
import { toast } from "sonner";
import { downloadBlob, exportProgressLine } from "../lib/backup-view";
import { VaultExportCard } from "./vault-export-card";

type Opts = { onProgress: (p: ExportVaultProgress) => void; signal: AbortSignal; target: object };
const run = vi.mocked(exportVault);
const win = window as { showDirectoryPicker?: ReturnType<typeof vi.fn> };
/** Gives the browser a folder picker that runs `impl`. */
const picker = (impl: () => Promise<unknown>) => {
  win.showDirectoryPicker = vi.fn(impl);
};

afterEach(() => {
  cleanup();
  delete win.showDirectoryPicker;
});
beforeEach(() => {
  vi.clearAllMocks();
  state.current = { phase: "done" };
});

/** An export that reports `steps` and then waits for Cancel. */
const hangs = (steps: ExportVaultProgress[]) =>
  run.mockImplementation(
    (o) =>
      new Promise((_, reject) => {
        const { onProgress, signal } = o as Opts;
        for (const s of steps) onProgress(s);
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
  );

describe("Export vault", () => {
  it("says what the export is, apart from the backup and the CSV", () => {
    render(<VaultExportCard />);
    expect(screen.getByText(/readable folder of your files plus the CSV/)).toBeVisible();
    expect(screen.getByText(/isn't encrypted/)).toBeVisible();
  });

  it("without a folder picker, downloads a zip", async () => {
    const blob = new Blob(["zip"]);
    run.mockResolvedValue({ kind: "zip", blob, fileName: "fiscode-vault-2026-11-23.zip" } as never);
    render(<VaultExportCard />);
    expect(screen.queryByRole("button", { name: /folder/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download vault as zip" }));
    await vi.waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(blob, "fiscode-vault-2026-11-23.zip"),
    );
    expect((run.mock.calls[0]![0] as Opts).target).toEqual({ kind: "zip" });
    expect(toast.success).toHaveBeenCalledWith("Exported to fiscode-vault-2026-11-23.zip.");
  });

  it("with a picker, writes into the chosen folder", async () => {
    const dir = { kind: "directory", name: "Nextcloud" };
    picker(async () => dir);
    run.mockResolvedValue({ kind: "folder", files: 4 } as never);
    render(<VaultExportCard />);
    fireEvent.click(screen.getByRole("button", { name: "Export to a folder" }));
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Exported 4 files to Nextcloud."),
    );
    expect((run.mock.calls[0]![0] as Opts).target).toEqual({ kind: "folder", dir });
    expect(screen.getByRole("button", { name: "Download as zip" })).toBeEnabled();
  });

  it("does nothing when the folder picker is dismissed", async () => {
    picker(async () => {
      throw new DOMException("dismissed", "AbortError");
    });
    render(<VaultExportCard />);
    fireEvent.click(screen.getByRole("button", { name: "Export to a folder" }));
    await vi.waitFor(() => expect(win.showDirectoryPicker).toHaveBeenCalled());
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows progress by phase, and Cancel says what was left", async () => {
    picker(async () => ({ name: "Drive" }));
    hangs([
      { phase: "reading", done: 1, total: 1 },
      { phase: "writing", done: 3, total: 12 },
    ]);
    render(<VaultExportCard />);
    fireEvent.click(screen.getByRole("button", { name: "Export to a folder" }));
    expect(await screen.findByText("Writing files (3 of 12)…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Export to a folder" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
    const note = await screen.findByText(/Export cancelled: 3 of 12 done\./);
    expect(note).toHaveTextContent("Export cancelled: 3 of 12 done.");
    expect(note).toHaveTextContent(/no fiscode\.json/);
    expect(screen.queryByRole("button", { name: "Cancel export" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export to a folder" })).toBeEnabled();
  });

  it("shows each typed error's own message", async () => {
    run.mockRejectedValueOnce(new VaultBusyError());
    render(<VaultExportCard />);
    fireEvent.click(screen.getByRole("button", { name: "Download vault as zip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Busy in another tab/);
    run.mockRejectedValueOnce(new StorageQuotaError());
    fireEvent.click(screen.getByRole("button", { name: "Download vault as zip" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(new StorageQuotaError().message),
    );
  });

  it("is off while the vault migration runs, and says why", () => {
    picker(async () => ({}));
    state.current = { phase: "migrating", done: 2, total: 5 };
    render(<VaultExportCard />);
    expect(
      screen.getByText("Export vault waits until your files are moved into the vault."),
    ).toBeVisible();
    const card = screen.getByRole("region", { name: "Export vault" });
    for (const b of within(card).getAllByRole("button")) expect(b).toBeDisabled();
  });
});

describe("exportProgressLine", () => {
  it("names the phase, with counts when it has steps", () => {
    expect(exportProgressLine({ phase: "reading", done: 0, total: 1 })).toBe("Reading your data");
    expect(exportProgressLine({ phase: "collecting", done: 2, total: 5 })).toBe(
      "Gathering files (2 of 5)",
    );
    expect(exportProgressLine({ phase: "zipping", done: 1, total: 1 })).toBe("Packing the zip");
  });
});
