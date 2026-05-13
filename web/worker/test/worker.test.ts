import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetDevicesCacheForTests } from "../src/index";

const VALID_ID = "1700000000_abc12def";
const BASE = "http://nts-worker.example";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function seedDevices(tokens: string[]): Promise<void> {
  const devices = await Promise.all(
    tokens.map(async (t, i) => ({
      name: `test-${i}`,
      token_hash: await sha256Hex(t),
      created_at: "2026-05-12T00:00:00Z",
    })),
  );
  await (env.BUCKET).put(
    "devices.json",
    JSON.stringify({ devices }),
  );
}

async function clearBucket(): Promise<void> {
  const bucket = env.BUCKET;
  const listing = await bucket.list();
  for (const obj of listing.objects) {
    await bucket.delete(obj.key);
  }
}

beforeEach(async () => {
  _resetDevicesCacheForTests();
  await clearBucket();
});

// Cross-language SHA-256 fixture: this exact (token, hash) pair is duplicated
// in src/device.rs (test_hash_token_matches_cross_language_fixture). If the
// Worker's Web Crypto SHA-256 ever diverges from Rust's sha2 crate, both sides
// fail loudly.
const CROSS_LANG_TOKEN = "nts_known_fixture_token_v1";
const CROSS_LANG_HASH =
  "44d40537bb51f5d5b161190e25fe3c81dd1a90b06a3ea58350f6f7fa00998920";

describe("cross-language SHA-256 fixture", () => {
  it("sha256Hex(fixture token) matches the Rust hash", async () => {
    expect(await sha256Hex(CROSS_LANG_TOKEN)).toBe(CROSS_LANG_HASH);
  });
});

describe("public routes", () => {
  it("GET /v1/health returns 200 ok without auth", async () => {
    const res = await SELF.fetch(`${BASE}/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await SELF.fetch(`${BASE}/v1/index`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("non-OPTIONS responses carry CORS headers from PWA_ORIGIN env", async () => {
    const res = await SELF.fetch(`${BASE}/v1/health`);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(env.PWA_ORIGIN);
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("ETag");
  });
});

describe("auth", () => {
  it("rejects requests without Authorization header (401)", async () => {
    await seedDevices(["nts_token_alpha"]);
    const res = await SELF.fetch(`${BASE}/v1/index`);
    expect(res.status).toBe(401);
  });

  it("rejects malformed bearer tokens (401)", async () => {
    const res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Basic abc" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects unknown bearer tokens (403)", async () => {
    await seedDevices(["nts_known"]);
    const res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Bearer nts_unknown" },
    });
    expect(res.status).toBe(403);
  });

  it("accepts known bearer tokens", async () => {
    await seedDevices(["nts_alpha"]);
    const res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Bearer nts_alpha" },
    });
    expect(res.status).toBe(404);
  });

  it("bearer with only whitespace after prefix returns 401", async () => {
    const res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Bearer    " },
    });
    expect(res.status).toBe(401);
  });

  it("missing devices.json blob rejects every bearer with 403", async () => {
    const res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Bearer nts_anything" },
    });
    expect(res.status).toBe(403);
  });

  it("malformed devices.json rejects every bearer with 403", async () => {
    await env.BUCKET.put("devices.json", "{not valid json");
    const res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Bearer nts_anything" },
    });
    expect(res.status).toBe(403);
  });

  it("auth is required on PUT /v1/index", async () => {
    const res = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      body: new Uint8Array([1]),
    });
    expect(res.status).toBe(401);
  });

  it("auth is required on GET /v1/messages/:id", async () => {
    const res = await SELF.fetch(`${BASE}/v1/messages/${VALID_ID}`);
    expect(res.status).toBe(401);
  });

  it("auth is required on PUT /v1/messages/:id", async () => {
    const res = await SELF.fetch(`${BASE}/v1/messages/${VALID_ID}`, {
      method: "PUT",
      body: new Uint8Array([1]),
    });
    expect(res.status).toBe(401);
  });

  it("auth is required on DELETE /v1/messages/:id", async () => {
    const res = await SELF.fetch(`${BASE}/v1/messages/${VALID_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("revoked tokens are rejected after cache reset", async () => {
    await seedDevices(["nts_alpha"]);
    let res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Bearer nts_alpha" },
    });
    expect(res.status).toBe(404);

    await seedDevices([]);
    _resetDevicesCacheForTests();

    res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Bearer nts_alpha" },
    });
    expect(res.status).toBe(403);
  });

  it("caches device hashes until reset (revoked token still accepted before reset)", async () => {
    await seedDevices(["nts_alpha"]);
    let res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Bearer nts_alpha" },
    });
    expect(res.status).toBe(404);

    await seedDevices([]);

    res = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { Authorization: "Bearer nts_alpha" },
    });
    expect(res.status).toBe(404);
  });
});

