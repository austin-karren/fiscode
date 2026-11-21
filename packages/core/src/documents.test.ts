import { describe, expect, it } from "vitest";
import { freeFolderName } from "./documents.ts";

describe("freeFolderName", () => {
  it("keeps a free name; else the next free number, matched without case", () => {
    expect(freeFolderName("Trips", ["Other"])).toBe("Trips");
    expect(freeFolderName("Trips", ["trips"])).toBe("Trips (2)");
    expect(freeFolderName("Trips", ["Trips", "TRIPS (2)"])).toBe("Trips (3)");
  });
});
