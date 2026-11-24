import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: { phase: "done" } as object }));
const invalidate = vi.fn(async () => {});
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
  Link: ({
    children,
    to: _t,
    search: _s,
    hash: _h,
    ...rest
  }: Record<string, unknown> & {
    children: React.ReactNode;
  }) => (
    <a href="#" {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@fiscode/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@fiscode/db")>();
  return {
    scanReviewCount: real.scanReviewCount,
    getVaultMigrationState: () => state.current,
    onVaultMigrationState: () => () => {},
    scanVault: vi.fn(),
    adoptMoved: vi.fn(async () => ({ folders: [], shortened: [], unfiled: [] })),
    putBack: vi.fn(async () => {}),
    moveBack: vi.fn(async () => {}),
    acknowledgeChanged: vi.fn(async () => {}),
    importNewFiles: vi.fn(async () => []),
    applyRecordDates: vi.fn(async () => {}),
    getVaultStore: vi.fn(),
  };
});

import {
  acknowledgeChanged,
  adoptMoved,
  applyRecordDates,
  importNewFiles,
  moveBack,
  putBack,
  scanVault,
  type ScanReport,
  type VaultMigrationReport,
} from "@fiscode/db";
import { VaultBusyError, VaultNameTakenError } from "@fiscode/core";
import { CheckPage } from "./check-page";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.current = { phase: "done" };
});

const D = "documents/2026";
const empty: ScanReport = {
  status: "done",
  trigger: "check",
  scannedAt: "2026-11-23T10:00:00.000Z",
  ok: 4,
  moved: [],
  ambiguous: [],
  missing: [],
  changed: [],
  tooLarge: [],
  unknown: [],
  conflicts: [],
  redated: [],
  tmpRemoved: [],
} as ScanReport;

const moved = (id: string, swapped?: true) => ({
  documentId: id,
  name: `Demo ${id}`,
  path: `${D}/Expenses/2026-11-23 Demo ${id}.pdf`,
  foundAt: `${D}/Other/2026-11-23 Demo ${id}.pdf`,
  sha256: `sha-${id}`,
  adoptFolderId: null,
  ...(swapped ? { swapped } : {}),
});

const full: ScanReport = {
  ...empty,
  moved: [moved("a"), moved("b", true)],
  changed: [
    {
      documentId: "c",
      name: "Demo edited",
      path: `${D}/Other/2026-11-23 Demo edited.txt`,
      fromSha256: "x",
      toSha256: "y",
      oldBytesKept: true,
    },
  ] as ScanReport["changed"],
  unknown: [
    {
      path: `${D}/Other/demo-new.pdf`,
      name: "demo-new.pdf",
      mime: "application/pdf",
      sizeBytes: 2048,
      folderId: null,
    },
  ] as ScanReport["unknown"],
  redated: [
    {
      documentId: "r",
      name: "Demo redated",
      path: `${D}/Expenses/2026-11-01 Demo redated.pdf`,
      fileDate: "2026-11-01",
      expectedDate: "2026-11-20",
    },
  ],
  missing: [
    { documentId: "m", name: "Demo missing", path: `${D}/Other/2026-11-23 Demo missing.pdf` },
  ],
  conflicts: [
    {
      path: `${D}/Other/2026-11-23 Demo (conflicted copy).pdf`,
      originalPath: `${D}/Other/2026-11-23 Demo.pdf`,
      documentId: "o",
      kind: "nextcloud",
    },
  ],
  ambiguous: [
    {
      documentId: "z",
      name: "Demo twin",
      path: `${D}/Other/2026-11-23 Demo twin.pdf`,
      sha256: "t",
      foundAt: [`${D}/Expenses/twin-1.pdf`, `${D}/Income/twin-2.pdf`],
    },
  ] as ScanReport["ambiguous"],
  tooLarge: [
    { documentId: "l", name: "Demo big", path: `${D}/Other/big.pdf`, sizeBytes: 30_000_000 },
  ] as ScanReport["tooLarge"],
};

const section = (name: RegExp) => screen.getByRole("region", { name });
/** Actions are one at a time: wait until the last one has finished. */
const settled = () =>
  vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Check now" })).not.toHaveAttribute("aria-disabled"),
  );

