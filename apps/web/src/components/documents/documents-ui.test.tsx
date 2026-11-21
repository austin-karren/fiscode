import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@fiscode/db", async () => {
  // SQLite and OPFS don't exist in jsdom: the repos are the in-memory fake.
  const fake = await import("../../test/fake-documents");
  return {
    folderRepo: fake.folderRepo,
    documentRepo: fake.documentRepo,
    documentLinkRepo: fake.documentLinkRepo,
  };
});

// The router isn't needed here: its links render as plain anchors with their target.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    hash,
    ...rest
  }: Record<string, unknown> & { children: React.ReactNode }) => (
    <a href={`${to as string}${hash ? `#${hash as string}` : ""}`} {...rest}>
      {children}
    </a>
  ),
}));

import { validDocumentName } from "@fiscode/core";
import { documentRepo, folderRepo } from "@fiscode/db";

import { dropBytesForStub } from "../../test/fake-documents";
import { DocumentSheet } from "./document-sheet";
import { MoveDialog } from "./move-dialog";
import { NameDialog } from "./name-dialog";

afterEach(cleanup);

describe("name dialog", () => {
  it("shows the repo's error as one line, linked to the field, and stays open", async () => {
    const parent = await folderRepo.create({ name: "Demo dialog" });
    await folderRepo.create({ name: "Receipts", parentId: parent.id });
    const onOpenChange = vi.fn();
    render(
      <NameDialog
        open
        onOpenChange={onOpenChange}
        title="New folder"
        label="Folder name"
        submitLabel="Create"
        onSubmit={async (name) => {
          await folderRepo.create({ name, parentId: parent.id });
        }}
      />,
    );
    const field = screen.getByLabelText("Folder name");
    fireEvent.change(field, { target: { value: "receipts" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      'There is already a folder named "receipts" here. Choose another name.',
    );
    expect(field).toHaveAccessibleDescription(
      'There is already a folder named "receipts" here. Choose another name.',
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("name dialog opens fresh each time (REVIEW #83 r2 F2)", () => {
  it("starts blank for a new folder after a rename, and from the current name for a rename", () => {
    const props = {
      title: "Folder",
      label: "Folder name",
      submitLabel: "Save",
      onOpenChange: () => {},
      onSubmit: async () => {},
    };
    const { rerender } = render(<NameDialog {...props} open initial="" />);
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Alpha" } });
    rerender(<NameDialog {...props} open={false} initial="" />);
    rerender(<NameDialog {...props} open initial="" />);
    expect(screen.getByLabelText("Folder name")).toHaveValue("");
    rerender(<NameDialog {...props} open={false} initial="Demo receipts" />);
    rerender(<NameDialog {...props} open initial="Demo receipts" />);
    expect(screen.getByLabelText("Folder name")).toHaveValue("Demo receipts");
  });
});

describe("document rename checks the name on blur and on submit (#84)", () => {
  it("shows why, on one line linked to the field, and doesn't save", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <NameDialog
        open
        onOpenChange={() => {}}
        title="Rename document"
        label="Name"
        initial="demo.pdf"
        submitLabel="Rename"
        onSubmit={onSubmit}
        validate={(name) => {
          try {
            validDocumentName(name);
            return undefined;
          } catch (err) {
            return (err as Error).message;
          }
        }}
      />,
    );
    const field = screen.getByLabelText("Name");
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);
    expect(field).toHaveAccessibleDescription("Enter a name.");
    fireEvent.change(field, { target: { value: "a/b.pdf" } });
    fireEvent.submit(field.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("A name can't contain /.");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("a blank name says why instead of disabling the button (REVIEW #83 r5 note)", () => {
  it("keeps Create enabled and shows the repo's reason", async () => {
    render(
      <NameDialog
        open
        onOpenChange={() => {}}
        title="New folder"
        label="Folder name"
        submitLabel="Create"
        onSubmit={async (name) => {
          await folderRepo.create({ name });
        }}
      />,
    );
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name.");
  });
});

describe("move dialog", () => {
  it("leaves out the folder and everything inside it", async () => {
    const a = await folderRepo.create({ name: "Demo move A" });
    const b = await folderRepo.create({ name: "Demo move B", parentId: a.id });
    const other = await folderRepo.create({ name: "Demo move other" });
    render(
      <MoveDialog
        open
        onOpenChange={() => {}}
        title="Move Demo move A"
        tree={await folderRepo.tree()}
        exclude={new Set([a.id, b.id])}
        topLabel="Top level"
        current={null}
        onMove={async () => {}}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Move to" });
    select.focus();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent?.trim());
    expect(options).toContain("Top level");
    expect(options).toContain(other.name);
    expect(options).not.toContain("Demo move A");
    expect(options).not.toContain("Demo move B");
  });
});

describe("document sheet", () => {
  it("says the file isn't on this device when its bytes are missing", async () => {
    const doc = await documentRepo.upload(
      new File(["demo"], "demo-missing.txt", { type: "text/plain" }),
    );
    dropBytesForStub(doc.sha256);
    render(
      <DocumentSheet doc={doc} folderPath="Unfiled" onClose={() => {}} onChanged={() => {}} />,
    );
    const link = await screen.findByRole("link", { name: "restore a backup" });
    expect(link.closest("p")).toHaveTextContent("File not on this device — restore a backup");
    // It opens the restore flow: the backup card on the dashboard.
    expect(link).toHaveAttribute("href", "/#backup");
  });

  it("revokes the preview's object URL when it closes", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo-1");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const doc = await documentRepo.upload(
      new File(["demo text"], "demo-preview.txt", { type: "text/plain" }),
    );
    const { unmount } = render(
      <DocumentSheet doc={doc} folderPath="Unfiled" onClose={() => {}} onChanged={() => {}} />,
    );
    await waitFor(() => expect(create).toHaveBeenCalled());
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:demo-1");
    create.mockRestore();
    revoke.mockRestore();
  });

  it("gives a replaced file's name the new file's extension", async () => {
    const doc = await documentRepo.upload(
      new File(["%PDF demo"], "demo-receipt.pdf", { type: "application/pdf" }),
    );
    render(
      <DocumentSheet doc={doc} folderPath="Unfiled" onClose={() => {}} onChanged={() => {}} />,
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(["PNG demo"], "scan.png", { type: "image/png" })] },
    });
    await waitFor(async () =>
      expect((await documentRepo.get(doc.id))?.name).toBe("demo-receipt.png"),
    );
    expect((await documentRepo.get(doc.id))?.mime).toBe("image/png");
  });

  it("labels the newest version Current, though the repo lists oldest first (REVIEW #83 final F5)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 20, 19, 23));
    const doc = await documentRepo.upload(
      new File(["PNG demo"], "demo.png", { type: "image/png" }),
    );
    vi.setSystemTime(new Date(2026, 10, 20, 19, 24));
    const replaced = await documentRepo.replaceBytes(
      doc.id,
      new File(["%PDF demo, longer"], "demo.pdf", { type: "application/pdf" }),
    );
    vi.useRealTimers();
    render(
      <DocumentSheet doc={replaced} folderPath="Unfiled" onClose={() => {}} onChanged={() => {}} />,
    );
    const versions = await screen.findAllByText(/^(Current|Earlier) ·/);
    expect(versions.map((v) => v.textContent)).toEqual([
      expect.stringMatching(/^Current · Nov 20, 2026, 7:24/),
      expect.stringMatching(/^Earlier · Nov 20, 2026, 7:23/),
    ]);
  });
});
