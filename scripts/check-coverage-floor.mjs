#!/usr/bin/env node
/**
 * Coverage-floor ratchet guard: the thresholds in vitest.config.mts may never go DOWN.
 *
 * Vitest itself only enforces "measured coverage >= committed floor", and the CI step before this one
 * only catches a floor that should have gone UP (autoUpdate rewrote the file and nobody committed it).
 * Neither catches a floor that was lowered by hand to match reduced coverage — this script does, by
 * comparing every threshold in the working tree against the same file on a base ref.
 *
 *   node scripts/check-coverage-floor.mjs <base-ref>     e.g. origin/main on a PR; the previous tip of
 *                                                        main on a push to main
 *
 * Exit 1 on any decrease, on an unparseable config, or on a missing base — never a silent pass.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_PATH = "vitest.config.mts";
export const METRICS = ["statements", "branches", "functions", "lines"];

// Repo root, so the head file resolves no matter which directory the script is run from.
export const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Drop block and line comments so a commented-out block or a `// statements: 50` note can't match.
 * String literals are copied verbatim: the config's own glob strings (`"**\/*.test.ts"`) contain `/*`,
 * which a naive regex would read as the start of a comment and swallow the thresholds block.
 */
export function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      // copy the whole string literal, honouring backslash escapes
      const q = c;
      out += c;
      i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === "\\") out += text[i++];
        out += text[i++] ?? "";
      }
      out += text[i++] ?? "";
      continue;
    }
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * The text of the `thresholds: { ... }` block at depth 1 only — nested objects (e.g. a per-glob
 * `"lib/**": { ... }` entry) are blanked out so their numbers can never be read as the global floor.
 * Returns null when the block is missing or its braces don't balance.
 */
function thresholdsBlock(text) {
  const src = stripComments(text);
  // Exactly one block: a duplicated `thresholds:` key would let a later, lower block win at runtime
  // (JS keeps the last duplicate) while we read the first — ambiguous, so fail closed.
  const occurrences = src.match(/\bthresholds\s*:\s*\{/g) ?? [];
  if (occurrences.length !== 1) return null;
  const start = src.search(/\bthresholds\s*:\s*\{/);
  let depth = 0;
  let inner = "";
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    const c = src[i];
    if (c === "{") {
      depth++;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0) return inner;
      continue;
    }
    if (depth === 1) inner += c;
  }
  return null; // unbalanced — fail closed
}

/**
 * Pull the four numeric thresholds out of the `thresholds: { ... }` block. Returns null when the block or
 * any metric is missing, so a reformatted config fails closed instead of reading as "no floor". Each value
 * must be a bare number followed by a comma or the end of the block: an expression like `80 - 20` (which
 * Vitest would evaluate to 60) is rejected rather than read as 80. Each metric must appear exactly once:
 * JS keeps the LAST duplicate key, so `statements: 80, ..., statements: 5` would enforce 5 while a
 * first-match read says 80 — ambiguous, so it fails closed.
 */
export function parseThresholds(text) {
  const block = thresholdsBlock(text);
  if (block === null) return null;
  const out = {};
  for (const metric of METRICS) {
    // Count the KEY, not just well-formed values: `statements: 80 - 20, statements: 80` has one bad and
    // one good value, and must still be rejected as a duplicate.
    const keys = block.match(new RegExp(`\\b${metric}\\s*:`, "g")) ?? [];
    if (keys.length !== 1) return null; // 0 = missing; 2+ = duplicate key (JS keeps the last one)
    const m = block.match(new RegExp(`\\b${metric}\\s*:\\s*(\\d+(?:\\.\\d+)?)(?=\\s*(?:,|$))`));
    if (!m) return null; // present but not a bare number (expression, identifier, string, ...)
    out[metric] = Number(m[1]);
  }
  return out;
}

/**
 * The base floor to compare against. A base config with NO thresholds block (e.g. `main` before the
 * floor was introduced) means "no floor yet" — every metric is 0, so any committed floor passes. A base
 * that HAS a block must parse fully; a half-readable block is a failure, not a free pass.
 */
export function baseThresholds(baseText) {
  if (!/\bthresholds\s*:/.test(stripComments(baseText))) return Object.fromEntries(METRICS.map((m) => [m, 0]));
  return parseThresholds(baseText);
}

/** Every metric whose head value is lower than its base value, as { metric, base, head }. */
export function findDecreases(base, head) {
  return METRICS.filter((m) => head[m] < base[m]).map((m) => ({ metric: m, base: base[m], head: head[m] }));
}

/**
 * Print the reason (as a GitHub error annotation when running in Actions, so it shows on the PR checks
 * summary, not only in the step log) and stop.
 * @returns {never}
 */
function fail(message) {
  const prefix = process.env.GITHUB_ACTIONS ? "::error::" : "";
  console.error(`${prefix}check-coverage-floor: ${message}`);
  process.exit(1);
}

/** CLI entry: compare the working-tree floor against `<base-ref>` and exit 1 on any decrease. */
function main() {
  const baseRef = process.argv[2];
  if (!baseRef) fail("usage: node scripts/check-coverage-floor.mjs <base-ref>");

  let baseText;
  try {
    // git's own "fatal: ..." goes to /dev/null; our fail() message below is the one the log should show.
    baseText = execFileSync("git", ["show", `${baseRef}:${CONFIG_PATH}`], {
      encoding: "utf8",
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    fail(`could not read ${CONFIG_PATH} at ${baseRef}; refusing to pass.`);
  }
  let headText;
  try {
    headText = readFileSync(join(ROOT, CONFIG_PATH), "utf8");
  } catch {
    fail(`could not read the working-tree ${CONFIG_PATH}; refusing to pass.`);
  }

  const base = baseThresholds(baseText);
  if (!base) fail(`${CONFIG_PATH} at ${baseRef} has a thresholds block I could not parse.`);
  const head = parseThresholds(headText);
  if (!head) fail(`could not parse the thresholds block in the working-tree ${CONFIG_PATH}.`);

  const decreases = findDecreases(base, head);
  for (const m of METRICS) {
    const arrow = head[m] > base[m] ? "up" : head[m] < base[m] ? "DOWN" : "same";
    console.log(`  ${m.padEnd(10)} ${String(base[m]).padStart(6)} -> ${String(head[m]).padStart(6)}  ${arrow}`);
  }
  if (decreases.length) {
    fail(
      `${decreases.length} threshold(s) are lower than on ${baseRef}: ` +
        decreases.map((d) => `${d.metric} ${d.base} -> ${d.head}`).join(", ") +
        ". The coverage floor only rises (CLAUDE.md, Gates > Tests). Add tests until coverage is back " +
        "at or above the base floor instead of lowering it.",
    );
  }
  console.log(`check-coverage-floor: ok — no threshold is lower than on ${baseRef}.`);
}

// Run only when executed directly (not when imported by the unit test). Compare real paths so a
// symlinked invocation still runs, and tolerate a missing argv[1] (REPL / `-e` import).
const invokedDirectly =
  !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (invokedDirectly) main();