describe("index", () => {
  beforeEach(async () => {
    await seedDevices(["nts_alpha"]);
  });

  const authed = { Authorization: "Bearer nts_alpha" };

  it("GET /v1/index returns 404 when no index exists", async () => {
    const res = await SELF.fetch(`${BASE}/v1/index`, { headers: authed });
    expect(res.status).toBe(404);
  });

  it("PUT then GET round-trip yields the body and an ETag", async () => {
    const put = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: { ...authed, "Content-Type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(put.status).toBe(200);
    const etag = put.headers.get("ETag");
    expect(etag).toBeTruthy();

    const get = await SELF.fetch(`${BASE}/v1/index`, { headers: authed });
    expect(get.status).toBe(200);
    expect(get.headers.get("ETag")).toBe(etag);
    const body = new Uint8Array(await get.arrayBuffer());
    expect([...body]).toEqual([1, 2, 3, 4]);
  });

  it("GET /v1/index with matching If-None-Match returns 304", async () => {
    const put = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: authed,
      body: new Uint8Array([9, 9]),
    });
    const etag = put.headers.get("ETag")!;
    const conditional = await SELF.fetch(`${BASE}/v1/index`, {
      headers: { ...authed, "If-None-Match": etag },
    });
    expect(conditional.status).toBe(304);
  });

  it("PUT /v1/index with wrong If-Match returns 412", async () => {
    const put1 = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: authed,
      body: new Uint8Array([1]),
    });
    expect(put1.status).toBe(200);

    const put2 = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: { ...authed, "If-Match": "\"not-the-real-etag\"" },
      body: new Uint8Array([2]),
    });
    expect(put2.status).toBe(412);
  });

  it("PUT /v1/index with If-None-Match: * creates a new index on empty bucket", async () => {
    const res = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: { ...authed, "If-None-Match": "*" },
      body: new Uint8Array([1, 2]),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBeTruthy();
  });

  it("PUT /v1/index with If-None-Match: * returns 412 when index already exists", async () => {
    await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: authed,
      body: new Uint8Array([1]),
    });
    const res = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: { ...authed, "If-None-Match": "*" },
      body: new Uint8Array([2]),
    });
    expect(res.status).toBe(412);
  });

  it("authenticated responses carry CORS headers", async () => {
    const put = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: authed,
      body: new Uint8Array([1]),
    });
    expect(put.headers.get("Access-Control-Allow-Origin")).toBe(env.PWA_ORIGIN);
    expect(put.headers.get("Access-Control-Expose-Headers")).toContain("ETag");
  });

  it("PUT /v1/index with correct If-Match returns 200 and new ETag", async () => {
    const put1 = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: authed,
      body: new Uint8Array([1]),
    });
    const etag1 = put1.headers.get("ETag")!;

    const put2 = await SELF.fetch(`${BASE}/v1/index`, {
      method: "PUT",
      headers: { ...authed, "If-Match": etag1 },
      body: new Uint8Array([2]),
    });
    expect(put2.status).toBe(200);
    expect(put2.headers.get("ETag")).toBeTruthy();
    expect(put2.headers.get("ETag")).not.toBe(etag1);
  });
});

describe("messages", () => {
  beforeEach(async () => {
    await seedDevices(["nts_alpha"]);
  });

  const authed = { Authorization: "Bearer nts_alpha" };

  it("rejects ids that do not match the format (400)", async () => {
    const res = await SELF.fetch(`${BASE}/v1/messages/bad-id`, {
      method: "PUT",
      headers: authed,
      body: new Uint8Array([1]),
    });
    expect(res.status).toBe(400);
  });

  it("PUT then GET returns the same bytes", async () => {
    const put = await SELF.fetch(`${BASE}/v1/messages/${VALID_ID}`, {
      method: "PUT",
      headers: authed,
      body: new Uint8Array([7, 8, 9]),
    });
    expect(put.status).toBe(200);

    const get = await SELF.fetch(`${BASE}/v1/messages/${VALID_ID}`, {
      headers: authed,
    });
    expect(get.status).toBe(200);
    const body = new Uint8Array(await get.arrayBuffer());
    expect([...body]).toEqual([7, 8, 9]);
  });

  it("GET on a missing id returns 404", async () => {
    const res = await SELF.fetch(`${BASE}/v1/messages/${VALID_ID}`, {
      headers: authed,
    });
    expect(res.status).toBe(404);
  });

  it("DELETE removes the message and subsequent GET returns 404", async () => {
    await SELF.fetch(`${BASE}/v1/messages/${VALID_ID}`, {
      method: "PUT",
      headers: authed,
      body: new Uint8Array([1]),
    });
    const del = await SELF.fetch(`${BASE}/v1/messages/${VALID_ID}`, {
      method: "DELETE",
      headers: authed,
    });
    expect(del.status).toBe(204);

    const get = await SELF.fetch(`${BASE}/v1/messages/${VALID_ID}`, {
      headers: authed,
    });
    expect(get.status).toBe(404);
  });
});

