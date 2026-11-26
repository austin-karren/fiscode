import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({
  picker: true,
  folder: undefined as string | undefined,
  pending: undefined as { to: "folder" | "opfs"; done: number } | undefined,
  migration: { phase: "done" } as { phase: string },
}));
vi.mock("@fiscode/db", () => ({
  canPickFolder: () => vault.picker,
  pickedFolderName: () => vault.folder,
  pendingVaultSwitch: async () => vault.pending,
  onVaultChange: () => () => {},
  switchVaultToFolder: vi.fn(),
  switchVaultToOpfs: vi.fn(),
  getVaultMigrationState: () => vault.migration,
  onVaultMigrationState: () => () => {},
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { VaultSettingsCard } from "./vault-settings-card";

beforeEach(() => {
  vault.picker = true;
  vault.folder = undefined;
  vault.pending = undefined;
  vault.migration = { phase: "done" };
});
afterEach(() => cleanup());

describe("VaultSettingsCard (ADR 0001 § 11.2)", () => {
  it("says files are in this browser, and offers Pick folder when the browser can pick", async () => {
    render(<VaultSettingsCard />);
    await act(async () => {});
    expect(screen.getByText("in this browser")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick folder" })).toBeEnabled();
  });

  it("names the picked folder and offers switching back", async () => {
    vault.folder = "fiscode-walk";
    render(<VaultSettingsCard />);
    await act(async () => {});
    expect(screen.getByText("fiscode-walk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch back to this browser" })).toBeEnabled();
  });

  it("hides the picker and shows the § 11.2 line where it cannot pick", async () => {
    vault.picker = false;
    render(<VaultSettingsCard />);
    await act(async () => {});
    expect(
      screen.getByText(
        "Your files are kept in this browser. Use Export vault or Backup to get them out.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pick folder" })).toBeNull();
  });

  it("offers Resume switch for a pending switch, and holds it while migration runs", async () => {
    vault.pending = { to: "opfs", done: 3 };
    vault.migration = { phase: "migrating" };
    render(<VaultSettingsCard />);
    await act(async () => {});
    expect(
      screen.getByText("A switch didn't finish (3 files already copied)."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume switch" })).toBeDisabled();
    expect(
      screen.getByText(
        "Moving your files into the vault… You can change documents when it finishes.",
      ),
    ).toBeInTheDocument();
  });
});
