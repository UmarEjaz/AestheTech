import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseThresholds,
  baseThresholds,
  findDecreases,
  stripComments,
  CONFIG_PATH,
  ROOT,
} from "./check-coverage-floor.mjs";

const realConfig = (): string => readFileSync(join(ROOT, CONFIG_PATH), "utf8");

const sample = (s: number, b: number, f: number, l: number): string => `
export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        autoUpdate: true,
        statements: ${s},
        branches: ${b},
        functions: ${f},
        lines: ${l},
      },
    },
  },
});
`;

describe("check-coverage-floor", () => {
  it("parses the four thresholds out of the config text", () => {
    expect(parseThresholds(sample(6.72, 4.58, 6.17, 6.64))).toEqual({
      statements: 6.72,
      branches: 4.58,
      functions: 6.17,
      lines: 6.64,
    });
  });

  it("parses the real vitest.config.mts (so a reformat can't silently break the guard)", () => {
    const real = parseThresholds(realConfig());
    expect(real).not.toBeNull();
    for (const v of Object.values(real!)) expect(v).toBeGreaterThan(0);
  });

  it("is not fooled by `/*` inside the config's own glob strings", () => {
    // The real config has `"**/*.test.ts"`-style globs. A naive comment stripper would treat their `/*`
    // as a comment opener; with a later real block comment it would swallow the thresholds block.
    const withComment = realConfig().replace(/\}\);\s*$/, "});\n/* reporters: default */\n");
    expect(parseThresholds(withComment)).toEqual(parseThresholds(realConfig()));
    expect(baseThresholds(withComment)).toEqual(parseThresholds(realConfig()));
    expect(stripComments('exclude: ["**/*.test.ts", "**/*.d.ts"], // trailing')).toBe('exclude: ["**/*.test.ts", "**/*.d.ts"], ');
    expect(stripComments("a /* x */ b // y\nc")).toBe("a  b \nc");
    expect(stripComments(`"it's" + 'say "hi"' + "esc\\"aped"`)).toBe(`"it's" + 'say "hi"' + "esc\\"aped"`);
    expect(stripComments('a = "abc\\')).toBe('a = "abc\\'); // unterminated string ending in a backslash
  });

  it("rejects a duplicated thresholds block (JS keeps the last one, so which floor applies is ambiguous)", () => {
    const twoBlocks = `coverage: {
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
      thresholds: { statements: 5, branches: 5, functions: 5, lines: 5 },
    }`;
    expect(parseThresholds(twoBlocks)).toBeNull();
    expect(baseThresholds(twoBlocks)).toBeNull();
  });

  it("rejects an expression or a duplicated metric key; accepts bare numbers with or without a trailing comma", () => {
    // Vitest evaluates `80 - 20` as 60; reading it as 80 would let a lowered floor through.
    expect(parseThresholds("thresholds: { statements: 80 - 20, branches: 4, functions: 6, lines: 6 }")).toBeNull();
    expect(parseThresholds("thresholds: { statements: 80 * 0.5, branches: 4, functions: 6, lines: 6 }")).toBeNull();
    // A duplicated key is ambiguous (JS keeps the last one) → fail closed, even if one copy is a bare number.
    expect(parseThresholds("thresholds: { statements: 80, branches: 2, functions: 3, lines: 4, statements: 5 }")).toBeNull();
    expect(parseThresholds("thresholds: { statements: 80 - 20, statements: 80, branches: 2, functions: 3, lines: 4 }")).toBeNull();
    // Bare numbers pass whether or not the last entry has a trailing comma.
    const simple = { statements: 1, branches: 2, functions: 3, lines: 4 };
    expect(parseThresholds("thresholds: { statements: 1, branches: 2, functions: 3, lines: 4 }")).toEqual(simple);
    expect(parseThresholds("thresholds: {\n  statements: 1,\n  branches: 2,\n  functions: 3,\n  lines: 4,\n}")).toEqual(simple);
  });

  it("survives braces inside string keys and rejects an empty block", () => {
    const text = `thresholds: { "lib/{a,b}/**": { statements: 1, branches: 1, functions: 1, lines: 1 }, statements: 6.72, branches: 4.58, functions: 6.17, lines: 6.64 }`;
    expect(parseThresholds(text)).toEqual({ statements: 6.72, branches: 4.58, functions: 6.17, lines: 6.64 });
    expect(parseThresholds("thresholds: {}")).toBeNull();
  });

  it("fails closed when the block or a metric is missing", () => {
    expect(parseThresholds("export default {}")).toBeNull();
    expect(parseThresholds("thresholds: { statements: 1, branches: 2, functions: 3 }")).toBeNull();
    expect(parseThresholds("thresholds: { statements: 1, branches: 2, functions: 3, lines: 4 ")).toBeNull(); // unbalanced
  });

  it("ignores a nested per-glob object, even when it comes first and has all four metrics", () => {
    const text = `
      thresholds: {
        "lib/**": { statements: 80, branches: 80, functions: 80, lines: 80 },
        autoUpdate: true,
        statements: 6.72,
        branches: 4.58,
        functions: 6.17,
        lines: 6.64,
      },`;
    expect(parseThresholds(text)).toEqual({ statements: 6.72, branches: 4.58, functions: 6.17, lines: 6.64 });
    // A glob-only block has no global floor → fail closed, not "80".
    expect(parseThresholds(`thresholds: { "lib/**": { statements: 80, branches: 80, functions: 80, lines: 80 } }`)).toBeNull();
  });

  it("ignores comments inside and above the block", () => {
    const text = `
      // thresholds: { statements: 1, branches: 1, functions: 1, lines: 1 },
      thresholds: {
        // statements: 50 was the old value
        /* lines: 99 */
        statements: 6.72,
        branches: 4.58,
        functions: 6.17,
        lines: 6.64,
      },`;
    expect(parseThresholds(text)).toEqual({ statements: 6.72, branches: 4.58, functions: 6.17, lines: 6.64 });
    // A commented-out block on the base is still "no floor yet".
    expect(baseThresholds("// thresholds: { statements: 1, branches: 1, functions: 1, lines: 1 }")).toEqual({
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
    });
  });

  it("treats a base config with no thresholds block as a zero floor, but a broken block as an error", () => {
    expect(baseThresholds("export default defineConfig({ test: { coverage: { provider: 'v8' } } })")).toEqual({
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
    });
    expect(baseThresholds("thresholds: { statements: 1 }")).toBeNull();
    expect(baseThresholds(sample(6.72, 4.58, 6.17, 6.64))).toEqual(parseThresholds(sample(6.72, 4.58, 6.17, 6.64)));
  });

  it("reports only the metrics that went down", () => {
    const base = parseThresholds(sample(6.72, 4.58, 6.17, 6.64))!;
    const head = parseThresholds(sample(6.72, 4.5, 6.2, 6.63))!;
    expect(findDecreases(base, head)).toEqual([
      { metric: "branches", base: 4.58, head: 4.5 },
      { metric: "lines", base: 6.64, head: 6.63 },
    ]);
  });

  it("allows unchanged and increased thresholds", () => {
    const base = parseThresholds(sample(6.72, 4.58, 6.17, 6.64))!;
    expect(findDecreases(base, base)).toEqual([]);
    expect(findDecreases(base, parseThresholds(sample(7, 5, 7, 7))!)).toEqual([]);
  });
});
