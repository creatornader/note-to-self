// Bearer-auth HTTP client for the Cloudflare Worker R2 proxy.
//
// Every request carries `Authorization: Bearer <token>`. The Worker validates
// the token against `devices.json` (see web/worker/src/index.ts) and either
// proxies the request to R2 or returns 401/403.
//
// ETag passthrough is the decision-critical detail: the Worker is the only writer
// to R2, so the only way two PWA instances stay coherent is by surfacing R2's
// ETag in the response and accepting it back as `If-Match` / `If-None-Match`.
// This client treats etags as opaque strings.

export interface IndexGetResponse {
  status: number;
  body: Uint8Array | null;
  etag: string | null;
}

export interface IndexPutResponse {
  status: number;
  etag: string | null;
}

export interface MessageGetResponse {
  status: number;
  body: Uint8Array | null;
}

export interface MessageMutateResponse {
  status: number;
}

export interface NotifyRequest {
  server: string;
  topic: string;
  body: string;
  title?: string;
  priority?: string;
  token?: string;
  click?: string;
}

export interface NotifyResponse {
  status: number;
}

export interface HttpClient {
  getIndex(etag: string | null): Promise<IndexGetResponse>;
  putIndex(ciphertext: Uint8Array, ifMatch: string | null): Promise<IndexPutResponse>;
  getMessage(id: string): Promise<MessageGetResponse>;
  putMessage(id: string, ciphertext: Uint8Array): Promise<MessageMutateResponse>;
  deleteMessage(id: string): Promise<MessageMutateResponse>;
  notify(payload: NotifyRequest): Promise<NotifyResponse>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array | ArrayBuffer | string;
  },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get: (name: string) => string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

export interface HttpClientOptions {
  fetchImpl?: FetchLike;
}

// Make an HTTP client bound to a base URL and bearer token. `fetchImpl` is
// injectable so tests can supply a stub without touching globals.
export function makeHttp(
  baseUrl: string,
  bearerToken: string,
  options: HttpClientOptions = {},
): HttpClient {
  const fetchImpl: FetchLike =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const base = baseUrl.replace(/\/$/, "");
  const auth = (): Record<string, string> => ({
    Authorization: `Bearer ${bearerToken}`,
  });

  return {
    async getIndex(etag) {
      const headers: Record<string, string> = auth();
      if (etag) headers["If-None-Match"] = etag;
      const r = await fetchImpl(`${base}/v1/index`, { headers });
      if (r.status === 304) return { status: 304, body: null, etag };
      if (!r.ok) return { status: r.status, body: null, etag: null };
      const buf = await r.arrayBuffer();
      return {
        status: r.status,
        body: new Uint8Array(buf),
        etag: r.headers.get("etag"),
      };
    },

    async putIndex(ciphertext, ifMatch) {
      const headers: Record<string, string> = {
        ...auth(),
        "Content-Type": "application/octet-stream",
      };
      if (ifMatch) headers["If-Match"] = ifMatch;
      else headers["If-None-Match"] = "*";
      const r = await fetchImpl(`${base}/v1/index`, {
        method: "PUT",
        headers,
        body: ciphertext,
      });
      return { status: r.status, etag: r.headers.get("etag") };
    },

    async getMessage(id) {
      const r = await fetchImpl(`${base}/v1/messages/${id}`, {
        headers: auth(),
      });
      if (!r.ok) return { status: r.status, body: null };
      const buf = await r.arrayBuffer();
      return { status: r.status, body: new Uint8Array(buf) };
    },

    async putMessage(id, ciphertext) {
      const r = await fetchImpl(`${base}/v1/messages/${id}`, {
        method: "PUT",
        headers: {
          ...auth(),
          "Content-Type": "application/octet-stream",
        },
        body: ciphertext,
      });
      return { status: r.status };
    },

    async deleteMessage(id) {
      const r = await fetchImpl(`${base}/v1/messages/${id}`, {
        method: "DELETE",
        headers: auth(),
      });
      return { status: r.status };
    },

    async notify(payload) {
      // The PWA's CSP forbids direct connections to ntfy.sh, so push goes
      // through the Worker. The Worker reads server/topic from the body and
      // relays. Status passthrough means caller still sees rate-limit /
      // network errors from upstream.
      const r = await fetchImpl(`${base}/v1/notify`, {
        method: "POST",
        headers: {
          ...auth(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      return { status: r.status };
    },
  };
}
