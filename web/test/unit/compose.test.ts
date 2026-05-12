import { describe, expect, it, vi } from "vitest";
import { fireNtfy, parseTags, ttlSeconds } from "../../src/routes/compose";

describe("parseTags", () => {
  it("splits a comma-separated string and trims", () => {
    expect(parseTags("todo, idea ,reminder")).toEqual([
      "todo",
      "idea",
      "reminder",
    ]);
  });

  it("returns empty array for an empty string", () => {
    expect(parseTags("")).toEqual([]);
  });

  it("drops empty entries", () => {
    expect(parseTags("a,,b,")).toEqual(["a", "b"]);
  });
});

describe("ttlSeconds", () => {
  it("none maps to null", () => {
    expect(ttlSeconds("none")).toBeNull();
  });

  it("durations map to seconds", () => {
    expect(ttlSeconds("1h")).toBe(3600);
    expect(ttlSeconds("4h")).toBe(14_400);
    expect(ttlSeconds("1d")).toBe(86_400);
    expect(ttlSeconds("7d")).toBe(604_800);
  });
});

describe("fireNtfy", () => {
  const baseNtfy = {
    server: "https://ntfy.sh",
    topic: "nts-test",
    token: null,
  };

  it("no-ops when ntfy config is null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await fireNtfy(null, "default", [], false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("POSTs to {server}/{topic} with X-Title and X-Priority", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    await fireNtfy(baseNtfy, "high", ["todo"], true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://ntfy.sh/nts-test");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Title"]).toBe("Note to Self");
    expect(init.headers["X-Priority"]).toBe("4");
    expect(init.body).toContain("tags: todo");
    expect(init.body).toContain("ttl set");
    vi.unstubAllGlobals();
  });

  it("adds bearer auth when token is set", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    await fireNtfy(
      { ...baseNtfy, token: "tk_abc" },
      "urgent",
      [],
      false,
    );
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tk_abc");
    vi.unstubAllGlobals();
  });

  it("swallows network errors so push remains atomic", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      fireNtfy(baseNtfy, "default", [], false),
    ).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("maps priority to numeric value", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    await fireNtfy(baseNtfy, "low", [], false);
    expect(fetchSpy.mock.calls[0][1].headers["X-Priority"]).toBe("2");
    await fireNtfy(baseNtfy, "default", [], false);
    expect(fetchSpy.mock.calls[1][1].headers["X-Priority"]).toBe("3");
    await fireNtfy(baseNtfy, "high", [], false);
    expect(fetchSpy.mock.calls[2][1].headers["X-Priority"]).toBe("4");
    await fireNtfy(baseNtfy, "urgent", [], false);
    expect(fetchSpy.mock.calls[3][1].headers["X-Priority"]).toBe("5");
    vi.unstubAllGlobals();
  });
});
