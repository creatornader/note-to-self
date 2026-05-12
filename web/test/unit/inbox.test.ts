import { describe, expect, it } from "vitest";
import { formatRelative } from "../../src/routes/inbox";

const NOW = new Date("2026-05-12T12:00:00Z").getTime();

describe("formatRelative", () => {
  it("renders 'just now' for differences under 5 seconds", () => {
    expect(formatRelative(NOW, new Date(NOW - 2000).toISOString())).toBe(
      "just now",
    );
  });

  it("renders seconds for under-a-minute", () => {
    expect(formatRelative(NOW, new Date(NOW - 30_000).toISOString())).toBe(
      "30s ago",
    );
  });

  it("renders minutes for under-an-hour", () => {
    expect(formatRelative(NOW, new Date(NOW - 25 * 60_000).toISOString())).toBe(
      "25 min ago",
    );
  });

  it("renders hours for under-a-day", () => {
    expect(
      formatRelative(NOW, new Date(NOW - 3 * 3_600_000).toISOString()),
    ).toBe("3 hr ago");
  });

  it("renders days for under-a-week", () => {
    expect(
      formatRelative(NOW, new Date(NOW - 4 * 86_400_000).toISOString()),
    ).toBe("4d ago");
  });

  it("falls back to a locale date for older timestamps", () => {
    const old = new Date(NOW - 30 * 86_400_000);
    const result = formatRelative(NOW, old.toISOString());
    expect(result).toBe(old.toLocaleDateString());
  });

  it("returns em-dash for unparseable timestamps", () => {
    expect(formatRelative(NOW, "not a date")).toBe("—");
  });

  it("clamps negative offsets to 'just now' (clock skew tolerance)", () => {
    expect(formatRelative(NOW, new Date(NOW + 5000).toISOString())).toBe(
      "just now",
    );
  });
});
