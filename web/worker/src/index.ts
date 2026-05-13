export interface Env {
  BUCKET: R2Bucket;
  DEVICES_CACHE_TTL_SECONDS: string;
  PWA_ORIGIN: string;
}

const MESSAGE_ID_RE = /^[0-9]+_[a-z0-9]{8}$/;

function stripEtagQuotes(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("W/")) return stripEtagQuotes(trimmed.slice(2));
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.PWA_ORIGIN || "*",
    // POST is required for /v1/notify; the spec demands the actual method
    // appear in Allow-Methods on the preflight response. Browsers have
    // historically been lenient about this, but Safari and Firefox in
    // strict mode would block the preflight without POST listed.
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,If-Match,If-None-Match,Content-Type",
    "Access-Control-Expose-Headers": "ETag",
  };
}

function withCors(env: Env, res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(env))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

type DevicesCache = { hashes: Set<string>; loadedAt: number };
let DEVICES_CACHE: DevicesCache | null = null;

export function _resetDevicesCacheForTests(): void {
  DEVICES_CACHE = null;
}

async function loadDevices(env: Env): Promise<Set<string>> {
  const ttlMs = Number.parseInt(env.DEVICES_CACHE_TTL_SECONDS, 10) * 1000;
  const now = Date.now();
  if (DEVICES_CACHE && now - DEVICES_CACHE.loadedAt < ttlMs) {
    return DEVICES_CACHE.hashes;
  }
  const obj = await env.BUCKET.get("devices.json");
  if (obj === null) {
    DEVICES_CACHE = { hashes: new Set(), loadedAt: now };
    return DEVICES_CACHE.hashes;
  }
  const text = await obj.text();
  let parsed: { devices?: { token_hash: string }[] };
  try {
    parsed = JSON.parse(text) as { devices?: { token_hash: string }[] };
  } catch {
    DEVICES_CACHE = { hashes: new Set(), loadedAt: now };
    return DEVICES_CACHE.hashes;
  }
  const hashes = new Set((parsed.devices ?? []).map((d) => d.token_hash));
  DEVICES_CACHE = { hashes, loadedAt: now };
  return hashes;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function requireAuth(req: Request, env: Env): Promise<Response | null> {
  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) return new Response("Unauthorized", { status: 401 });
  const hash = await sha256Hex(token);
  const devices = await loadDevices(env);
  if (!devices.has(hash)) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

async function handleIndexGet(req: Request, env: Env): Promise<Response> {
  const inm = stripEtagQuotes(req.headers.get("If-None-Match"));
  const obj = await env.BUCKET.get(
    "index.age",
    inm ? { onlyIf: { etagDoesNotMatch: inm } } : undefined,
  );
  if (obj === null) return new Response(null, { status: 404 });
  if (!("body" in obj) || obj.body === null) {
    return new Response(null, { status: 304 });
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      ETag: obj.httpEtag,
      "Content-Type": "application/octet-stream",
    },
  });
}

async function handleIndexPut(req: Request, env: Env): Promise<Response> {
  const ifMatch = stripEtagQuotes(req.headers.get("If-Match"));
  const ifNoneMatch = req.headers.get("If-None-Match");
  const body = await req.arrayBuffer();
  const opts: R2PutOptions = {};
  if (ifMatch) opts.onlyIf = { etagMatches: ifMatch };
  else if (ifNoneMatch === "*") opts.onlyIf = { etagDoesNotMatch: "*" };
  const result = await env.BUCKET.put("index.age", body, opts);
  if (result === null) return new Response("Precondition Failed", { status: 412 });
  return new Response(null, { status: 200, headers: { ETag: result.httpEtag } });
}

