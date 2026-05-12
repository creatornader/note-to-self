import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  build: { target: "es2022", sourcemap: true },
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "worker"],
  },
});
