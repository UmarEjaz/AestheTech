import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Generated / build output and tool reports: never lint these.
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "next-env.d.ts",
    ],
  },
  // Next 15 splits the TypeScript rules out of core-web-vitals into `next/typescript`; include both so
  // the `@typescript-eslint/*` rules referenced by inline eslint-disable comments stay defined.
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // No `any`: the project is TypeScript-first. Clean today (0 violations); keep it that way.
      "@typescript-eslint/no-explicit-any": "error",
      // No stray console logging in app code. `warn`/`error` stay allowed for genuine diagnostics;
      // CLI scripts that print by design are exempted below.
      "no-console": ["error", { allow: ["warn", "error"] }],
      // Treat `_`-prefixed args/vars/caught errors as intentionally unused — a convention used across
      // the codebase (e.g. unused callback params). `error`, because the gate runs with
      // `--max-warnings 0` anyway, so a warning here would fail the build just the same.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // NOTE: `@typescript-eslint/explicit-function-return-type` is deliberately NOT enabled here.
      // ~497 existing functions lack a return type (see docs/KNOWN_ISSUES.md), so a repo-wide error
      // would fail the gate on day one. It is instead ratcheted in scripts/lint-changed.mjs: required
      // on every changed line (so the backlog never grows) and on every function of a touched file
      // (so the backlog shrinks per PR).
    },
  },
  // CLI tooling and scripts legitimately print to the console.
  {
    files: ["scripts/**", "prisma/**/*.{ts,mjs,js}", "*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
];

export default eslintConfig;
