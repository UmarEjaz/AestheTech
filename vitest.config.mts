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
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "components/**/*.{ts,tsx}"],
      // Keep Vitest's built-in excludes (configs, dist, etc.) and drop all test/type-decl files —
      // both .test.ts and .test.tsx — so test code isn't measured as source.
      exclude: [...coverageConfigDefaults.exclude, "**/*.test.ts", "**/*.test.tsx", "**/*.d.ts"],
      // Coverage floor, set just under today's measured numbers (stmts 6.72 / branch 4.52 /
      // funcs 6.17 / lines 6.64). This is a RATCHET: raise these as PRs add tests, NEVER lower them.
      thresholds: {
        statements: 6.7,
        branches: 4.5,
        functions: 6.1,
        lines: 6.6,
      },
    },
  },
});
