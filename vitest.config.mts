import { defineConfig } from "vitest/config";
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
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      // Measure coverage (npm run test:coverage) but DON'T enforce a global threshold yet — app-wide
      // coverage is still low, so a hard gate would fail the build. Raise it as coverage grows.
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "components/**/*.tsx"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
});
