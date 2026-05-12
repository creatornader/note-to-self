// End-to-end walkthrough: paste-bundle import → unlock → inbox → compose.
//
// Scope (M4a smaller-version per the plan): no real Worker, no real CLI.
// The Worker is stubbed via page.route() — every /v1/index call returns 404
// initially, /v1/messages PUT returns 200, the index PUT returns 200 with an
// opaque ETag. This validates the PWA's UX path end-to-end against the
// bundled production assets (vite preview), which is what's actually shipped.
//
// The cross-process round-trip (real wrangler dev + real CLI) is deferred to
// the M4a deployment step where actual Cloudflare credentials exist.

import { expect, test } from "@playwright/test";
import {
  FIXTURE_BUNDLE,
  FIXTURE_TOKEN,
  WORKER_ORIGIN,
} from "./fixtures/bundle";

test.beforeEach(async ({ page, context }) => {
  // Stub the Worker. The PWA points at worker.e2e (see fixtures/bundle.ts).
  // Every authenticated route returns deterministic empty-state responses.
  await context.route(`${WORKER_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/v1/health") {
      return route.fulfill({ status: 200, body: "ok" });
    }
    if (url.pathname === "/v1/index" && method === "GET") {
      return route.fulfill({ status: 404, body: "" });
    }
    if (url.pathname === "/v1/index" && method === "PUT") {
      return route.fulfill({
        status: 200,
        headers: { ETag: '"e2e-etag"' },
      });
    }
    if (url.pathname.startsWith("/v1/messages/")) {
      if (method === "PUT") return route.fulfill({ status: 200 });
      if (method === "GET") return route.fulfill({ status: 404 });
      if (method === "DELETE") return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404 });
  });

  // Clear any prior session state. fake-indexeddb does not run in real
  // browsers, so deletion is via the IndexedDB API exposed in the page.
  await page.goto("/");
  await page.evaluate(async () => {
    if (typeof indexedDB === "undefined") return;
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("nts-store");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
});

test("import → unlock → inbox → compose round-trip", async ({ page }) => {
  // 1. Cold start lands at the unlock screen, which immediately redirects to
  //    /import when no wrapped identity is in IDB.
  await page.goto("/");
  await expect(page).toHaveURL(/\/import$/);

  // 2. Import the fixture bundle with a fresh device passphrase.
  const bundleJson = JSON.stringify(FIXTURE_BUNDLE);
  await page.getByPlaceholder('{"v": 1, "identity": "AGE-SECRET-KEY-...", ...}').fill(bundleJson);
  await page.getByPlaceholder("nts_…").fill(FIXTURE_TOKEN);
  await page.locator('input[autocomplete="new-password"]').first().fill("device-pass");
  await page.locator('input[autocomplete="new-password"]').nth(1).fill("device-pass");

  await page.getByRole("button", { name: /Import \+ unlock/ }).click();

  // 3. After import + auto-unlock the PWA lands at the inbox. With no
  //    messages, the empty-state CTA shows.
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByText("No messages yet")).toBeVisible();

  // 4. Compose a new message.
  await page.getByRole("button", { name: "Compose your first" }).click();
  await expect(page).toHaveURL(/\/compose$/);

  await page.getByPlaceholder("A note to your future self…").fill(
    "first e2e note",
  );
  await page.getByPlaceholder("todo, idea, reminder").fill("e2e, demo");
  await page.getByRole("button", { name: "Send" }).click();

  // 5. Back at the inbox: the new entry is rendered with its preview and tags.
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByText("first e2e note")).toBeVisible();
  await expect(page.getByText("#e2e")).toBeVisible();
  await expect(page.getByText("#demo")).toBeVisible();
});

test("re-load after import lands at unlock, not import", async ({ page }) => {
  // Run the import once.
  await page.goto("/");
  const bundleJson = JSON.stringify(FIXTURE_BUNDLE);
  await page.getByPlaceholder('{"v": 1, "identity": "AGE-SECRET-KEY-...", ...}').fill(bundleJson);
  await page.getByPlaceholder("nts_…").fill(FIXTURE_TOKEN);
  await page.locator('input[autocomplete="new-password"]').first().fill("device-pass");
  await page.locator('input[autocomplete="new-password"]').nth(1).fill("device-pass");
  await page.getByRole("button", { name: /Import \+ unlock/ }).click();
  await expect(page).toHaveURL(/\/inbox$/);

  // Hard-reload. The session is in-memory only; reload should land at unlock,
  // not bounce to /import again, because the wrapped identity is persisted.
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Unlock/ })).toBeVisible();
  await page.locator('input[type="password"]').fill("device-pass");
  await page.getByRole("button", { name: /Unlock/ }).click();
  await expect(page).toHaveURL(/\/inbox$/);
});
