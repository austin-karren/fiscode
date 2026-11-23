import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@fiscode/db", async () => {
  // SQLite and OPFS don't exist in jsdom: the repos are the in-memory fake.
  const fake = await import("../../test/fake-documents");
  return {
    folderRepo: fake.folderRepo,
    documentRepo: fake.documentRepo,
    documentLinkRepo: fake.documentLinkRepo,
    sha256Hex: fake.sha256Hex,
  };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
// The router isn't needed here: its links render as plain anchors with their target.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    hash,
    search,
    ...rest
  }: Record<string, unknown> & { children: React.ReactNode }) => (
    <a
      href={`${to as string}${search ? `?${new URLSearchParams(search as Record<string, string>)}` : ""}${hash ? `#${hash as string}` : ""}`}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import { documentLinkRepo, documentRepo, folderRepo } from "@fiscode/db";
import { toast } from "sonner";

import { deleteRecordForStub } from "../../test/fake-documents";
import { AttachDialog } from "./attach-dialog";
import { DocumentSheet } from "./document-sheet";
import { LinkedDocuments } from "./linked-documents";

afterEach(cleanup);

const openAttach = (recordId: string, onChanged = vi.fn(), recordType = "expense" as const) => {
  render(
    <AttachDialog
      recordType={recordType}
      recordId={recordId}
      recordDate="2026-03-16"
      recordLabel="expense Mar 16, 2026, $12.00"
      count={0}
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Attach to expense Mar 16, 2026, $12.00" }));
  return screen.findByRole("dialog");
};

describe("Attach from a row", () => {
  it("names the row and its count on the button", () => {
    render(
      <AttachDialog
        recordType="income"
        recordId="in_count"
        recordDate="2026-01-05"
        recordLabel="income Jan 5, 2026, $500.00"
        count={2}
        onChanged={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Attach to income Jan 5, 2026, $500.00, 2 attached" }),
    ).toBeInTheDocument();
  });

  it("uploads into <year>/Expenses and attaches each file, one line per file", async () => {
    const onChanged = vi.fn();
    const dialog = await openAttach("ex_upload", onChanged);
    expect(await within(dialog).findByText("2026 / Expenses")).toBeInTheDocument();
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["demo receipt"], "demo-receipt.txt", { type: "text/plain" }),
          new File(["x"], "demo.exe", { type: "application/x-msdownload" }),
        ],
      },
    });
    expect(
      await within(dialog).findByText("Added demo-receipt.txt and attached it."),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    const links = await documentLinkRepo.forRecord("expense", "ex_upload");
    expect(links.map((l) => l.document.name)).toEqual(["demo-receipt.txt"]);
    const folders = await folderRepo.list();
    const expenses = folders.find((f) => f.id === links[0]!.document.folderId);
    expect(expenses?.name).toBe("Expenses");
    expect(folders.find((f) => f.id === expenses?.parentId)?.name).toBe("2026");
    expect(onChanged).toHaveBeenCalled();
  });

  it("finds an existing document by search, attaches it, and marks it attached", async () => {
    await documentRepo.upload(
      new File(["a"], "demo-invoice-alpha.pdf", { type: "application/pdf" }),
    );
    await documentRepo.upload(new File(["b"], "demo-other.png", { type: "image/png" }));
    const dialog = await openAttach("ex_choose");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Choose existing" }));
    fireEvent.change(within(dialog).getByLabelText("Search documents"), {
      target: { value: "alpha" },
    });
    const attach = await within(dialog).findByRole("button", {
      name: "Attach demo-invoice-alpha.pdf",
    });
    expect(within(dialog).queryByText("demo-other.png")).not.toBeInTheDocument();
    fireEvent.click(attach);
    expect(await within(dialog).findByText("Attached")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Attached demo-invoice-alpha.pdf.");
    // REVIEW #86 r1 F1: focus goes back to the search, not the dialog.
    expect(within(dialog).getByLabelText("Search documents")).toHaveFocus();
    expect((await documentLinkRepo.forRecord("expense", "ex_choose")).length).toBe(1);
  });

  it("says why when the row was deleted meanwhile, and attaches nothing", async () => {
    await documentRepo.upload(new File(["c"], "demo-gone.txt", { type: "text/plain" }));
    deleteRecordForStub("ex_gone");
    const dialog = await openAttach("ex_gone");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Choose existing" }));
    fireEvent.change(within(dialog).getByLabelText("Search documents"), {
      target: { value: "demo-gone" },
    });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Attach demo-gone.txt" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "That record no longer exists, so the document can't be attached to it.",
      ),
    );
    expect(await documentLinkRepo.forRecord("expense", "ex_gone")).toEqual([]);
  });
});

