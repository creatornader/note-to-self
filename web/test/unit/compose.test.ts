import { describe, expect, it, vi } from "vitest";
import {
  buildNtfyBody,
  fireNtfy,
  parseTags,
  ttlSeconds,
} from "../../src/routes/compose";

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

describe("buildNtfyBody", () => {
  it("plain note returns just 'new note'", () => {
    expect(buildNtfyBody([], null)).toBe("new note");
  });

  it("includes tags joined by comma", () => {
    expect(buildNtfyBody(["work", "urgent"], null)).toBe("new note · work, urgent");
  });

  it("includes ttl suffix", () => {
    expect(buildNtfyBody([], "4h")).toBe("new note · expires in 4h");
  });

  it("combines tags and ttl", () => {
    expect(buildNtfyBody(["work"], "30m")).toBe("new note · work · expires in 30m");
  });

  it("matches the Rust CLI body byte-for-byte", () => {
    // These four fixtures are the same shape asserted by the Rust
    // test_build_body_* suite in src/notify.rs. If either side
    // diverges, push notifications between CLI-published and PWA-published
    // messages would look inconsistent on the device.
    expect(buildNtfyBody([], null)).toBe("new note");
    expect(buildNtfyBody(["work", "urgent"], null)).toBe("new note · work, urgent");
    expect(buildNtfyBody([], "4h")).toBe("new note · expires in 4h");
    expect(buildNtfyBody(["work"], "30m")).toBe("new note · work · expires in 30m");
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

  const baseArgs = {
    messageId: "1234567890_abcd1234",
    priority: "default" as const,
    tags: [],
    ttlLabel: null,
  };

  it("no-ops when http client is null", async () => {
    const { notify } = fakeHttp();
    await fireNtfy({ ...baseArgs, http: null, ntfy: baseNtfy });
    expect(notify).not.toHaveBeenCalled();
  });

  it("no-ops when ntfy config is null", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy({ ...baseArgs, http, ntfy: null });
    expect(notify).not.toHaveBeenCalled();
  });

  it("sends server, topic, title, priority, body", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy({
      ...baseArgs,
      http,
      ntfy: baseNtfy,
      priority: "high",
      tags: ["todo"],
      ttlLabel: "4h",
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0][0];
    expect(payload.server).toBe("https://ntfy.sh");
    expect(payload.topic).toBe("nts-test");
    expect(payload.title).toBe("Note to Self");
    expect(payload.priority).toBe("4");
    expect(payload.body).toBe("new note · todo · expires in 4h");
  });

  it("includes click url when clickBaseUrl provided", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy({
      ...baseArgs,
      http,
      ntfy: baseNtfy,
      clickBaseUrl: "https://nts-pwa.pages.dev",
    });
    expect(notify.mock.calls[0][0].click).toBe(
      "https://nts-pwa.pages.dev/m/1234567890_abcd1234",
    );
  });

  it("strips trailing slash from clickBaseUrl", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy({
      ...baseArgs,
      http,
      ntfy: baseNtfy,
      clickBaseUrl: "https://nts-pwa.pages.dev/",
    });
    expect(notify.mock.calls[0][0].click).toBe(
      "https://nts-pwa.pages.dev/m/1234567890_abcd1234",
    );
  });

  it("omits click field when clickBaseUrl not provided", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy({ ...baseArgs, http, ntfy: baseNtfy });
    expect(notify.mock.calls[0][0].click).toBeUndefined();
  });

  it("passes token through when set", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy({
      ...baseArgs,
      http,
      ntfy: { ...baseNtfy, token: "tk_abc" },
    });
    expect(notify.mock.calls[0][0].token).toBe("tk_abc");
  });

  it("omits token field when null", async () => {
    const { http, notify } = fakeHttp();
    await fireNtfy({ ...baseArgs, http, ntfy: baseNtfy });
    expect(notify.mock.calls[0][0].token).toBeUndefined();
  });

  it("swallows http errors so push remains atomic", async () => {
    const { http } = fakeHttp();
    http.notify.mockRejectedValueOnce(new Error("offline"));
    await expect(
      fireNtfy({ ...baseArgs, http, ntfy: baseNtfy }),
    ).resolves.toBeUndefined();
  });

  it("maps priority to numeric value", async () => {
    const { http, notify } = fakeHttp();
    for (const [p, expected] of [
      ["low", "2"],
      ["default", "3"],
      ["high", "4"],
      ["urgent", "5"],
    ] as const) {
      await fireNtfy({ ...baseArgs, http, ntfy: baseNtfy, priority: p });
      const last = notify.mock.calls[notify.mock.calls.length - 1][0];
      expect(last.priority).toBe(expected);
    }
  });
});
