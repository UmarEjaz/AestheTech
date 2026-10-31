#!/usr/bin/env node
/**
 * Changed-line lint gate.
 *
 * Lints only the JS/TS files a change touches, so a messy legacy file doesn't block a one-line edit,
 * while still holding new code to the full standard. On top of the repo ESLint config it overlays
 * `@typescript-eslint/explicit-function-return-type` (deliberately OFF repo-wide — see
 * eslint.config.mjs / docs/KNOWN_ISSUES.md), which is how the ~500-function return-type backlog is
 * ratcheted down without a codebase-wide sweep.
 *
 * Modes:
 *   (default)       diff the branch against origin/main (merge-base) incl. uncommitted changes to
 *                   tracked files (git doesn't diff untracked files — stage them first); fail only on
 *                   findings sitting on ADDED/MODIFIED lines. CI runs this.
 *   --staged        diff the git index and lint the STAGED blob content; same changed-line rule.
 *                   The pre-commit hook runs this.
 *   --whole-file    lint each touched file in full; fail on ANY finding anywhere in the file.
 *                   This is the manual PR standard ("touched files leave clean", incl. return types
 *                   on every function) — NOT run by CI or the hook, so it's what shrinks the backlog
 *                   when a developer/reviewer runs it; the changed-line modes only stop it growing.
 *
 * Set SKIP_LINT=1 to bypass (emergency escape; also honoured by the pre-commit hook).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ESLint } from "eslint";

if (process.env.SKIP_LINT === "1") {
  console.log("lint-changed: skipped (SKIP_LINT=1)");
  process.exit(0);
}

// Git reports repo-root-relative paths; run from the root so they resolve even when invoked from a
// subdirectory (CLAUDE.md tells developers to run --whole-file by hand).
process.chdir(git(["rev-parse", "--show-toplevel"]).trim());

const staged = process.argv.includes("--staged");
const wholeFile = process.argv.includes("--whole-file");
const LINT_EXT = /\.(mjs|cjs|mts|cts|js|jsx|ts|tsx)$/;

// The return-type rule, ratcheted onto changed/touched code only. Scoped to TypeScript files (plain
// JS/MJS can't carry type annotations). The relaxing options keep it off inline callbacks and JSX
// expressions while still requiring a type on named + exported functions.
const RETURN_TYPE_OVERLAY = [
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
    },
  },
];

/** Run git with an argv array (no shell), so paths like `app/[id]/x.tsx` aren't glob-expanded. */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/** The ref we diff against: prefer origin/main, fall back to local main, else null. */
function baseRef() {
  for (const ref of ["origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch {
      // not present; try the next one
    }
  }
  return null;
}

/**
 * Parse `git diff --unified=0` into { byFile: file -> Set(addedLineNumbers), orphanHunks }.
 * `orphanHunks` counts `@@` hunk headers seen before any `+++ b/<file>` header — the real signal that
 * we failed to understand git's output. (A diff with no hunks at all, e.g. only binary or mode-only
 * changes, is legitimately "nothing to lint", not a parse failure.)
 */
function parseDiff(diff) {
  const byFile = new Map();
  let current = null;
  let orphanHunks = 0;
  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.*)$/);
    if (fileMatch) {
      current = fileMatch[1];
      if (!byFile.has(current)) byFile.set(current, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;
    if (!current) {
      orphanHunks++;
      continue;
    }
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let i = 0; i < count; i++) byFile.get(current).add(start + i);
  }
  return { byFile, orphanHunks };
}

// `core.quotePath=false` so non-ASCII paths come back verbatim (not octal-escaped); explicit a/ b/
// prefixes so a developer's `diff.noprefix` / `diff.mnemonicPrefix` can't break the `+++ b/` parse;
// `--no-color` / `--no-ext-diff` guard `color.ui=always` and `diff.external`.
const DIFF_BASE = [
  "-c", "core.quotePath=false",
  "diff", "--unified=0", "--diff-filter=ACMR",
  "--src-prefix=a/", "--dst-prefix=b/", "--no-color", "--no-ext-diff",
];
let diffArgs;
if (staged) {
  diffArgs = [...DIFF_BASE, "--cached"];
} else {
  const base = baseRef();
  if (!base) {
    // Fail CLOSED: a missing base ref must not turn the gate into a silent green no-op. In CI, check
    // out with fetch-depth: 0 so origin/main exists.
    console.error(
      "lint-changed: could not resolve a base ref (origin/main or main) to diff against; refusing " +
        "to run a no-op gate. In CI, check out with fetch-depth: 0.",
    );
    process.exit(1);
  }
  let from = base;
  try {
    from = git(["merge-base", base, "HEAD"]).trim() || base;
  } catch {
    from = base;
  }
  diffArgs = [...DIFF_BASE, from];
}

const { byFile: changed, orphanHunks } = parseDiff(git(diffArgs));
if (orphanHunks > 0) {
  // Fail CLOSED: a hunk we couldn't attribute to a `+++ b/<file>` header means the parser didn't
  // understand git's output — never let that read as "nothing to lint".
  console.error("lint-changed: diff contained hunks not attributable to any `+++ b/<file>` header; refusing to pass.");
  process.exit(1);
}
// In --staged mode the content is read from the index, so disk existence isn't required.
const files = [...changed.keys()].filter((f) => LINT_EXT.test(f) && (staged || existsSync(f)));

if (files.length === 0) {
  console.log("lint-changed: no changed JS/TS files to lint.");
  process.exit(0);
}

const eslint = new ESLint({ overrideConfig: RETURN_TYPE_OVERLAY });

/**
 * The content to lint for a file: the STAGED blob in --staged mode, the on-disk file otherwise — so
 * the line numbers ESLint reports line up with the diff we measured changed lines from (a file that
 * is partially staged would otherwise mismatch).
 */
function contentOf(file) {
  if (staged) return git(["show", `:${file}`]);
  return readFileSync(file, "utf8");
}

const relevant = [];
for (const file of files) {
  if (await eslint.isPathIgnored(file)) continue;
  const abs = resolve(file);
  let results;
  try {
    results = await eslint.lintText(contentOf(file), { filePath: abs });
  } catch (err) {
    console.error(`lint-changed: could not lint ${file}: ${err?.message ?? err}`);
    process.exit(1);
  }
  const result = results[0];
  if (!result) continue;
  // Linting one known file at a time, so messages map to it directly (no cwd/realpath guessing).
  const addedLines = changed.get(file);
  const messages = wholeFile
    ? result.messages
    // Always surface fatal parse errors (a file that no longer parses must never pass), plus any
    // finding on an added/modified line.
    : result.messages.filter((m) => m.fatal || (m.line && addedLines?.has(m.line)));
  if (messages.length) {
    relevant.push({ ...result, filePath: abs, messages, errorCount: messages.length, warningCount: 0 });
  }
}

const problems = relevant.reduce((n, r) => n + r.messages.length, 0);
if (problems > 0) {
  const formatter = await eslint.loadFormatter("stylish");
  console.error(await formatter.format(relevant));
  const scope = wholeFile ? "touched files" : "changed lines";
  console.error(`lint-changed: ${problems} problem(s) on ${scope}. Fix them, or SKIP_LINT=1 to bypass.`);
  process.exit(1);
}

console.log(`lint-changed: clean (${files.length} file(s) checked, ${wholeFile ? "whole-file" : "changed-line"} mode).`);
