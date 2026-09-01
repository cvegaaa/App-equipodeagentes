import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // __dirname, no import.meta.url: package.json no lleva "type": "module" (excepción de
    // knowledge/runtime-tracks/ts-node.md para apps Next.js), así que bajo module: "nodenext" este
    // archivo .ts compila como CommonJS — import.meta no está permitido ahí (TS1470).
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: [
      "src/**/*.test.ts",
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/eval/**/*.ts",
    ],
    exclude: ["blueprints/**", "node_modules/**", "tests/e2e/**"],
    setupFiles: ["./tests/helpers/setup-env.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
