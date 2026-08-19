import { defineConfig, coverageConfigDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirror tsconfig's "@/*" -> "./*" so tests can import via "@/lib/...".
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // Default to fast Node env; component tests opt into jsdom via a `// @vitest-environment jsdom`
    // docblock at the top of the file.
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // e2e/ holds Playwright specs (run via `npm run test:e2e`), not Vitest.
    exclude: ["node_modules", ".next", "e2e"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      // Measure coverage (npm run test:coverage) but DON'T enforce a global threshold yet — app-wide
      // coverage is still low, so a hard gate would fail the build. Raise it as coverage grows.
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "components/**/*.{ts,tsx}"],
      // Keep Vitest's built-in excludes (configs, dist, etc.) and drop all test/type-decl files —
      // both .test.ts and .test.tsx — so test code isn't measured as source.
      exclude: [...coverageConfigDefaults.exclude, "**/*.test.ts", "**/*.test.tsx", "**/*.d.ts"],
    },
  },
});
