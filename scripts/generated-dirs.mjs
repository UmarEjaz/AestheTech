/**
 * Folders that hold generated output, build artefacts or tool reports — never our source code.
 * Single source of truth shared by `eslint.config.mjs` (never linted), `vitest.config.mts` (never
 * searched for tests) and `lib/server-client-boundary.test.ts` (never walked for client entries), so
 * the three can't drift apart. Matched at the repo root, the way ESLint's `<dir>/**` ignores work;
 * `node_modules` is additionally skipped at any depth by every consumer.
 *
 * The PATH of this file is load-bearing: scripts/check-coverage-floor.mjs evaluates the BASE branch's
 * vitest.config.mts against the current working tree, so renaming or moving this file, or renaming its
 * `GENERATED_DIRS` export, breaks the CI floor check until main no longer imports it from here. Leave a
 * re-exporting shim at this path for one merge.
 */
export const GENERATED_DIRS = ["node_modules", ".next", "out", "build", "dist", "coverage", "test-results", "playwright-report"];
