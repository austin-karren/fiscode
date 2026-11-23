import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The migration is running: Documents, import, backup and restore are read-only (ADR 0001 § 10).
const state = vi.hoisted(() => ({ current: { phase: "migrating", done: 2, total: 5 } as object }));
vi.mock("@fiscode/db", () => ({
  getVaultMigrationState: () => state.current,
  onVaultMigrationState: () => () => {},
  buildBundle: vi.fn(async () => ({})),
  importBundle: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: async () => {} }) }));

import { BackupCard } from "./backup-card";
import { ImportCard } from "./import-card";
import { FolderActions } from "./documents/folder-actions";

afterEach(cleanup);

describe("read-only until the vault migration is done (vault PR 9)", () => {
  it("turns off backup and restore and says why", () => {
    state.current = { phase: "migrating", done: 2, total: 5 };
    render(<BackupCard />);
    expect(
      screen.getByText("Backup and restore wait until your files are moved into the vault."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back up everything" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore from backup" })).toBeDisabled();
  });

  it("turns off CSV import after a stopped migration, with its reason", () => {
    state.current = { phase: "migration-incomplete", reason: "failed", message: "Demo" };
    render(<ImportCard />);
    expect(
      screen.getByText(
        "Import waits until moving your files into the vault finishes. Resume it above.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose a CSV file/ })).toBeDisabled();
  });

  it("keeps the folder actions visible but off", () => {
    const folder = {
      id: "f",
      name: "Demo",
      parentId: null,
      taxYear: null,
      sortOrder: 0,
      defaultKey: null,
      deletedAt: null,
      createdAt: "",
      updatedAt: "",
    };
    render(
      <FolderActions
        folder={folder}
        disabled
        onRename={() => {}}
        onMove={() => {}}
        onDelete={() => {}}
      />,
    );
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("turns writes back on when done", () => {
    state.current = { phase: "done" };
    render(<BackupCard />);
    expect(screen.queryByText(/wait until/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back up everything" })).toBeEnabled();
  });
});
