import { describe, expect, it } from "vitest";
import { baseName, count, scanProgressLine, skippedLine } from "./vault-check-view";

describe("Check folder words", () => {
  it("shows the scan's progress with counts once known", () => {
    expect(scanProgressLine(undefined)).toBe("Checking files");
    expect(scanProgressLine({ phase: "scanning", done: 0, total: 0 })).toBe("Checking files");
    expect(scanProgressLine({ phase: "scanning", done: 3, total: 12 })).toBe(
      "Checking files (3 of 12)",
    );
  });

  it("says why a check was skipped", () => {
    expect(skippedLine({ status: "skipped", reason: "busy" })).toMatch(/^Busy in another tab/);
    expect(skippedLine({ status: "skipped", reason: "migrating" })).toMatch(/moved into the vault/);
  });

  it("counts and names", () => {
    expect(count(1, "file")).toBe("1 file");
    expect(count(3, "file")).toBe("3 files");
    expect(baseName("documents/2026/Expenses/2026-11-23 Demo.pdf")).toBe("2026-11-23 Demo.pdf");
  });
});
