import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false,
      strategies: "injectManifest",
      srcDir: "src",
      filename: "service-worker.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
      },
      // Disable in dev/test so jsdom doesn't try to register a SW.
      devOptions: { enabled: false },
    }),
  ],
  build: { target: "es2022", sourcemap: true },
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "worker"],
  },
});