describe("linked documents in the Edit dialog", () => {
  it("lists them, opens each on Documents, and unlinks with Undo", async () => {
    const doc = await documentRepo.upload(
      new File(["d"], "demo-linked.pdf", { type: "application/pdf" }),
    );
    await documentLinkRepo.link(doc.id, "mileage", "mi_1");
    const onChanged = vi.fn();
    render(<LinkedDocuments recordType="mileage" recordId="mi_1" onChanged={onChanged} />);
    const link = await screen.findByRole("link", { name: "demo-linked.pdf" });
    expect(link.getAttribute("href")).toContain(`doc=${doc.id}`);
    vi.mocked(toast).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Unlink demo-linked.pdf" }));
    expect(
      await screen.findByText("None attached. Use Attach on the row to add one."),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    // REVIEW #86 r1 F1: with no document left, focus goes to the list's heading.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Documents" })).toHaveFocus());
    const [message, options] = vi.mocked(toast).mock.calls[0]!;
    expect(message).toBe("Unlinked demo-linked.pdf.");
    (options as unknown as { action: { onClick: () => void } }).action.onClick();
    expect(await screen.findByRole("link", { name: "demo-linked.pdf" })).toBeInTheDocument();
    expect(await documentRepo.get(doc.id)).toBeDefined();
  });
});

describe("the document sheet's linked rows", () => {
  it("link to their row on its screen", async () => {
    const doc = await documentRepo.upload(
      new File(["e"], "demo-sheet.txt", { type: "text/plain" }),
    );
    await documentLinkRepo.link(doc.id, "income", "in_9");
    render(
      <DocumentSheet doc={doc} folderPath="Unfiled" onClose={() => {}} onChanged={() => {}} />,
    );
    const row = await screen.findByRole("link", { name: "Income · income in_9" });
    expect(row).toHaveAttribute("href", "/income#row-in_9");
  });
});

describe("an upload to a row deleted meanwhile (REVIEW #86 r1 F2)", () => {
  it("says so in a toast and doesn't refresh the screen, which would close the dialog", async () => {
    deleteRecordForStub("ex_gone_upload");
    vi.mocked(toast.error).mockClear();
    const onChanged = vi.fn();
    const dialog = await openAttach("ex_gone_upload", onChanged);
    await within(dialog).findByText("2026 / Expenses");
    fireEvent.change(dialog.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(["gone"], "demo-late.txt", { type: "text/plain" })] },
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Added demo-late.txt. It isn't attached. That record no longer exists, so the document can't be attached to it.",
      ),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("Unlink in the middle of the list (REVIEW #86 r2 F1)", () => {
  it("moves focus to the next Unlink button", async () => {
    const names = ["demo-a.txt", "demo-b.txt", "demo-c.txt"];
    for (const n of names) {
      const d = await documentRepo.upload(new File([n], n, { type: "text/plain" }));
      await documentLinkRepo.link(d.id, "income", "in_mid");
    }
    render(<LinkedDocuments recordType="income" recordId="in_mid" onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unlink demo-b.txt" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unlink demo-c.txt" })).toHaveFocus(),
    );
  });
});

describe("uploading a file that's already stored (dedupe follow-up)", () => {
  const upload = (dialog: HTMLElement, files: File[]) =>
    fireEvent.change(dialog.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files },
    });

  it("links the existing document instead of adding a copy", async () => {
    const first = await documentRepo.upload(
      new File(["dedupe demo bytes"], "demo-dedupe.txt", { type: "text/plain" }),
    );
    const before = (await documentRepo.list()).length;
    const onChanged = vi.fn();
    const dialog = await openAttach("ex_dedupe", onChanged);
    await within(dialog).findByText("2026 / Expenses");
    upload(dialog, [new File(["dedupe demo bytes"], "scan.txt", { type: "text/plain" })]);
    expect(
      await within(dialog).findByText(
        "scan.txt: Already in Documents, linked as demo-dedupe.txt (Unfiled).",
      ),
    ).toBeVisible();
    expect((await documentRepo.list()).length).toBe(before);
    const links = await documentLinkRepo.forRecord("expense", "ex_dedupe");
    expect(links.map((l) => l.documentId)).toEqual([first.id]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("says so when it's already attached to this row, and adds no link", async () => {
    const doc = await documentRepo.upload(
      new File(["already linked bytes"], "demo-linked-twice.txt", { type: "text/plain" }),
    );
    await documentLinkRepo.link(doc.id, "expense", "ex_twice");
    const onChanged = vi.fn();
    const dialog = await openAttach("ex_twice", onChanged);
    await within(dialog).findByText("2026 / Expenses");
    // The dialog has read this row's links once the Choose existing list knows them.
    await waitFor(async () =>
      expect((await documentLinkRepo.forRecord("expense", "ex_twice")).length).toBe(1),
    );
    upload(dialog, [
      new File(["already linked bytes"], "demo-linked-twice.txt", { type: "text/plain" }),
    ]);
    expect(
      await within(dialog).findByText("demo-linked-twice.txt: already attached to this row."),
    ).toBeVisible();
    expect((await documentLinkRepo.forRecord("expense", "ex_twice")).length).toBe(1);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("adds one copy when the same new file is in one batch twice", async () => {
    const before = (await documentRepo.list()).length;
    const dialog = await openAttach("ex_batch");
    await within(dialog).findByText("2026 / Expenses");
    upload(dialog, [
      new File(["batch twin"], "demo-twin-a.txt", { type: "text/plain" }),
      new File(["batch twin"], "demo-twin-b.txt", { type: "text/plain" }),
    ]);
    expect(await within(dialog).findByText("Added demo-twin-a.txt and attached it.")).toBeVisible();
    expect(
      within(dialog).getByText("demo-twin-b.txt: already attached to this row as demo-twin-a.txt."),
    ).toBeVisible();
    expect((await documentRepo.list()).length).toBe(before + 1);
  });
});

describe("Choose existing says how many there are (d-ux docs polish 2)", () => {
  it("names the cap and the total in a status line, and clears it when a search narrows", async () => {
    for (let i = 0; i < 51; i++)
      await documentRepo.upload(
        new File([`count ${i}`], `demo-count-${i}.txt`, { type: "text/plain" }),
      );
    const dialog = await openAttach("ex_count");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Choose existing" }));
    const line = await within(dialog).findByText(/^Showing 50 of \d+\. Search to find the rest\.$/);
    expect(line).toHaveAttribute("role", "status");
    expect(within(dialog).getAllByRole("button", { name: /^Attach / })).toHaveLength(50);
    fireEvent.change(within(dialog).getByLabelText("Search documents"), {
      target: { value: "demo-count-7" },
    });
    await waitFor(() => expect(line).toBeEmptyDOMElement());
  });
});
