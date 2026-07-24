import type { Env as WorkerEnv } from "../src/index";

declare module "cloudflare:test" {
  interface ProvidedEnv extends WorkerEnv {}
}

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {};