describe("Check folder (vault PR 11)", () => {
  it("says Everything matches when the report is empty", () => {
    render(<CheckPage report={empty} migration={undefined} />);
    expect(screen.getByText("Everything matches")).toBeVisible();
    expect(screen.getByText(/4 files in your folder match/)).toBeVisible();
  });

  it("says it hasn't checked yet without a report", () => {
    render(<CheckPage report={undefined} migration={undefined} />);
    expect(screen.getByText(/Not checked yet/)).toBeVisible();
  });

  it("has one section per kind, with its count", () => {
    render(<CheckPage report={full} migration={undefined} />);
    for (const [name, n] of [
      ["Moved", 2],
      ["Edited outside fiscode", 1],
      ["New in folder", 1],
      ["Date no longer matches", 1],
      ["Not on this device", 1],
      ["Sync conflicts", 1],
      ["Found in more than one place", 1],
      ["Too large", 1],
    ] as const)
      expect(screen.getByRole("region", { name: `${name}: ${n}` })).toBeVisible();
    expect(screen.queryByText("Everything matches")).toBeNull();
  });

  it("adopts one, adopts all, and moves back", async () => {
    render(<CheckPage report={full} migration={undefined} />);
    const s = section(/^Moved/);
    expect(within(s).getByText(/swapped places with each other/)).toBeVisible();
    fireEvent.click(within(s).getByRole("button", { name: "Adopt Demo a" }));
    await vi.waitFor(() => expect(adoptMoved).toHaveBeenCalledWith([full.moved[0]]));
    await settled();
    expect(invalidate).toHaveBeenCalled();
    fireEvent.click(within(s).getByRole("button", { name: "Adopt all" }));
    await vi.waitFor(() => expect(adoptMoved).toHaveBeenCalledWith(full.moved));
    await settled();
    fireEvent.click(within(s).getByRole("button", { name: "Move back Demo a" }));
    await vi.waitFor(() => expect(moveBack).toHaveBeenCalledWith([full.moved[0]]));
  });

  it("shows an action's typed error in its own section", async () => {
    vi.mocked(moveBack).mockRejectedValueOnce(new VaultNameTakenError(full.moved[0]!.path));
    render(<CheckPage report={full} migration={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Move back Demo a" }));
    const alert = await within(section(/^Moved/)).findByRole("alert");
    expect(alert).toHaveTextContent(new VaultNameTakenError(full.moved[0]!.path).message);
  });

  it("acknowledges an edit, imports a new file, applies a record date", async () => {
    render(<CheckPage report={full} migration={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge Demo edited" }));
    await vi.waitFor(() => expect(acknowledgeChanged).toHaveBeenCalledWith(full.changed));
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Import demo-new.pdf" }));
    await vi.waitFor(() => expect(importNewFiles).toHaveBeenCalledWith(full.unknown));
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Apply record date Demo redated" }));
    await vi.waitFor(() => expect(applyRecordDates).toHaveBeenCalledWith(full.redated));
    expect(screen.getByText("File date 2026-11-01, record date 2026-11-20.")).toBeVisible();
  });

  it("offers no pick for conflicts or ambiguous files: every path, Open, and how to resolve", () => {
    render(<CheckPage report={full} migration={undefined} />);
    const c = section(/^Sync conflicts/);
    expect(within(c).getByText(/delete the other in your folder/)).toBeVisible();
    expect(
      within(c)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "Open original 2026-11-23 Demo.pdf",
      "Open copy 2026-11-23 Demo (conflicted copy).pdf",
    ]);
    const a = section(/^Found in more than one place/);
    expect(within(a).getByText(/delete the others in your folder/)).toBeVisible();
    expect(within(a).getAllByRole("button", { name: /^Open/ })).toHaveLength(2);
  });

  it("reuses 'File not on this device', and gives too-large its reason", () => {
    render(<CheckPage report={full} migration={undefined} />);
    expect(
      within(section(/^Not on this device/)).getByText(/File not on this device/),
    ).toBeVisible();
    expect(within(section(/^Too large/)).getByText(/over 25 MB/)).toBeVisible();
  });

  it("Check now shows progress, then re-reads the report", async () => {
    let finish!: (r: ScanReport) => void;
    vi.mocked(scanVault).mockImplementation(
      (o) =>
        new Promise((r) => {
          o?.onProgress?.({ phase: "scanning", done: 3, total: 12 });
          finish = r;
        }),
    );
    render(<CheckPage report={empty} migration={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Checking files (3 of 12)…")).toBeVisible();
    finish(empty);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(vi.mocked(scanVault).mock.calls[0]![0]).toMatchObject({ trigger: "check" });
  });

  it("shows Busy in another tab and other typed errors as a line", async () => {
    vi.mocked(scanVault).mockRejectedValueOnce(new VaultBusyError());
    render(<CheckPage report={empty} migration={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Busy in another tab/);
  });

  it("is read-only while the migration runs", () => {
    state.current = { phase: "migrating", done: 1, total: 4 };
    render(<CheckPage report={full} migration={undefined} />);
    expect(screen.getByRole("button", { name: "Check now" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Adopt all" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Import demo-new.pdf" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("adopts a swap only as a whole: no per-item Adopt or Move back (REVIEW #112 r1 F1)", async () => {
    const swap = { ...empty, moved: [moved("a"), moved("b", true), moved("c", true)] };
    render(<CheckPage report={swap} migration={undefined} />);
    expect(screen.queryByRole("button", { name: "Adopt Demo b" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move back Demo c" })).toBeNull();
    expect(screen.getByRole("button", { name: "Adopt Demo a" })).not.toHaveAttribute(
      "aria-disabled",
    );
    fireEvent.click(screen.getByRole("button", { name: "Adopt the swap" }));
    await vi.waitFor(() => expect(adoptMoved).toHaveBeenCalledWith([swap.moved[1], swap.moved[2]]));
  });

  it("keeps one error line: the next thing tried clears it (REVIEW #112 r1 F3)", async () => {
    vi.mocked(scanVault).mockRejectedValueOnce(new VaultBusyError());
    render(<CheckPage report={full} migration={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Busy in another tab/);
    fireEvent.click(screen.getByRole("button", { name: "Import demo-new.pdf" }));
    await settled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#114: says which folders Adopt makes, or why it uses Unfiled, and what it did", async () => {
    const makes = { ...moved("x"), adoptNewFolders: ["Demo box", "March"] };
    const year = { ...moved("y"), adoptFallback: "year" as const };
    vi.mocked(adoptMoved).mockResolvedValueOnce({
      folders: [{ name: "Demo box" }, { name: "March" }] as never,
      shortened: [],
      unfiled: [{ documentId: "y", foundAt: year.foundAt, reason: "year" }],
    });
    render(<CheckPage report={{ ...empty, moved: [makes, year] }} migration={undefined} />);
    expect(screen.getByText(/makes any folder you made there/)).toBeVisible();
    expect(screen.getByText("Adopt creates the folders Demo box / March.")).toBeVisible();
    expect(
      screen.getByText(
        "Adopt puts it in Unfiled: a new top-level folder can't be named like a year.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Adopt all" }));
    const status = screen.getAllByRole("status").find((n) => n.querySelector("ul") === null)!;
    expect(status).toBeEmptyDOMElement();
    expect(await screen.findByText("Created 2 folders: Demo box, March.")).toBeVisible();
    // The live region was there before its text, and the lines stay a list (REVIEW #118 r1).
    expect(status.querySelector("ul")).not.toBeNull();
    expect(within(status).getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByText(
        "Demo y went to Unfiled: a new top-level folder can't be named like a year.",
      ),
    ).toBeVisible();
  });

  it("#114: an edit stays until acknowledged, with Acknowledge all", async () => {
    const two = {
      ...full,
      changed: [...full.changed, { ...full.changed[0]!, documentId: "c2", name: "Demo edited 2" }],
    };
    render(<CheckPage report={two} migration={undefined} />);
    expect(screen.getByText(/Each stays here until you acknowledge it/)).toBeVisible();
    expect(screen.queryByText(/until the next check/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge all" }));
    await vi.waitFor(() => expect(acknowledgeChanged).toHaveBeenCalledWith("all"));
  });

  it("#114: a restorable file gets Put it back, apart from Not on this device", async () => {
    const restorable = {
      documentId: "p",
      name: "Demo back",
      path: `${D}/Other/2026-11-23 Demo back.pdf`,
      restorable: true as const,
    };
    render(
      <CheckPage
        report={{ ...full, missing: [...full.missing, restorable] }}
        migration={undefined}
      />,
    );
    const s = section(/^Restorable from this device: 1/);
    fireEvent.click(within(s).getByRole("button", { name: "Put it back Demo back" }));
    await vi.waitFor(() => expect(putBack).toHaveBeenCalledWith([restorable]));
    expect(section(/^Not on this device: 1/)).toBeVisible();
    expect(within(section(/^Not on this device/)).queryByText("Demo back")).toBeNull();
  });

  it("hides the migration report when the migration had nothing to do (REVIEW #112 r1 F2)", () => {
    const nothing: VaultMigrationReport = {
      finishedAt: "2026-11-22T09:00:00.000Z",
      documents: 0,
      placed: 0,
      oldBytesKept: 0,
      foldersShortened: [],
      titlesShortened: [],
      overBudget: [],
      missing: [],
    };
    render(<CheckPage report={empty} migration={nothing} />);
    expect(screen.queryByText("Moving into the vault")).toBeNull();
  });

  it("shows the migration report", () => {
    const migration: VaultMigrationReport = {
      finishedAt: "2026-11-22T09:00:00.000Z",
      documents: 5,
      placed: 5,
      oldBytesKept: 2,
      foldersShortened: [{ folderId: "f", from: "A very long demo folder", to: "A very long" }],
      titlesShortened: [
        { documentId: "t", name: "Demo long title", path: `${D}/Other/Demo lo.pdf` },
      ],
      overBudget: [],
      missing: [{ documentId: "m", sha256: "s", reason: "missing" }],
    };
    render(<CheckPage report={empty} migration={migration} />);
    expect(screen.getByText(/5 files placed, 2 earlier versions kept/)).toBeVisible();
    expect(screen.getByText("1 folder name shortened to fit")).toBeVisible();
    expect(screen.getByText("A very long demo folder → A very long")).toBeVisible();
    expect(screen.getByText("1 file name shortened to fit")).toBeVisible();
    expect(screen.getByText(/1 file not on this device, 0 files damaged/)).toBeVisible();
  });
});

describe("focus when an item leaves the list (d-ux)", () => {
  // The real loader re-reads the report after an action: here invalidate re-renders with `next`.
  const leaves = (first: ScanReport, next: ScanReport) => {
    const view = render(
      <main>
        <h1>Check folder</h1>
        <CheckPage report={first} migration={undefined} />
      </main>,
    );
    // As in the app: invalidate resolves first, and the new report commits later (REVIEW #119 r1).
    invalidate.mockImplementationOnce(async () => {
      setTimeout(
        () =>
          view.rerender(
            <main>
              <h1>Check folder</h1>
              <CheckPage report={next} migration={undefined} />
            </main>,
          ),
        50,
      );
    });
    return view;
  };
  /** Lets the later re-render land, as the router's commit does after invalidate resolves. */
  const frame = () => act(() => new Promise<void>((r) => setTimeout(r, 100)));
  const r1 = { documentId: "p1", name: "Demo p1", path: `${D}/p1.pdf`, restorable: true as const };
  const r2 = { ...r1, documentId: "p2", name: "Demo p2", path: `${D}/p2.pdf` };
  const r3 = { ...r1, documentId: "p3", name: "Demo p3", path: `${D}/p3.pdf` };
  const withMissing = (...m: (typeof r1)[]) => ({ ...empty, missing: m });

  it("goes to the next item", async () => {
    leaves(withMissing(r1, r2, r3), withMissing(r2, r3));
    fireEvent.click(screen.getByRole("button", { name: "Put it back Demo p1" }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await frame();
    expect(
      within(screen.getByText("Demo p2", { selector: "p" }).closest("li")!).getAllByRole("link")[0],
    ).toHaveFocus();
  });

  it("goes to the previous item after the last one", async () => {
    leaves(withMissing(r1, r2), withMissing(r1));
    fireEvent.click(screen.getByRole("button", { name: "Put it back Demo p2" }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await frame();
    expect(
      within(screen.getByText("Demo p1", { selector: "p" }).closest("li")!).getAllByRole("link")[0],
    ).toHaveFocus();
  });

  it("goes to the previous item in Edited after acknowledging the last", async () => {
    const two = {
      ...full,
      changed: [full.changed[0]!, { ...full.changed[0]!, documentId: "c2", name: "Demo c2" }],
    };
    leaves(two, { ...two, changed: [two.changed[0]!] });
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge Demo c2" }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await frame();
    expect(
      within(screen.getByText("Demo edited", { selector: "p" }).closest("li")!).getAllByRole(
        "link",
      )[0],
    ).toHaveFocus();
  });

  it("goes to the page heading when the whole section went, never body", async () => {
    leaves({ ...empty, moved: [moved("a")] }, empty);
    fireEvent.click(screen.getByRole("button", { name: "Move back Demo a" }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await frame();
    expect(screen.getByRole("heading", { level: 1, name: "Check folder" })).toHaveFocus();
  });

  it("goes to the section heading after an 'all' action when the section stays", async () => {
    const restorableAndMissing = withMissing(r1, r2);
    // Put all back fails for one: the section stays with it.
    leaves(restorableAndMissing, withMissing(r2));
    fireEvent.click(screen.getByRole("button", { name: "Put all back" }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await frame();
    const heading = screen.getByText(/^Restorable from this device/).closest("h2")!;
    expect(heading).toHaveFocus();
    // Focus shows there, as on the page heading (REVIEW #119 r2).
    expect(heading.className).not.toMatch(/outline-none/);
  });

  it("stays on the pressed button when the action fails", async () => {
    vi.mocked(moveBack).mockRejectedValueOnce(new VaultNameTakenError("x"));
    render(<CheckPage report={{ ...empty, moved: [moved("a")] }} migration={undefined} />);
    const button = screen.getByRole("button", { name: "Move back Demo a" });
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    await screen.findByRole("alert");
    await frame();
    expect(button).toHaveFocus();
  });
});

describe("a second press while an action runs", () => {
  it("is ignored, even before the re-render", async () => {
    let finish!: () => void;
    vi.mocked(moveBack).mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    render(<CheckPage report={{ ...empty, moved: [moved("a")] }} migration={undefined} />);
    const button = screen.getByRole("button", { name: "Move back Demo a" });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => finish());
    expect(moveBack).toHaveBeenCalledTimes(1);
  });
});