describe("not found", () => {
  beforeEach(async () => {
    await seedDevices(["nts_alpha"]);
  });

  it("unknown path returns 404", async () => {
    const res = await SELF.fetch(`${BASE}/v1/unknown`, {
      headers: { Authorization: "Bearer nts_alpha" },
    });
    expect(res.status).toBe(404);
  });
});

describe("/v1/notify proxy", () => {
  beforeEach(async () => {
    await seedDevices(["nts_alpha"]);
  });

  it("rejects requests without auth (401)", async () => {
    const res = await SELF.fetch(`${BASE}/v1/notify`, {
      method: "POST",
      body: JSON.stringify({ server: "https://ntfy.sh", topic: "t", body: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid JSON (400)", async () => {
    const res = await SELF.fetch(`${BASE}/v1/notify`, {
      method: "POST",
      headers: { Authorization: "Bearer nts_alpha" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing server (400)", async () => {
    const res = await SELF.fetch(`${BASE}/v1/notify`, {
      method: "POST",
      headers: { Authorization: "Bearer nts_alpha" },
      body: JSON.stringify({ topic: "t", body: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-http server scheme (400)", async () => {
    const res = await SELF.fetch(`${BASE}/v1/notify`, {
      method: "POST",
      headers: { Authorization: "Bearer nts_alpha" },
      body: JSON.stringify({ server: "ftp://evil.example", topic: "t", body: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing topic (400)", async () => {
    const res = await SELF.fetch(`${BASE}/v1/notify`, {
      method: "POST",
      headers: { Authorization: "Bearer nts_alpha" },
      body: JSON.stringify({ server: "https://ntfy.sh", body: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing body (400)", async () => {
    const res = await SELF.fetch(`${BASE}/v1/notify`, {
      method: "POST",
      headers: { Authorization: "Bearer nts_alpha" },
      body: JSON.stringify({ server: "https://ntfy.sh", topic: "t" }),
    });
    expect(res.status).toBe(400);
  });

  it("forwards POST to upstream and returns 200 on success", async () => {
    const upstream = { url: "", method: "", headers: {} as Record<string, string>, body: "" };
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      upstream.url = typeof input === "string" ? input : (input as Request).url;
      upstream.method = init?.method ?? "GET";
      upstream.headers = Object.fromEntries(new Headers(init?.headers).entries());
      upstream.body = (init?.body as string) ?? "";
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const res = await SELF.fetch(`${BASE}/v1/notify`, {
        method: "POST",
        headers: { Authorization: "Bearer nts_alpha" },
        body: JSON.stringify({
          server: "https://ntfy.sh",
          topic: "nts-test-topic",
          title: "Note to Self",
          priority: "3",
          body: "you have a new note.",
        }),
      });
      expect(res.status).toBe(200);
      expect(upstream.url).toBe("https://ntfy.sh/nts-test-topic");
      expect(upstream.method).toBe("POST");
      expect(upstream.headers["x-title"]).toBe("Note to Self");
      expect(upstream.headers["x-priority"]).toBe("3");
      expect(upstream.body).toBe("you have a new note.");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("passes through optional token as Bearer auth to upstream", async () => {
    let seenAuth = "";
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo, init?: RequestInit) => {
      seenAuth = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const res = await SELF.fetch(`${BASE}/v1/notify`, {
        method: "POST",
        headers: { Authorization: "Bearer nts_alpha" },
        body: JSON.stringify({
          server: "https://ntfy.sh",
          topic: "t",
          body: "x",
          token: "tk_upstream",
        }),
      });
      expect(res.status).toBe(200);
      expect(seenAuth).toBe("Bearer tk_upstream");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns upstream non-2xx status verbatim", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
    try {
      const res = await SELF.fetch(`${BASE}/v1/notify`, {
        method: "POST",
        headers: { Authorization: "Bearer nts_alpha" },
        body: JSON.stringify({ server: "https://ntfy.sh", topic: "t", body: "x" }),
      });
      expect(res.status).toBe(429);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns 502 when upstream fetch throws", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network unreachable"); }) as typeof fetch;
    try {
      const res = await SELF.fetch(`${BASE}/v1/notify`, {
        method: "POST",
        headers: { Authorization: "Bearer nts_alpha" },
        body: JSON.stringify({ server: "https://ntfy.sh", topic: "t", body: "x" }),
      });
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = original;
    }
  });
});
