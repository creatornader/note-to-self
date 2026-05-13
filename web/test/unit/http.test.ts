import { describe, expect, it } from "vitest";
import { makeHttp, type FetchLike } from "../../src/core/http";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | string | undefined;
}

interface StubResponse {
  status: number;
  body?: Uint8Array;
  etag?: string | null;
}

function mockFetch(
  responder: (req: RecordedRequest) => StubResponse,
): { fetchImpl: FetchLike; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const rawBody = init?.body;
    const req: RecordedRequest = {
      url: input,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body:
        typeof rawBody === "string"
          ? rawBody
          : rawBody instanceof Uint8Array
            ? rawBody
            : rawBody
              ? new Uint8Array(rawBody as ArrayBuffer)
              : undefined,
    };
    calls.push(req);
    const stub = responder(req);
    const body = stub.body ?? new Uint8Array(0);
    return {
      status: stub.status,
      ok: stub.status >= 200 && stub.status < 300,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "etag") return stub.etag ?? null;
          return null;
        },
      },
      arrayBuffer: async () =>
        body.buffer.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength,
        ) as ArrayBuffer,
    };
  };
  return { fetchImpl, calls };
}

const BASE = "https://worker.example.workers.dev";
const TOKEN = "nts_test_token";

describe("getIndex", () => {
  it("sends Authorization bearer and no If-None-Match on cold start", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 200,
      body: new Uint8Array([1, 2, 3]),
      etag: "\"abc\"",
    }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.getIndex(null);
    expect(r.status).toBe(200);
    expect(r.body && [...r.body]).toEqual([1, 2, 3]);
    expect(r.etag).toBe("\"abc\"");
    expect(calls[0].url).toBe(`${BASE}/v1/index`);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].headers["If-None-Match"]).toBeUndefined();
  });

  it("forwards If-None-Match when a cached etag exists", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 304 }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.getIndex("\"abc\"");
    expect(r.status).toBe(304);
    expect(r.body).toBeNull();
    expect(r.etag).toBe("\"abc\"");
    expect(calls[0].headers["If-None-Match"]).toBe("\"abc\"");
  });

  it("returns status with null body for 4xx/5xx", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 403 }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.getIndex(null);
    expect(r.status).toBe(403);
    expect(r.body).toBeNull();
  });
});

describe("putIndex", () => {
  it("sends If-None-Match: * on first push when no etag", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 200,
      etag: "\"new\"",
    }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.putIndex(new Uint8Array([9]), null);
    expect(r.status).toBe(200);
    expect(r.etag).toBe("\"new\"");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].headers["If-None-Match"]).toBe("*");
    expect(calls[0].headers["If-Match"]).toBeUndefined();
    expect(calls[0].headers["Content-Type"]).toBe("application/octet-stream");
    expect(calls[0].body && [...calls[0].body]).toEqual([9]);
  });

  it("sends If-Match when an etag is provided", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 200,
      etag: "\"next\"",
    }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.putIndex(new Uint8Array([1]), "\"prev\"");
    expect(r.status).toBe(200);
    expect(calls[0].headers["If-Match"]).toBe("\"prev\"");
    expect(calls[0].headers["If-None-Match"]).toBeUndefined();
  });

  it("surfaces 412 verbatim (no retry at this layer)", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 412 }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.putIndex(new Uint8Array([1]), "\"stale\"");
    expect(r.status).toBe(412);
  });
});

describe("messages", () => {
  it("GET returns the body and 200", async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 200,
      body: new Uint8Array([7, 7, 7]),
    }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.getMessage("1234567890_abcd1234");
    expect(r.status).toBe(200);
    expect(r.body && [...r.body]).toEqual([7, 7, 7]);
  });

  it("GET on 404 returns null body", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 404 }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.getMessage("1234567890_abcd1234");
    expect(r.status).toBe(404);
    expect(r.body).toBeNull();
  });

  it("PUT sends bytes with bearer and content-type", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 200 }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.putMessage("1234567890_abcd1234", new Uint8Array([5]));
    expect(r.status).toBe(200);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe(`${BASE}/v1/messages/1234567890_abcd1234`);
    expect(calls[0].body && [...calls[0].body]).toEqual([5]);
    expect(calls[0].headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("DELETE issues DELETE method with bearer", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 204 }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.deleteMessage("1234567890_abcd1234");
    expect(r.status).toBe(204);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe("base url normalization", () => {
  it("strips a trailing slash from baseUrl", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 200 }));
    const http = makeHttp(`${BASE}/`, TOKEN, { fetchImpl });
    await http.getIndex(null);
    expect(calls[0].url).toBe(`${BASE}/v1/index`);
  });
});

describe("notify", () => {
  const BASE = "https://worker.example";
  const TOKEN = "nts_alpha";

  it("POSTs JSON payload to /v1/notify with bearer auth", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 200 }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.notify({
      server: "https://ntfy.sh",
      topic: "nts-test",
      title: "Note to Self",
      priority: "3",
      body: "you have a new note.",
    });
    expect(r.status).toBe(200);
    expect(calls[0].url).toBe(`${BASE}/v1/notify`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    const parsed = JSON.parse(calls[0].body as string);
    expect(parsed.server).toBe("https://ntfy.sh");
    expect(parsed.topic).toBe("nts-test");
    expect(parsed.title).toBe("Note to Self");
    expect(parsed.priority).toBe("3");
    expect(parsed.body).toBe("you have a new note.");
  });

  it("includes upstream token in payload when provided", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 200 }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    await http.notify({
      server: "https://ntfy.sh",
      topic: "t",
      body: "x",
      token: "tk_upstream",
    });
    const parsed = JSON.parse(calls[0].body as string);
    expect(parsed.token).toBe("tk_upstream");
  });

  it("propagates upstream non-2xx status to the caller", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 429 }));
    const http = makeHttp(BASE, TOKEN, { fetchImpl });
    const r = await http.notify({
      server: "https://ntfy.sh",
      topic: "t",
      body: "x",
    });
    expect(r.status).toBe(429);
  });
});
