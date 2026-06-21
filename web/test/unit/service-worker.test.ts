// These tests verify the SW source declares the right Workbox primitives and
// only intercepts the app shell — never the encrypted data path. The SW
// itself runs in a Worker context that jsdom does not provide, so we lint the
// source string rather than execute it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SW_PATH = resolve(process.cwd(), "src/service-worker.ts");
const SW_SOURCE = readFileSync(SW_PATH, "utf-8");

describe("service worker source", () => {
  it("imports precacheAndRoute from workbox-precaching", () => {
    expect(SW_SOURCE).toContain('from "workbox-precaching"');
    expect(SW_SOURCE).toContain("precacheAndRoute");
  });

  it("registers precacheAndRoute against self.__WB_MANIFEST", () => {
    expect(SW_SOURCE).toMatch(/precacheAndRoute\(self\.__WB_MANIFEST\)/);
  });

  it("activates with clients.claim() so first navigation is controlled", () => {
    expect(SW_SOURCE).toMatch(/clients\.claim\(\)/);
  });

  it("skip-waits on install so a new deploy takes effect on next reload", () => {
    expect(SW_SOURCE).toMatch(/skipWaiting\(\)/);
  });

  it("never intercepts the /v1/ data path (deferred to M4b)", () => {
    expect(SW_SOURCE).not.toMatch(/\/v1\//);
    expect(SW_SOURCE).not.toMatch(/registerRoute|workbox-routing/);
  });

  it("does not import workbox-strategies (no runtime caching in M4a)", () => {
    expect(SW_SOURCE).not.toContain("workbox-strategies");
  });
});

describe("vite-plugin-pwa wiring", () => {
  const viteConfig = readFileSync(
    resolve(process.cwd(), "vite.config.ts"),
    "utf-8",
  );

  it("uses injectManifest strategy", () => {
    expect(viteConfig).toContain('strategies: "injectManifest"');
  });

  it("points srcDir+filename at src/service-worker.ts", () => {
    expect(viteConfig).toContain('srcDir: "src"');
    expect(viteConfig).toContain('filename: "service-worker.ts"');
  });

  it("builds the service worker as iife", () => {
    expect(viteConfig).toContain('rollupFormat: "iife"');
  });

  it("disables SW registration in dev/test (devOptions.enabled false)", () => {
    expect(viteConfig).toMatch(/devOptions:\s*{\s*enabled:\s*false\s*}/);
  });

  it("manifest field is false (the index.html links manifest.webmanifest directly)", () => {
    expect(viteConfig).toMatch(/manifest:\s*false/);
  });
});
