import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeThresholds, findDecreases, CONFIG_PATH, METRICS, ROOT } from "./check-coverage-floor.mjs";

const SCRIPT = join(ROOT, "scripts", "check-coverage-floor.mjs");
const realConfig = (): string => readFileSync(join(ROOT, CONFIG_PATH), "utf8");
// Each end-to-end case spawns the script, which loads two configs through Vite — about a second here,
// several on a small CI runner. Keep it well clear of Vitest's default 5s.
const E2E_TIMEOUT = 60_000;

/**
 * Run the real script end to end (it loads configs through Vitest, so we exercise it as a child process).
 * `status` is null when the child died from a signal rather than exiting.
 */
function runScript(args: string[]): { status: number | null; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // execFileSync blocks the worker, so Vitest's own timeout can't interrupt a hung child; kill it
      // ourselves first so a hang is a normal test failure instead of a stalled CI job.
      timeout: E2E_TIMEOUT - 5_000,
      killSignal: "SIGKILL",
    });
    return { status: 0, out };
  } catch (err) {
    const e = err as { status: number | null; stdout?: string; stderr?: string };
    return { status: e.status, out: `${e.stdout ?? ""}\n${e.stderr ?? ""}` };
  }
}

describe("normalizeThresholds", () => {
  it("accepts four plain numbers and ignores autoUpdate/perFile/per-glob entries", () => {
    const raw = { autoUpdate: true, perFile: false, "lib/**": { lines: 90 }, statements: 6.72, branches: 4.58, functions: 6.17, lines: 6.64 };
    expect(normalizeThresholds(raw, { strict: true })).toEqual({
      floor: { statements: 6.72, branches: 4.58, functions: 6.17, lines: 6.64 },
    });
  });

  it("treats a base with no thresholds (or a missing metric) as a zero floor, but requires all four on the head", () => {
    const zero = { statements: 0, branches: 0, functions: 0, lines: 0 };
    expect(normalizeThresholds(undefined, { strict: false })).toEqual({ floor: zero });
    expect(normalizeThresholds({ statements: 5 }, { strict: false })).toEqual({ floor: { ...zero, statements: 5 } });
    expect(normalizeThresholds(undefined, { strict: true })).toEqual({ error: "no coverage.thresholds block" });
    expect(normalizeThresholds({ statements: 1, branches: 2, functions: 3 }, { strict: true })).toEqual({
      error: "coverage.thresholds.lines is missing",
    });
  });

  it("mirrors Vitest's `100: true` shorthand, which overrides every metric", () => {
    const all100 = { statements: 100, branches: 100, functions: 100, lines: 100 };
    expect(normalizeThresholds({ 100: true }, { strict: true })).toEqual({ floor: all100 });
    expect(normalizeThresholds({ 100: true, lines: 5 }, { strict: true })).toEqual({ floor: all100 });
  });

  it("fails closed on non-numeric, non-finite or negative values", () => {
    expect(normalizeThresholds({ statements: "80", branches: 1, functions: 1, lines: 1 }, { strict: true })).toHaveProperty("error");
    expect(normalizeThresholds({ statements: NaN, branches: 1, functions: 1, lines: 1 }, { strict: true })).toHaveProperty("error");
    expect(normalizeThresholds({ statements: -5, branches: 1, functions: 1, lines: 1 }, { strict: false })).toHaveProperty("error");
    expect(normalizeThresholds(80, { strict: false })).toHaveProperty("error");
  });
});

describe("findDecreases", () => {
  const base = { statements: 6.72, branches: 4.58, functions: 6.17, lines: 6.64 };
  it("reports only the metrics that went down", () => {
    expect(findDecreases(base, { statements: 6.72, branches: 4.5, functions: 6.2, lines: 6.63 })).toEqual([
      { metric: "branches", base: 4.58, head: 4.5 },
      { metric: "lines", base: 6.64, head: 6.63 },
    ]);
  });
  it("allows unchanged and increased thresholds", () => {
    expect(findDecreases(base, base)).toEqual([]);
    expect(findDecreases(base, { statements: 7, branches: 5, functions: 7, lines: 7 })).toEqual([]);
  });
});

