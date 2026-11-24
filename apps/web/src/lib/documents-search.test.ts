import { describe, expect, it } from "vitest";
import {
  documentLinkSearch,
  openFolderId,
  parseDocumentsSearch,
  uploadLinesFor,
} from "./documents-search";

describe("the /documents URL (REVIEW #110 r1)", () => {
  it("reads unfiled from 1, true and 'true', and drops anything else", () => {
    for (const v of ["1", 1, true, "true"])
      expect(parseDocumentsSearch({ unfiled: v }).unfiled).toBe(true);
    for (const v of ["0", false, "yes", undefined])
      expect(parseDocumentsSearch({ unfiled: v }).unfiled).toBeUndefined();
  });

  it("opens no folder for Unfiled, not the year's", () => {
    expect(openFolderId({ unfiled: true }, "y2026")).toBeNull();
    expect(openFolderId({ unfiled: true, folder: "e" }, "y2026")).toBeNull();
    expect(openFolderId({}, "y2026")).toBe("y2026");
    expect(openFolderId({ folder: "e" }, "y2026")).toBe("e");
  });

  it("links a document with no folder to Unfiled, and others to their folder", () => {
    expect(documentLinkSearch({ id: "d1", folderId: null })).toEqual({ unfiled: true, doc: "d1" });
    expect(documentLinkSearch({ id: "d2", folderId: "e" })).toEqual({ folder: "e", doc: "d2" });
  });
});

describe("upload lines (d-ux follow-up 2)", () => {
  const uploaded = { folderId: "e", results: ["Added demo-receipt.pdf"] };
  it("show in the list they were made in", () => {
    expect(uploadLinesFor(uploaded, { folderId: "e" })).toEqual(["Added demo-receipt.pdf"]);
  });
  it("go after a folder change, Unfiled included, and over a search", () => {
    expect(uploadLinesFor(uploaded, { folderId: "o" })).toEqual([]);
    expect(uploadLinesFor(uploaded, { folderId: null })).toEqual([]);
    expect(uploadLinesFor(uploaded, { folderId: "e", q: "demo" })).toEqual([]);
  });
  it("made in Unfiled show only in Unfiled", () => {
    const unfiled = { folderId: null, results: ["Added a"] };
    expect(uploadLinesFor(unfiled, { folderId: null })).toEqual(["Added a"]);
    expect(uploadLinesFor(unfiled, { folderId: "e" })).toEqual([]);
  });
});
