#!/usr/bin/env node
/**
 * Coverage-floor ratchet guard: the thresholds in vitest.config.mts may never go DOWN.
 *
 * Vitest itself only enforces "measured coverage >= committed floor", and the CI step before this one
 * only catches a floor that should have gone UP (autoUpdate rewrote the file and nobody committed it).
 * Neither catches a floor that was lowered by hand to match reduced coverage — this script does, by
 * comparing the floor in the working tree against the floor at a base ref.
 *
 * Both floors are read the way Vitest reads them: the config module is LOADED through Vitest's own
 * config resolver and the final threshold numbers are taken from the result. Nothing is pattern-matched
 * out of the file text, so expressions (`80 - 20`), spreads (`...lower`), duplicate keys, comments and
 * nested per-glob blocks are all evaluated by JavaScript itself — exactly as Vitest will see them.
 *
 *   node scripts/check-coverage-floor.mjs <base-ref> [head-config]
 *     base-ref     e.g. origin/main on a PR; the previous tip of main on a push to main
 *     head-config  optional path to the config to treat as "head" (default vitest.config.mts; tests use it)
 *
 * Exit 1 on any decrease, on a config that fails to load, on a floor that isn't four plain numbers, or on
 * a missing base — never a silent pass.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_PATH = "vitest.config.mts";
export const METRICS = ["statements", "branches", "functions", "lines"];

// Repo root, so paths resolve no matter which directory the script is run from.
export const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Turn Vitest's resolved `coverage.thresholds` into `{ statements, branches, functions, lines }`, or
 * explain why it can't be used. `strict` (the head) requires all four to be present, finite and >= 0;
 * the base may leave metrics out (missing = 0: no floor yet). Vitest's `100: true` shorthand overrides
 * all four to 100: the config resolver returns the object as written (the `100` key is only expanded
 * later, by the coverage provider at run time), so it is expanded HERE, with Vitest's own truthiness
 * rule — this is the only place the shorthand is honoured. Per-glob entries (objects) and
 * `autoUpdate`/`perFile` are ignored. Negative values are Vitest's "max uncovered items" mode, which
 * this ratchet does not support — fail closed.
 * @returns {{ floor: Record<string, number> } | { error: string }}
 */
export function normalizeThresholds(thresholds, { strict }) {
  if (thresholds === undefined || thresholds === null) {
    if (strict) return { error: "no coverage.thresholds block" };
    return { floor: Object.fromEntries(METRICS.map((m) => [m, 0])) };
  }
  if (typeof thresholds !== "object") return { error: `coverage.thresholds is ${typeof thresholds}, expected an object` };
  const floor = {};
  for (const metric of METRICS) {
    let v = thresholds[100] ? 100 : thresholds[metric];
    if (v === undefined) {
      if (strict) return { error: `coverage.thresholds.${metric} is missing` };
      v = 0;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return { error: `coverage.thresholds.${metric} is not a finite number` };
    if (v < 0) return { error: `coverage.thresholds.${metric} is negative (max-uncovered mode is not supported by the ratchet)` };
    floor[metric] = v;
  }
  return { floor };
}

/** Every metric whose head value is lower than its base value, as { metric, base, head }. */
export function findDecreases(base, head) {
  return METRICS.filter((m) => head[m] < base[m]).map((m) => ({ metric: m, base: base[m], head: head[m] }));
}

/**
 * Load a Vitest config file through Vitest's own resolver and return its raw `coverage.thresholds`
 * (undefined when none). Throws if the config fails to load.
 */
export async function loadThresholds(configPath) {
  const { resolveConfig } = await import("vitest/node");
  const { vitestConfig } = await resolveConfig({ config: configPath, root: ROOT });
  return vitestConfig.coverage?.thresholds;
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

/** CLI entry: compare the head floor against the floor at `<base-ref>` and exit 1 on any decrease. */
async function main() {
  const baseRef = process.argv[2];
  const headConfig = process.argv[3] ? resolve(process.argv[3]) : join(ROOT, CONFIG_PATH);
  if (!baseRef) fail("usage: node scripts/check-coverage-floor.mjs <base-ref> [head-config]");

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

  // The base config is written as a SIBLING of the real one (same directory), so Vite resolves its
  // relative imports and `import.meta.url` exactly as for the real file, and bare imports such as
  // `@vitejs/plugin-react` find the same node_modules. Removed in `finally`; the name is gitignored.
  // No `fail()` (= process.exit) inside this try: exit would skip the `finally` and leave the file
  // behind. Record the problem, clean up, then fail.
  const basePath = join(ROOT, `.coverage-floor-${randomUUID()}.vitest.config.mts`);
  let baseRaw;
  let headRaw;
  let loadError = null;
  try {
    writeFileSync(basePath, baseText);
    try {
      baseRaw = await loadThresholds(basePath);
    } catch (err) {
      loadError = `${CONFIG_PATH} at ${baseRef} failed to load through Vitest: ${err?.message ?? err}`;
    }
    if (!loadError) {
      try {
        headRaw = await loadThresholds(headConfig);
      } catch (err) {
        loadError = `${headConfig} failed to load through Vitest: ${err?.message ?? err}`;
      }
    }
  } finally {
    rmSync(basePath, { force: true });
  }
  if (loadError) fail(loadError);

  const base = normalizeThresholds(baseRaw, { strict: false });
  if (base.error) fail(`${CONFIG_PATH} at ${baseRef}: ${base.error}.`);
  const head = normalizeThresholds(headRaw, { strict: true });
  if (head.error) fail(`${headConfig}: ${head.error}. The floor must be four plain, non-negative numbers.`);

  const decreases = findDecreases(base.floor, head.floor);
  for (const m of METRICS) {
    const b = base.floor[m];
    const h = head.floor[m];
    const arrow = h > b ? "up" : h < b ? "DOWN" : "same";
    console.log(`  ${m.padEnd(10)} ${String(b).padStart(6)} -> ${String(h).padStart(6)}  ${arrow}`);
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
  // No process.exit here: Vitest's resolveConfig closes what it opens, so the event loop drains on its
  // own, and a hard exit right after console.log could truncate the line on a piped stdout.
}

// Run only when executed directly (not when imported by the unit test). Compare real paths so a
// symlinked invocation still runs, and tolerate a missing argv[1] (REPL / `-e` import).
const invokedDirectly =
  !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (invokedDirectly) await main();
