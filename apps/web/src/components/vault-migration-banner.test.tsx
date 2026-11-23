import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The migration state store, without SQLite or OPFS: the same subscribe/get shape as @fiscode/db.
const store = vi.hoisted(() => {
  type S = { phase: string; [k: string]: unknown };
  let state: S = { phase: "idle" };
  const listeners = new Set<(s: S) => void>();
  return {
    get: () => state,
    on: (l: (s: S) => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    set: (s: S) => {
      state = s;
      for (const l of listeners) l(s);
    },
    resume: vi.fn(async () => {}),
  };
});
vi.mock("@fiscode/db", () => ({
  getVaultMigrationState: store.get,
  onVaultMigrationState: store.on,
  resumeVaultMigration: store.resume,
}));

import { VaultMigrationBanner } from "./vault-migration-banner";

afterEach(() => {
  cleanup();
  store.set({ phase: "idle" });
});

describe("vault migration banner (vault PR 9)", () => {
  it("shows progress while migrating, and follows the store without a remount", () => {
    store.set({ phase: "migrating", done: 1, total: 4 });
    render(<VaultMigrationBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moving your files into the vault: 1 of 4",
    );
    act(() => store.set({ phase: "migrating", done: 3, total: 4 }));
    expect(screen.getByRole("status")).toHaveTextContent("3 of 4");
    expect(screen.getByRole("progressbar", { name: "Files moved" })).toHaveAttribute("value", "3");
  });

  it("after a stop, says why and resumes", () => {
    store.set({ phase: "migration-incomplete", reason: "failed", message: "Demo disk error" });
    render(
      <main id="main-content" tabIndex={-1}>
        <VaultMigrationBanner />
      </main>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("didn't finish. Resume it to change documents.");
    expect(alert).toHaveTextContent("Demo disk error");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(store.resume).toHaveBeenCalledOnce();
    // The button goes away with the banner: focus stays on the page (REVIEW #107 r1 F3).
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("shows nothing when done", () => {
    store.set({ phase: "done" });
    const { container } = render(<VaultMigrationBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
