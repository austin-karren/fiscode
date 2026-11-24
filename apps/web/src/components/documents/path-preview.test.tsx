import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderFixedError, OperationCancelledError } from "@fiscode/core";
import type { RunHooks } from "@fiscode/db";

import { previewLine, tooLongLine } from "../../lib/path-preview";
import { MoveDialog } from "./move-dialog";
import { NameDialog } from "./name-dialog";
import { pastCommit, treeProgressLine } from "./tree-run";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const base = {
  open: true,
  onOpenChange: () => {},
  title: "Rename folder",
  label: "Folder name",
  submitLabel: "Rename",
};
const P = "documents/2026/";

/** Types into the name field and lets the debounced preview answer. */
const type = async (value: string) => {
  fireEvent.change(screen.getByLabelText("Folder name"), { target: { value } });
  await act(async () => vi.advanceTimersByTimeAsync(200));
};

describe("path preview as you type (vault PR 8b)", () => {
  it("shows the path the save writes, linked to the field", async () => {
    vi.useFakeTimers();
    const preview = vi.fn(async (name: string) => ({ path: `${P}${name}`, fits: true, overBy: 0 }));
    render(<NameDialog {...base} preview={preview} onSubmit={async () => {}} />);
    await type("Demo receipts");
    expect(preview).toHaveBeenLastCalledWith("Demo receipts", null);
    expect(screen.getByLabelText("Folder name")).toHaveAccessibleDescription(
      `Saves as ${P}Demo receipts`,
    );
  });

  it("says how much too long, and blocks the save", async () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn(async () => {});
    render(
      <NameDialog
        {...base}
        preview={async () => ({ path: `${P}x`, fits: false, overBy: 12 })}
        onSubmit={onSubmit}
      />,
    );
    await type("A very long demo name");
    expect(screen.getByText(/^Too long by 12 characters/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await act(async () => {});
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Too long by 12 characters");
  });

  it("never shows an older name's answer for the current name", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const preview = vi.fn((name: string) =>
      name === "Old"
        ? new Promise<{ path: string; fits: boolean; overBy: number }>((r) => {
            release = () => r({ path: `${P}Old`, fits: true, overBy: 0 });
          })
        : Promise.resolve({ path: `${P}${name}`, fits: true, overBy: 0 }),
    );
    render(<NameDialog {...base} preview={preview} onSubmit={async () => {}} />);
    await type("Old");
    await type("New");
    await act(async () => release());
    expect(screen.queryByText(`Saves as ${P}Old`)).toBeNull();
    expect(screen.getByText(`Saves as ${P}New`)).toBeVisible();
  });
});

describe("folder rename and move: progress, Cancel, typed errors (vault PR 8b)", () => {
  /** A save that reports `steps`, then waits for its signal or `go`. */
  const gated = (steps: Parameters<NonNullable<RunHooks["onProgress"]>>[0][]) => {
    let go!: () => void;
    const onSubmit = vi.fn(
      (_n: string, _w: string | null, hooks: RunHooks) =>
        new Promise<void>((resolve, reject) => {
          for (const s of steps) hooks.onProgress?.(s);
          hooks.signal?.addEventListener("abort", () => reject(new OperationCancelledError()));
          go = resolve;
        }),
    );
    return { onSubmit, go: () => go() };
  };

  it("shows done of total, and Cancel says nothing was changed", async () => {
    const { onSubmit } = gated([{ phase: "moving", done: 3, total: 40 }]);
    render(<NameDialog {...base} initial="Demo" progress onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByText("Moving files (3 of 40)…")).toBeVisible();
    const cancels = screen.getAllByRole("button", { name: /^Cancel/ });
    expect(cancels[0]).toBeEnabled();
    fireEvent.click(cancels[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      new OperationCancelledError().message,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Nothing was changed/);
    expect(screen.queryByText(/Moving files/)).toBeNull();
  });

  it("turns Cancel off once saving starts, and the change finishes", async () => {
    const run = gated([
      { phase: "moving", done: 40, total: 40 },
      { phase: "saving", done: 40, total: 40 },
    ]);
    const closed = vi.fn();
    render(
      <NameDialog
        {...base}
        onOpenChange={closed}
        initial="Demo"
        progress
        onSubmit={run.onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByText("Saving…")).toBeVisible();
    expect(screen.getByRole("button", { name: /saving, it finishes now/ })).toBeDisabled();
    await act(async () => run.go());
    expect(closed).toHaveBeenCalledWith(false);
  });

  it("shows FolderFixedError's own message on a move", async () => {
    render(
      <MoveDialog
        open
        onOpenChange={() => {}}
        title="Move 2026"
        tree={[]}
        exclude={new Set()}
        topLabel="Top level"
        current={null}
        progress
        onMove={async () => {
          throw new FolderFixedError("year");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      new FolderFixedError("year").message,
    );
  });

  it("passes the move a signal that Cancel aborts", async () => {
    let signal: AbortSignal | undefined;
    render(
      <MoveDialog
        open
        onOpenChange={() => {}}
        title="Move Demo"
        tree={[]}
        exclude={new Set()}
        topLabel="Top level"
        current={null}
        progress
        onMove={(_to, hooks) =>
          new Promise((_, reject) => {
            signal = hooks.signal;
            hooks.onProgress?.({ phase: "moving", done: 1, total: 5 });
            signal?.addEventListener("abort", () => reject(new OperationCancelledError()));
          })
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(await screen.findByText("Moving files (1 of 5)…")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: /^Cancel/ })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Nothing was changed/);
    expect(signal?.aborted).toBe(true);
  });
});

describe("words", () => {
  it("names each phase", () => {
    expect(treeProgressLine({ phase: "moving", done: 3, total: 40 })).toBe(
      "Moving files (3 of 40)",
    );
    expect(treeProgressLine({ phase: "repathing", done: 1, total: 2 })).toBe(
      "Updating file names (1 of 2)",
    );
    expect(treeProgressLine({ phase: "saving", done: 40, total: 40 })).toBe("Saving");
    expect(pastCommit({ phase: "saving", done: 0, total: 0 })).toBe(true);
    expect(pastCommit({ phase: "moving", done: 0, total: 1 })).toBe(false);
  });

  it("says how much too long", () => {
    expect(tooLongLine({ overBy: 1 })).toMatch(/^Too long by 1 character\./);
    expect(tooLongLine({ overBy: 0 })).toMatch(/^Too long to fit, even shortened/);
    expect(previewLine({ path: "documents/a", fits: true, overBy: 0 })).toBe(
      "Saves as documents/a",
    );
  });
});