describe("check-coverage-floor end to end (configs loaded through Vitest, not pattern-matched)", () => {
  const tmpFiles: string[] = [];
  afterEach(() => {
    for (const f of tmpFiles.splice(0)) rmSync(f, { force: true });
  });

  /**
   * A variant of the real config (same imports/plugins, written next to it) with the thresholds block
   * replaced. Metrics NOT under test are set to 100 by the caller so they can never read as a decrease,
   * whatever the committed floor is when this runs.
   */
  const variant = (thresholdsSource: string): string => {
    const original = realConfig();
    const text = original.replace(/thresholds:\s*\{[\s\S]*?\n\s*\},/, `thresholds: ${thresholdsSource},`);
    if (text === original) throw new Error("test setup: could not find the thresholds block to replace");
    const path = join(ROOT, `.coverage-floor-test-${randomUUID()}.vitest.config.mts`);
    tmpFiles.push(path);
    writeFileSync(path, text);
    return path;
  };

  it("passes when the head floor equals the committed one", { timeout: E2E_TIMEOUT }, () => {
    const r = runScript(["HEAD"]);
    expect(r.out).toContain("no threshold is lower than on HEAD");
    expect(r.status).toBe(0);
  });

  it("fails on a floor lowered through an arithmetic expression", { timeout: E2E_TIMEOUT }, () => {
    // Text-matching would read 80 here; Vitest evaluates 80 - 79 = 1.
    const r = runScript(["HEAD", variant("{ statements: 80 - 79, branches: 100, functions: 100, lines: 100 }")]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/statements [\d.]+ -> 1\b/);
    expect(r.out).toContain("1 threshold(s) are lower");
  });

  it("fails on statements and lines floors lowered through a spread that overrides the literals", { timeout: E2E_TIMEOUT }, () => {
    const r = runScript([
      "HEAD",
      variant("{ statements: 100, branches: 100, functions: 100, lines: 100, ...{ statements: 1, lines: 1 } }"),
    ]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/statements [\d.]+ -> 1\b/);
    expect(r.out).toMatch(/lines [\d.]+ -> 1\b/);
    expect(r.out).toContain("2 threshold(s) are lower");
  });

  it("fails on a floor lowered through a duplicated key (JS keeps the last one)", { timeout: E2E_TIMEOUT }, () => {
    const r = runScript(["HEAD", variant("{ branches: 100, functions: 100, lines: 100, statements: 100, statements: 2 }")]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/statements [\d.]+ -> 2\b/);
    expect(r.out).toContain("1 threshold(s) are lower");
  });

  it("honours Vitest's `100: true` shorthand end to end", { timeout: E2E_TIMEOUT }, () => {
    const r = runScript(["HEAD", variant("{ 100: true }")]);
    // Table rows are column-padded: "statements   6.72 ->    100  up".
    for (const metric of METRICS) {
      expect(r.out).toMatch(new RegExp(`${metric}\\s+[\\d.]+ ->\\s+100\\s+up`));
    }
    expect(r.status).toBe(0);
  });

  it("fails closed when the head config has no thresholds", { timeout: E2E_TIMEOUT }, () => {
    const r = runScript(["HEAD", variant("undefined")]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("no coverage.thresholds block");
  });

  it("fails closed when the head config does not load", { timeout: E2E_TIMEOUT }, () => {
    const r = runScript(["HEAD", variant("{ statements: 1, branches: 1, functions: 1, lines: 1 ")]); // syntax error
    expect(r.status).toBe(1);
    expect(r.out).toContain("failed to load through Vitest");
  });

  it("fails closed on a missing base ref and prints usage without one", { timeout: E2E_TIMEOUT }, () => {
    const missing = runScript(["no-such-ref"]);
    expect(missing.status).toBe(1);
    expect(missing.out).toContain("could not read vitest.config.mts at no-such-ref");
    const noArgs = runScript([]);
    expect(noArgs.status).toBe(1);
    expect(noArgs.out).toContain("usage:");
  });
});
