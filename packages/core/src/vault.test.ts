import { describe, expect, it } from "vitest";
import {
  shortenFolderNames,
  MAX_VAULT_PATH,
  safeSegment,
  folderPathFits,
  freeFolderName,
  VAULT_FILE_RESERVE,
  VAULT_MIN_TITLE,
  vaultFileName,
  vaultFolderName,
  vaultFolderRules,
  titleHasDate,
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
  describe("a title that already starts with a date (no double prefix)", () => {
    const name = (title: string) => vaultFileName({ date: "2026-11-23", title, ext: "pdf" });
    it("no date in the title: prefixed", () => {
      expect(name("Demo receipt")).toBe("2026-11-23 Demo receipt.pdf");
    });
    it("a leading date: the title as it is", () => {
      expect(name("2026-11-23 Demo receipt")).toBe("2026-11-23 Demo receipt.pdf");
    });
    it("a leading date that differs from the record's: still the title as it is", () => {
      expect(name("2026-08-12 Demo receipt")).toBe("2026-08-12 Demo receipt.pdf");
      expect(name("2026-08-12")).toBe("2026-08-12.pdf");
    });
    it("a date not at the start: prefixed", () => {
      expect(name("Receipt 2026-08-12")).toBe("2026-11-23 Receipt 2026-08-12.pdf");
    });
    it("a leading bare year and a space: the title as it is", () => {
      expect(name("2025 W-2")).toBe("2025 W-2.pdf");
      expect(name("2026 budget")).toBe("2026 budget.pdf");
      expect(name("1900 deed")).toBe("1900 deed.pdf");
      expect(name("2199 plan")).toBe("2199 plan.pdf");
    });
    it("a bare year with no space after it: prefixed", () => {
      // "2025" alone and "2025-budget" don't read as a year label, so they keep the prefix.
      expect(name("2025")).toBe("2026-11-23 2025.pdf");
      expect(name("2025-budget")).toBe("2026-11-23 2025-budget.pdf");
    });
    it("a leading number that isn't a plausible year: prefixed", () => {
      expect(name("12345 receipt")).toBe("2026-11-23 12345 receipt.pdf");
      expect(name("1899 deed")).toBe("2026-11-23 1899 deed.pdf");
      expect(name("2200 plan")).toBe("2026-11-23 2200 plan.pdf");
      expect(name("2026-08-12x")).toBe("2026-11-23 2026-08-12x.pdf");
    });
    it("a leading date that isn't a calendar day: prefixed", () => {
      expect(name("2026-13-40 notes")).toBe("2026-11-23 2026-13-40 notes.pdf");
      expect(name("2026-02-30")).toBe("2026-11-23 2026-02-30.pdf");
      expect(name("2028-02-29")).toBe("2028-02-29.pdf");
    });
  });
  describe("titleHasDate", () => {
    it("tests the title without its extension when given one", () => {
      expect(titleHasDate("2026-08-12.pdf", "pdf")).toBe(true);
      expect(titleHasDate("2026-08-12 Bill.PDF", "pdf")).toBe(true);
      expect(titleHasDate("2026-08-12.pdf")).toBe(false);
      expect(titleHasDate("Bill.pdf", "pdf")).toBe(false);
    });
    it("only counts a valid calendar date", () => {
      expect(titleHasDate("2026-13-40 notes")).toBe(false);
      expect(titleHasDate("2026-02-30")).toBe(false);
      expect(titleHasDate("2026-02-28")).toBe(true);
    });
    it("counts a leading year 1900-2199 followed by a space", () => {
      expect(titleHasDate("2025 W-2.pdf", "pdf")).toBe(true);
      expect(titleHasDate("2025.pdf", "pdf")).toBe(false);
      expect(titleHasDate("2025-budget")).toBe(false);
      expect(titleHasDate("12345 receipt")).toBe(false);
      expect(titleHasDate("1899 deed")).toBe(false);
    });
  });
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
  it("never renames a real top-level folder for being among its siblings", () => {
    expect(
      vaultPath({ ...base, folders: ["2026"], topLevelSiblings: ["2026", "Unfiled"] }).path,
    ).toBe("documents/2026/2026-03-04 Demo NAS.pdf");
  });
  it("compares paths ignoring case and accents, like freeFolderName", () => {
    const r = vaultPath({ ...base, title: "Cafe", folders: null }, [
      "documents/unfiled/2026-03-04 CAFÉ.pdf",
    ]);
    expect(r.path).toBe("documents/Unfiled/2026-03-04 Cafe (2).pdf");
    expect(freeFolderName("Cafe", ["CAFÉ"])).toBe("Cafe (2)");
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

describe("folderPathFits", () => {
  it("fits when path + 30 is at most 240", () => {
    expect(VAULT_FILE_RESERVE).toBe(30);
    const at = `documents/${"a".repeat(240 - 30 - 10)}`;
    expect(folderPathFits(at)).toEqual({ fits: true, overBy: 0 });
    expect(folderPathFits(`${at}b`)).toEqual({ fits: false, overBy: 1 });
  });
  it("counts the deepest descendant on a rename or move", () => {
    expect(folderPathFits("documents/2026/Trips", "/Spring")).toEqual({ fits: true, overBy: 0 });
    const r = folderPathFits(`documents/2026/${"b".repeat(100)}`, `/${"c".repeat(100)}`);
    expect(r).toEqual({ fits: false, overBy: 15 + 100 + 101 + 30 - 240 });
  });
});

describe("vaultPath title floor", () => {
  it("never cuts the title below 8 characters; reports fits false instead", () => {
    const folders = [`${"a".repeat(110)}`, `${"b".repeat(100)}`];
    const r = vaultPath({ date: "2026-03-04", title: "t".repeat(50), ext: "pdf", folders });
    const title = r.path.split("/").pop()!.slice(11, -4);
    expect(title).toBe("t".repeat(VAULT_MIN_TITLE));
    expect(r.fits).toBe(false);
    expect(r.overBy).toBe(r.path.length - 240);
  });
});

describe("shortenFolderNames (§ 3.8 fallback)", () => {
  it("leaves a path that fits alone", () => {
    expect(shortenFolderNames(["2026", "Expenses"])).toEqual({
      names: ["2026", "Expenses"],
      fits: true,
    });
  });

  it("cuts from the top down, only as much as needed", () => {
    const long = "L".repeat(110);
    const r = shortenFolderNames([long, long]);
    expect(r.fits).toBe(true);
    // documents/ (10) + a + / + b + 30 = 240
    expect(10 + r.names[0]!.length + 1 + r.names[1]!.length + 30).toBe(240);
    expect(r.names[1]).toBe(long);
  });

  it("counts the deepest descendant's suffix", () => {
    const r = shortenFolderNames(["A".repeat(100)], "/" + "B".repeat(100));
    expect(r.fits).toBe(true);
    expect(r.names[0]!.length).toBe(100 - (10 + 100 + 101 + 30 - 240));
  });

  it("never cuts below one grapheme and reports when it still doesn't fit", () => {
    const r = shortenFolderNames(["👩‍👩‍👧 family"], "/" + "x".repeat(220));
    expect(r.names[0]).toBe("👩‍👩‍👧");
    expect(r.fits).toBe(false);
  });
});
