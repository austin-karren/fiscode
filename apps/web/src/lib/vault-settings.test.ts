import { describe, expect, it } from "vitest";
import { OperationCancelledError, VaultNameTakenError } from "@fiscode/core";

import { vaultSwitchLine } from "./vault-settings";

describe("vaultSwitchLine (ADR 0001 § 11.2)", () => {
  it("says nothing changed when the user cancels", () => {
    expect(vaultSwitchLine(new OperationCancelledError())).toBe("Nothing changed.");
  });

  it("names the path and says what to do when the folder holds the user's own file", () => {
    expect(vaultSwitchLine(new VaultNameTakenError("documents/2026/receipt.pdf"))).toBe(
      "documents/2026/receipt.pdf: pick an empty folder or move that file.",
    );
  });

  it("shows any other error's own message", () => {
    expect(vaultSwitchLine(new Error("Busy in another tab. Try again when it finishes."))).toBe(
      "Busy in another tab. Try again when it finishes.",
    );
  });

  it("falls back to a generic line for a non-error", () => {
    expect(vaultSwitchLine("boom")).toBe("That didn't work. Try again.");
  });
});
