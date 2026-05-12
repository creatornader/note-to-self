export interface Env {
  BUCKET: R2Bucket;
  DEVICES_CACHE_TTL_SECONDS: string;
  PWA_ORIGIN: string;
}

const MESSAGE_ID_RE = /^[0-9]+_[a-z0-9]{8}$/;

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.PWA_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
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
  const inm = req.headers.get("If-None-Match");
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
  const ifMatch = req.headers.get("If-Match");
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

    return withCors(env, new Response("Not Found", { status: 404 }));
  },
};
