import { defineConfig, configDefaults, coverageConfigDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { GENERATED_DIRS } from "./scripts/generated-dirs.mjs";

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
    // Vitest's own defaults (node_modules and .git at any depth), the root-level generated-output list
    // shared with ESLint and the boundary test, and e2e/ (Playwright specs, run via `npm run test:e2e`).
    exclude: [...configDefaults.exclude, ...GENERATED_DIRS.map((dir) => `${dir}/**`), "e2e/**"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "components/**/*.{ts,tsx}"],
      // Keep Vitest's built-in excludes (configs, dist, etc.) and drop all test/type-decl files —
      // both .test.ts and .test.tsx — so test code isn't measured as source.
      exclude: [...coverageConfigDefaults.exclude, "**/*.test.ts", "**/*.test.tsx", "**/*.d.ts"],
      // Coverage floor = today's measured numbers exactly. This is a RATCHET: `autoUpdate` makes a
      // coverage run rewrite these values upward whenever coverage improves (commit that change with
      // the PR — CI fails if the rewritten file isn't committed), and the run fails if coverage drops
      // below them. Per metric: a failing run still bumps the metrics that improved. NEVER lower them
      // by hand.
      thresholds: {
        autoUpdate: true,
        statements: 8.74,
        branches: 7.74,
        functions: 9.99,
        lines: 8.61,
      },
    },
  },
});
