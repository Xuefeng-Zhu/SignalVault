import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      // `import "server-only"` throws at import time (it is a Next.js build-time
      // marker), which would make any server-only adapter module unimportable
      // under vitest's node/jsdom runtime. Map it to a local no-op stub so
      // server-only modules can be imported and
      // unit/property-tested directly. This does not relax the production guard:
      // Next.js still resolves the real throwing `server-only` module.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    // jsdom enables @testing-library/react component tests.
    environment: "jsdom",
    globals: true,
    // Shared setup: jest-dom matchers + global fast-check config (min 100 iterations).
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.{test,spec}.{ts,tsx}", "**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist"],
  },
});
