import { describe, expect, it } from "vitest";
import { placedInServiceFor } from "./equipment";

describe("placedInServiceFor", () => {
  it("equipment bought before the SE start: the SE start (prefill)", () => {
    expect(placedInServiceFor("equipment", "2025-11-20", undefined, "2026-02-01")).toBe(
      "2026-02-01",
    );
  });

  it("a date the user picked wins", () => {
    expect(placedInServiceFor("equipment", "2025-11-20", "2026-03-15", "2026-02-01")).toBe(
      "2026-03-15",
    );
  });

  it("equipment bought on or after the start: none (placed in service when bought)", () => {
    expect(placedInServiceFor("equipment", "2026-02-01", undefined, "2026-02-01")).toBeNull();
    expect(placedInServiceFor("equipment", "2026-05-01", undefined, "2026-02-01")).toBeNull();
  });

  it("not equipment: none, even with a date entered", () => {
    expect(placedInServiceFor("supplies", "2025-11-20", "2026-03-15", "2026-02-01")).toBeNull();
  });
});
