import { describe, expect, it, vi } from "vitest";

vi.mock("@fiscode/db", async () => {
  const fake = await import("../test/fake-documents");
  return { folderRepo: fake.folderRepo };
});

import { todayIso, yearOf } from "@fiscode/core";

import { folderForRecord, isLinkable, linkedRowLabel, ROUTE_FOR } from "./documents-links";

const rec = (recordType: string, date: string, label: string) =>
  ({ recordType, id: "x", date, label }) as Parameters<typeof linkedRowLabel>[0];

describe("links on more screens (d-ux docs polish 3)", () => {
  it("knows the screen of every linkable type", () => {
    for (const t of ["home_office", "client", "vehicle", "profile"])
      expect(isLinkable(t)).toBe(true);
    expect(ROUTE_FOR.home_office).toBe("/home-office");
    expect(ROUTE_FOR.profile).toBe("/profile");
  });

  it("reads each new type's row in words", () => {
    expect(
      linkedRowLabel(rec("home_office", "2026-03-01", "2026-03-01 · Home office · Simplified")),
    ).toBe("Mar 1, 2026 · Home office · Simplified");
    expect(linkedRowLabel(rec("vehicle", "2026-02-10", "2026-02-10 · 2022 Demo Wagon"))).toBe(
      "Vehicle Feb 10, 2026 · 2022 Demo Wagon",
    );
    expect(linkedRowLabel(rec("vehicle", "", "2022 Demo Wagon"))).toBe("Vehicle · 2022 Demo Wagon");
    expect(linkedRowLabel(rec("client", "", "Demo Client Co"))).toBe("Client · Demo Client Co");
    expect(linkedRowLabel(rec("profile", "", "Tax profile · Single · TX"))).toBe(
      "Tax profile · Single · TX",
    );
  });

  it("files an undated record's upload under this year", async () => {
    const year = yearOf(todayIso());
    expect((await folderForRecord("client", "")).path).toBe(`${year} / Income`);
    expect((await folderForRecord("profile", "")).path).toBe(`${year} / Tax forms`);
    expect((await folderForRecord("home_office", "2025-06-01")).path).toBe("2025 / Other");
  });
});
