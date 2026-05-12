export interface Env {
  BUCKET: R2Bucket;
  DEVICES_CACHE_TTL_SECONDS: string;
  PWA_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/v1/health") {
      return new Response("ok", { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  },
};
