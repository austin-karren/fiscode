import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dropBytesForStub, documentRepo, folderRepo } from "../../lib/documents-stub";
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
    expect(alert).toHaveTextContent('A folder named "receipts" is already here.');
    expect(field).toHaveAccessibleDescription('A folder named "receipts" is already here.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
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
    expect(
      await screen.findByText("File not on this device — restore a backup"),
    ).toBeInTheDocument();
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
});
