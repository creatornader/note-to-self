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

  function fakeHttp() {
    const notify = vi.fn().mockResolvedValue({ status: 200 });
    const http = {
      getIndex: vi.fn(),
      putIndex: vi.fn(),
      getMessage: vi.fn(),
      putMessage: vi.fn(),
      deleteMessage: vi.fn(),
      notify,
    };
    return { http, notify };
  }

  it("no-ops when http client is null", async () => {
    const { notify } = fakeHttp();
    await fireNtfy(null, baseNtfy, "default", [], false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("no-ops when ntfy config is null", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy(http, null, "default", [], false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("calls http.notify with server, topic, title, priority, and body", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy(http, baseNtfy, "high", ["todo"], true);
    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0][0];
    expect(payload.server).toBe("https://ntfy.sh");
    expect(payload.topic).toBe("nts-test");
    expect(payload.title).toBe("Note to Self");
    expect(payload.priority).toBe("4");
    expect(payload.body).toContain("tags: todo");
    expect(payload.body).toContain("ttl set");
  });

  it("passes token through when set", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy(http, { ...baseNtfy, token: "tk_abc" }, "urgent", [], false);
    expect(notify.mock.calls[0][0].token).toBe("tk_abc");
  });

  it("omits token field when null", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy(http, baseNtfy, "default", [], false);
    expect(notify.mock.calls[0][0].token).toBeUndefined();
  });

  it("swallows http errors so push remains atomic", async () => {
    const { http } = fakeHttp();
    http.notify.mockRejectedValueOnce(new Error("offline"));
    await expect(
      fireNtfy(http, baseNtfy, "default", [], false),
    ).resolves.toBeUndefined();
  });

  it("maps priority to numeric value", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy(http, baseNtfy, "low", [], false);
    expect(notify.mock.calls[0][0].priority).toBe("2");
    await fireNtfy(http, baseNtfy, "default", [], false);
    expect(notify.mock.calls[1][0].priority).toBe("3");
    await fireNtfy(http, baseNtfy, "high", [], false);
    expect(notify.mock.calls[2][0].priority).toBe("4");
    await fireNtfy(http, baseNtfy, "urgent", [], false);
    expect(notify.mock.calls[3][0].priority).toBe("5");
  });
});