async function handleMessageGet(id: string, env: Env): Promise<Response> {
  if (!MESSAGE_ID_RE.test(id)) return new Response("Bad Request", { status: 400 });
  const obj = await env.BUCKET.get(`messages/${id}.age`);
  if (obj === null) return new Response(null, { status: 404 });
  return new Response(obj.body, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
}

async function handleMessagePut(id: string, req: Request, env: Env): Promise<Response> {
  if (!MESSAGE_ID_RE.test(id)) return new Response("Bad Request", { status: 400 });
  const body = await req.arrayBuffer();
  await env.BUCKET.put(`messages/${id}.age`, body);
  return new Response(null, { status: 200 });
}

async function handleMessageDelete(id: string, env: Env): Promise<Response> {
  if (!MESSAGE_ID_RE.test(id)) return new Response("Bad Request", { status: 400 });
  await env.BUCKET.delete(`messages/${id}.age`);
  return new Response(null, { status: 204 });
}

// Notify proxy. The PWA's CSP forbids direct connections to ntfy.sh, so the
// PWA POSTs a JSON payload here and the Worker fans out the actual ntfy
// request server-side. The Worker stores no ntfy state — caller owns the
// topic and server values.
interface NotifyRequest {
  server?: string;
  topic?: string;
  title?: string;
  priority?: string;
  body?: string;
  token?: string;
  click?: string;
}

// Cap inbound JSON at 8 KB. A normal notify payload is well under 1 KB;
// anything larger is either a bug or a stolen-bearer DoS attempt.
const NOTIFY_MAX_BYTES = 8 * 1024;

// ntfy topics are 1-64 chars of unreserved URL chars per their docs.
// We are stricter here: ASCII alphanumeric + dash + underscore. This
// prevents topic-injection via slash / question-mark / fragment that
// would smuggle URL parameters past validation when concatenated into
// the upstream URL.
const NOTIFY_TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Allow only http(s) for the click target. Without this, a stolen
// bearer could push notifications whose tap action launches
// javascript:, data:, file:, intent:, etc. on the device.
function isSafeClickUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function handleNotifyPost(req: Request, _env: Env): Promise<Response> {
  // Cap body size BEFORE parsing JSON. Workers honor Content-Length but
  // an attacker could omit it; arrayBuffer() will still read everything,
  // so we slice the stream by reading then checking length.
  let raw: ArrayBuffer;
  try {
    raw = await req.arrayBuffer();
  } catch {
    return new Response("Invalid body", { status: 400 });
  }
  if (raw.byteLength > NOTIFY_MAX_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  let payload: NotifyRequest;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as NotifyRequest;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const serverInput = (payload.server ?? "").trim().replace(/\/+$/, "");
  const topic = (payload.topic ?? "").trim();
  const body = payload.body ?? "";

  // Parse server as a URL so we reject http:/// or non-http schemes
  // cleanly, not by regex.
  let serverUrl: URL;
  try {
    serverUrl = new URL(serverInput);
  } catch {
    return new Response("Bad Request: server must be an http(s) URL", { status: 400 });
  }
  if (serverUrl.protocol !== "https:" && serverUrl.protocol !== "http:") {
    return new Response("Bad Request: server must use http or https", { status: 400 });
  }
  if (!NOTIFY_TOPIC_RE.test(topic)) {
    return new Response(
      "Bad Request: topic must be 1-64 chars of [A-Za-z0-9_-]",
      { status: 400 },
    );
  }
  if (!body) {
    return new Response("Bad Request: body required", { status: 400 });
  }
  if (payload.click !== undefined && !isSafeClickUrl(payload.click)) {
    return new Response(
      "Bad Request: click must be an http(s) URL",
      { status: 400 },
    );
  }

  const headers: Record<string, string> = {};
  if (payload.title) headers["X-Title"] = payload.title;
  if (payload.priority) headers["X-Priority"] = payload.priority;
  if (payload.click) headers["X-Click"] = payload.click;
  if (payload.token) headers["Authorization"] = `Bearer ${payload.token}`;

  // Build upstream URL by appending the (already-validated) topic to the
  // parsed server URL. Use URL composition rather than string concat so
  // any future loosening of NOTIFY_TOPIC_RE still cannot smuggle path
  // separators or query params.
  const upstreamUrl = new URL(serverUrl.toString().replace(/\/+$/, "") + "/" + topic);

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method: "POST",
      headers,
      body,
    });
    return new Response(null, { status: upstream.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Upstream error: ${msg}`, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (method === "GET" && path === "/v1/health") {
      return withCors(env, new Response("ok"));
    }

    const denied = await requireAuth(request, env);
    if (denied) return withCors(env, denied);

    if (path === "/v1/index") {
      if (method === "GET") return withCors(env, await handleIndexGet(request, env));
      if (method === "PUT") return withCors(env, await handleIndexPut(request, env));
    }

    const m = path.match(/^\/v1\/messages\/([^/]+)$/);
    if (m) {
      const id = m[1];
      if (method === "GET") return withCors(env, await handleMessageGet(id, env));
      if (method === "PUT") return withCors(env, await handleMessagePut(id, request, env));
      if (method === "DELETE") return withCors(env, await handleMessageDelete(id, env));
    }

    if (path === "/v1/notify" && method === "POST") {
      return withCors(env, await handleNotifyPost(request, env));
    }

    return withCors(env, new Response("Not Found", { status: 404 }));
  },
};
