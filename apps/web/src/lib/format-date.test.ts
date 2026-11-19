import { afterAll, describe, expect, it } from "vitest";

// A date-only string parsed as UTC shows the day before west of UTC. Pin a
// western zone for this file (CI runs in UTC, where the bug cannot show).
const originalTz = process.env.TZ;
process.env.TZ = "America/Denver";

const { formatDate, formatDateTime } = await import("./format-date");

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("formatDate", () => {
  it("runs in a timezone behind UTC", () => {
    expect(new Date("2026-03-02").getDate()).toBe(1);
  });

  it("shows a stored date-only string as the same calendar day", () => {
    expect(formatDate("2026-03-02")).toBe("Mar 2, 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("formats a Date in the date picker's style", () => {
    expect(formatDate(new Date(2026, 10, 18))).toBe("Nov 18, 2026");
  });

  it("passes through a value that is not a date rather than inventing one", () => {
    expect(formatDate("open")).toBe("open");
    expect(formatDate("")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("shows a stored timestamp in local time, with the time of day", () => {
    // 04:33 UTC is 9:33 PM the evening before in Denver (MST).
    expect(formatDateTime("2026-11-19T04:33:10.123Z")).toBe("Nov 18, 2026, 9:33 PM");
  });
});
