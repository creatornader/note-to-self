import { defineConfig, devices } from "@playwright/test";

// Runs the production-build preview server and drives Chromium against it.
// `vite preview` is preferred over `vite` for e2e: it serves the actual
// `dist/` output, which means the bundle path the e2e exercises is the same
// shape the Pages deploy serves.
export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 30_000,
  webServer: {
    command: "npm run build && npm run preview -- --port 5174 --strictPort",
    port: 5174,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
