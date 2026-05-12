/// <reference lib="webworker" />
//
// Minimal Service Worker for M4a: precache the app shell so the PWA opens
// offline. The encrypted data path (R2 via the Worker) is intentionally NOT
// intercepted — those requests need real network and bearer auth.
//
// Offline mutation queues, background ntfy SSE, and Web Push are deferred to
// M4b. See docs/superpowers/specs/2026-05-11-milestone4-pwa-design.md.

import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// __WB_MANIFEST is injected at build time by vite-plugin-pwa's injectManifest
// strategy. It enumerates every static asset Vite emitted, hashed.
precacheAndRoute(self.__WB_MANIFEST);

// Activate immediately. Without this the first navigation after install still
// hits the network because the previous (or no) SW controls the page.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Skip waiting on install so a fresh deploy takes effect on the next reload
// without an explicit user action.
self.addEventListener("install", () => {
  self.skipWaiting();
});
