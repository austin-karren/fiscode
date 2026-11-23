import { describe, expect, it } from "vitest";
import {
  MAX_VAULT_PATH,
  safeSegment,
  vaultFileName,
  vaultFolderName,
  vaultFolderRules,
  vaultPath,
  vaultSegment,
  VaultPathTooLongError,
  DocumentError,
} from "./index.ts";

const bytes = (s: string) => encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, "x").length;

describe("vaultSegment", () => {
  it("prefixes Windows device names, with or without an extension", () => {
    expect(vaultSegment("CON")).toBe("_CON");
    expect(vaultSegment("nul.txt")).toBe("_nul.txt");
    expect(vaultSegment("COM¹")).toBe("_COM¹");
    expect(vaultSegment("conout$")).toBe("_conout$");
    expect(vaultSegment("Console")).toBe("Console");
  });
  it("strips trailing dots and spaces", () => {
    expect(vaultSegment("Receipts. . ")).toBe("Receipts");
  });
  it("replaces reserved characters and slashes, drops control characters", () => {
    expect(vaultSegment('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(vaultSegment("a\u0001b\u007fc\u0085d")).toBe("abcd");
  });
  it("collapses whitespace, never leaves a leading dot or a sync-temp ending", () => {
    expect(vaultSegment("  Acme \t  invoice ")).toBe("Acme invoice");
    expect(vaultSegment(".htaccess")).toBe("_htaccess");
    expect(vaultSegment("scan.part")).toBe("scan.part_");
    expect(vaultSegment("draft~")).toBe("draft~_");
  });
  it("normalises unicode to NFC and is never empty", () => {
    expect(vaultSegment("Café")).toBe("Café");
    expect(vaultSegment(" ..")).toBe("_");
  });
});

describe("safeSegment (backup format 1, frozen)", () => {
  it("keeps the old output", () => {
    expect(safeSegment("a/b\\c")).toBe("abc");
    expect(safeSegment(".hidden")).toBe(".hidden");
    expect(safeSegment("CON.pdf")).toBe("_CON.pdf");
  });
});

describe("vaultFileName", () => {
  it("prefixes the date and lower-cases the extension", () => {
    expect(vaultFileName({ date: "2026-03-04", title: "Demo NAS", ext: "PDF" })).toBe(
      "2026-03-04 Demo NAS.pdf",
    );
  });
  it("does not prefix twice or keep the extension in the title", () => {
    expect(vaultFileName({ date: "2026-03-04", title: "2026-03-04 Demo.pdf", ext: "pdf" })).toBe(
      "2026-03-04 Demo.pdf",
    );
  });
  it("ignores a date that isn't YYYY-MM-DD", () => {
    expect(vaultFileName({ date: "3/4/2026", title: "Demo", ext: "pdf" })).toBe("Demo.pdf");
    expect(vaultFileName({ date: "2026-3-4", title: "Demo", ext: "pdf" })).toBe("Demo.pdf");
  });
  it("guards a .filepart ending", () => {
    expect(vaultSegment("scan.filepart")).toBe("scan.filepart_");
    expect(vaultSegment("SCAN.FILEPART")).toBe("SCAN.FILEPART_");
  });
  it("works without a date or a title", () => {
    expect(vaultFileName({ date: null, title: "Demo", ext: "png" })).toBe("Demo.png");
    expect(vaultFileName({ date: "2026-01-31", title: "  ", ext: "png" })).toBe("2026-01-31.png");
  });
  it("sanitises the title and handles reserved names", () => {
    expect(vaultFileName({ date: null, title: "CON", ext: "pdf" })).toBe("_CON.pdf");
    expect(vaultFileName({ date: "2026-01-31", title: "a/b: c.", ext: "pdf" })).toBe(
      "2026-01-31 a_b_ c.pdf",
    );
  });
  it("cuts to 120 UTF-8 bytes at a grapheme boundary, extension kept", () => {
    const name = vaultFileName({ date: "2026-01-31", title: "é".repeat(200), ext: "pdf" });
    expect(bytes(name)).toBeLessThanOrEqual(120);
    expect(name.endsWith("é.pdf")).toBe(true);
    const emoji = vaultFileName({ date: null, title: "👩‍👩‍👧".repeat(20), ext: "pdf" });
    expect(bytes(emoji)).toBeLessThanOrEqual(120);
    expect(emoji.replace(/\.pdf$/, "").replace(/(👩‍👩‍👧)+/u, "")).toBe("");
  });
});

describe("vaultPath", () => {
  const base = { date: "2026-03-04", title: "Demo NAS", ext: "pdf" };
  it("puts a document under documents/<folders>/ or Unfiled", () => {
    expect(vaultPath({ ...base, folders: ["2026", "Expenses"] })).toEqual({
      path: "documents/2026/Expenses/2026-03-04 Demo NAS.pdf",
      fits: true,
      overBy: 0,
    });
    expect(vaultPath({ ...base, folders: null }).path).toBe(
      "documents/Unfiled/2026-03-04 Demo NAS.pdf",
    );
  });
  it("numbers a clash ignoring case and NFC, before the extension", () => {
    const taken = [
      "DOCUMENTS/2026/expenses/2026-03-04 demo nas.PDF",
      "documents/2026/Expenses/2026-03-04 Demo NAS (2).pdf",
    ];
    expect(vaultPath({ ...base, folders: ["2026", "Expenses"] }, taken).path).toBe(
      "documents/2026/Expenses/2026-03-04 Demo NAS (3).pdf",
    );
    const cafe = vaultPath({ ...base, title: "Café", folders: null }, [
      "documents/Unfiled/2026-03-04 Café.pdf",
    ]);
    expect(cafe.path).toBe("documents/Unfiled/2026-03-04 Café (2).pdf");
  });
  it("leaves room for the suffix inside the byte limit", () => {
    const first = vaultPath({ ...base, title: "x".repeat(200), folders: null });
    const second = vaultPath({ ...base, title: "x".repeat(200), folders: null }, [first.path]);
    const name = second.path.split("/").pop()!;
    expect(bytes(name)).toBeLessThanOrEqual(120);
    expect(name.endsWith(" (2).pdf")).toBe(true);
  });
  it("shortens the title to keep the path within 240", () => {
    const folders = ["2026", "a".repeat(110)];
    const r = vaultPath({ ...base, title: "t".repeat(110), folders });
    expect(r.fits).toBe(true);
    expect(r.path.length).toBe(MAX_VAULT_PATH);
  });
  it("returns fits false with overBy when folders alone are too long", () => {
    const folders = ["a".repeat(110), "b".repeat(110), "c".repeat(110)];
    const r = vaultPath({ ...base, folders });
    expect(r.fits).toBe(false);
    expect(r.overBy).toBe(r.path.length - MAX_VAULT_PATH);
    expect(r.overBy).toBeGreaterThan(0);
  });
  it("keeps a top-level user folder named Unfiled apart from Unfiled", () => {
    expect(vaultPath({ ...base, folders: ["unfiled", "x"] }).path).toBe(
      "documents/unfiled (2)/x/2026-03-04 Demo NAS.pdf",
    );
  });
  it("numbers a top-level Unfiled past taken siblings", () => {
    expect(
      vaultPath({ ...base, folders: ["Unfiled"], topLevelSiblings: ["unfiled (2)", "2026"] }).path,
    ).toBe("documents/Unfiled (3)/2026-03-04 Demo NAS.pdf");
  });
  it("re-sanitises a folder name after the cut", () => {
    const cut = vaultFolderName(`${"a".repeat(114)} .part ~ bbbb`);
    expect(cut).not.toMatch(/[. ]$|\.part$|~$/);
    expect(bytes(cut)).toBeLessThanOrEqual(120);
    expect(vaultFolderName(`${"a".repeat(118)}..xyz`)).toBe("a".repeat(118));
  });
  it("caps a malformed extension and keeps its dot", () => {
    const name = vaultFileName({ date: null, title: "Demo", ext: "p".repeat(115) });
    expect(name).toBe(`Demo.${"p".repeat(16)}`);
  });
  it("cuts folder names to 120 bytes", () => {
    expect(bytes(vaultFolderName("ü".repeat(100)))).toBeLessThanOrEqual(120);
  });
});

describe("vaultFolderRules", () => {
  it("fixes years, keeps categories in their year, frees user folders", () => {
    expect(vaultFolderRules("year-root")).toEqual({ rename: false, move: false });
    expect(vaultFolderRules("expenses")).toEqual({ rename: true, move: false });
    expect(vaultFolderRules(null)).toEqual({ rename: true, move: true });
  });
});

describe("vault errors", () => {
  it("are DocumentErrors with a message to show", () => {
    const e = new VaultPathTooLongError("documents/x.pdf");
    expect(e).toBeInstanceOf(DocumentError);
    expect(e.path).toBe("documents/x.pdf");
    expect(e.message).toMatch(/Name too long/);
  });
});
