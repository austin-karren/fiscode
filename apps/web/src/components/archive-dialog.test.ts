import { describe, expect, it } from "vitest";

import { describeDocuments } from "./archive-dialog";

describe("archive dialog: linked documents", () => {
  it("says nothing with none, and counts one or more", () => {
    expect(describeDocuments(0)).toBe("");
    expect(describeDocuments(1)).toBe("1 linked document stays in Documents. ");
    expect(describeDocuments(3)).toBe("3 linked documents stay in Documents. ");
  });
});
