import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  readFileSync,
  existsSync,
  statSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, dirname, relative, resolve, sep, extname } from "node:path";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import ts from "typescript";
import { GENERATED_DIRS } from "../scripts/generated-dirs.mjs";

/**
 * Architectural guard: nothing a `"use client"` component imports — directly or transitively through
 * our own modules — may pull in server-only code. We walk the real import graph from every client
 * entry file and fail if any edge references the Prisma client (`@prisma/client*`, `.prisma/client*`
 * or our `@/lib/prisma` singleton), `server-only`, or a Node builtin (`node:`-prefixed or bare).
 * Shared constants and Zod schemas used by the browser must live in browser-safe modules.
 *
 * Files are parsed with the TypeScript compiler, not pattern-matched: directives and imports are read
 * from the syntax tree, so comments, strings, line layout (`"use client"; import ...` on one line),
 * type-only forms and dynamic/CommonJS imports are all handled the way the language defines them.
 */

const ROOT = process.cwd();
// Client entries are discovered across the WHOLE repo, so a new top-level folder is covered the day it
// appears. The generated-output folders (one list shared with `eslint.config.mjs` and `vitest.config.mts`)
// are skipped with the same meaning ESLint gives its ignore list: at the repo ROOT only, so a source
// folder that happens to be called `build` or `out` deeper down is still scanned. Independently of
// ESLint, the walk also skips `node_modules` at any depth, every dot-folder (`.git`, `.vscode`, …), and
// symbolic links, which are never followed whether they point at a file or a folder (so a symlinked
// source folder is NOT scanned: keep source as real folders).
const SKIP_DIRS = new Set(GENERATED_DIRS);
// Only these are source files; `.mjs`/`.mts` here are configs and CLI scripts, never browser code.
const SOURCE_EXT = [".ts", ".tsx", ".js", ".jsx"];
const RESOLVE_ORDER = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
// One parser mode per extension in SOURCE_EXT (a `.ts` file must NOT be parsed as TSX: `<T>` generics
// would be read as JSX).
const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
};

interface ImportRef {
  spec: string;
  typeOnly: boolean;
  /**
   * The runtime names taken from the module, as the module exports them (`import { A as B }` records
   * `A`): named bindings; `default`; or `*` when the whole module is pulled in (namespace import,
   * side-effect import, `export *`, `import {} from` / `export {} from`, `import x = require()`,
   * dynamic import, `require`). Empty for a type-only import.
   */
  names: string[];
}

/** Parse source text into a TypeScript syntax tree (script kind from the extension; TSX by default). */
function parse(src: string, fileName = "module.tsx"): ts.SourceFile {
  const kind = SCRIPT_KINDS[extname(fileName)] ?? ts.ScriptKind.TSX;
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, false, kind);
}

/**
 * True when `name` ("use client" / "use server") is a module-level directive: a string-literal
 * expression statement in the file's directive prologue (the run of such statements at the very top,
 * so `"use strict"; "use client";` counts). A `"use server"` inside a function body is an inline server
 * action, not a whole-module boundary, and is correctly not seen here because it is not a top-level
 * statement. Comments, blank lines and how statements share a line are irrelevant to the syntax tree.
 */
function hasModuleDirective(sf: ts.SourceFile, name: string): boolean {
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isStringLiteral(st.expression)) return false; // prologue over
    if (st.expression.text === name) return true;
  }
  return false;
}

/**
 * `import ... from "x"`: the runtime names it binds. Empty (= type-only, erased at build) when the
 * whole clause is `import type` or every named binding is `type`. `import {} from "x"` binds nothing
 * but still evaluates the module, so it counts as `*`.
 */
function importClauseNames(clause: ts.ImportClause | undefined): string[] {
  if (!clause) return ["*"]; // `import "x"` side-effect import — the module runs
  if (clause.isTypeOnly) return [];
  const names: string[] = [];
  if (clause.name) names.push("default");
  const nb = clause.namedBindings;
  if (nb && ts.isNamedImports(nb)) {
    if (nb.elements.length === 0 && !clause.name) return ["*"];
    for (const e of nb.elements) if (!e.isTypeOnly) names.push((e.propertyName ?? e.name).text);
  } else if (nb) {
    names.push("*"); // `import * as ns`
  }
  return names;
}

/**
 * `export ... from "x"`: the runtime names re-exported. Empty when `export type` or every name is
 * `type`; `export {} from "x"` binds nothing but still evaluates the module, so it counts as `*`.
 */
function exportNames(node: ts.ExportDeclaration): string[] {
  if (node.isTypeOnly) return [];
  const c = node.exportClause;
  if (c && ts.isNamedExports(c)) {
    if (c.elements.length === 0) return ["*"];
    return c.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text);
  }
  return ["*"]; // `export * from`, `export * as ns from`
}

/** Build an ImportRef; a reference with no runtime names is type-only. */
function ref(spec: string, names: string[]): ImportRef {
  return { spec, typeOnly: names.length === 0, names };
}

/**
 * Every module specifier a file references, from the syntax tree, with the runtime names it takes:
 * static `import`/`export ... from`, `import x = require("...")`, and — anywhere in the file, including
 * inside functions — dynamic `import("...")` and CommonJS `require("...")` with a literal argument.
 * Type-position imports (`typeof import("x")`, `import("x").T`) are type nodes, not calls, so they
 * are naturally skipped.
 */
function extractImports(sf: ts.SourceFile): ImportRef[] {
  const refs: ImportRef[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        refs.push(ref(node.moduleSpecifier.text, importClauseNames(node.importClause)));
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        refs.push(ref(node.moduleSpecifier.text, exportNames(node)));
      }
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      const mr = node.moduleReference;
      if (ts.isExternalModuleReference(mr) && ts.isStringLiteral(mr.expression)) {
        refs.push(ref(mr.expression.text, node.isTypeOnly ? [] : ["*"]));
      }
      return;
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isDynamicImport || isRequire) refs.push(ref(node.arguments[0].text, ["*"]));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return refs;
}

/**
 * Recursively list every source file under `dir`, skipping SKIP_DIRS at the walk root, `node_modules` and
 * dot-folders at any depth, symlinks (file or folder) and `.d.ts` files. See the note above SKIP_DIRS.
 */
function walk(dir: string, out: string[] = [], root: string = dir): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const generated = entry.name === "node_modules" || (dir === root && SKIP_DIRS.has(entry.name));
      if (generated || entry.name.startsWith(".")) continue;
      walk(full, out, root);
    } else if (SOURCE_EXT.some((e) => entry.name.endsWith(e)) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Resolve a relative or `@/`-aliased specifier to an absolute source file, or null. */
function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null; // bare package specifier — not one of our modules

  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const suffix of RESOLVE_ORDER) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Is this specifier server-only code that must never reach the browser? Returns the key to report, or
 * null. The Prisma client is matched by package root AND any subpath (`@prisma/client/edge`,
 * `@prisma/client/runtime/library`, ...), and likewise the generated `.prisma/client` copy, so a leak
 * can't dodge the guard by importing through a subpath; the exact specifier is the reported key so
 * each distinct one is its own baseline entry. `@prisma/client/index-browser` is deliberately NOT
 * exempt — the baseline treats enum imports from Prisma as a leak regardless of entry point.
 * If the Prisma generator ever gets a custom `output` (required by Prisma 7's `prisma-client`
 * generator), client imports move to that path — add it here or the guard goes blind.
 */
function forbiddenReason(spec: string): string | null {
  if (spec === "@prisma/client" || spec.startsWith("@prisma/client/")) return spec;
  if (spec === ".prisma/client" || spec.startsWith(".prisma/client/")) return spec;
  if (spec === "server-only") return "server-only";
  if (spec === "@/lib/prisma") return "@/lib/prisma";
  if (spec.startsWith("node:") || isBuiltin(spec)) return `node builtin "${spec}"`;
  return null;
}

const sourceCache = new Map<string, ts.SourceFile | null>();
/** The parsed syntax tree of `file`, cached; null when the file can't be read. */
function sourceOf(file: string): ts.SourceFile | null {
  const hit = sourceCache.get(file);
  if (hit !== undefined) return hit;
  let sf: ts.SourceFile | null = null;
  try {
    sf = parse(readFileSync(file, "utf8"), file);
  } catch {
    sf = null;
  }
  sourceCache.set(file, sf);
  return sf;
}

const importCache = new Map<string, ImportRef[]>();
/** Every import specifier in `file`, cached per file; an unreadable file has no imports. */
function importsOf(file: string): ImportRef[] {
  const cached = importCache.get(file);
  if (cached) return cached;
  const sf = sourceOf(file);
  const refs = sf ? extractImports(sf) : [];
  importCache.set(file, refs);
  return refs;
}

/** Does `file` open with a module-level `"use server"` directive? Unreadable = false. */
function isUseServer(file: string): boolean {
  const sf = sourceOf(file);
  return sf ? hasModuleDirective(sf, "use server") : false;
}

/**
 * The forbidden edges of ONE file, merged per target: `<forbidden target> { <sorted runtime names> }`.
 * Several import statements from the same forbidden module collapse into one edge with the union of
 * their names, so a key describes everything the file takes from that module.
 */
function forbiddenEdgesOf(file: string): string[] {
  const namesByTarget = new Map<string, Set<string>>();
  for (const r of importsOf(file)) {
    if (r.typeOnly) continue;
    const reason = forbiddenReason(r.spec);
    if (!reason) continue;
    const set = namesByTarget.get(reason) ?? new Set<string>();
    for (const n of r.names) set.add(n);
    namesByTarget.set(reason, set);
  }
  // `*` means "everything", so it subsumes any named bindings from the same module.
  return [...namesByTarget].map(([reason, set]) => `${reason} { ${set.has("*") ? "*" : [...set].sort().join(", ")} }`);
}

/**
 * BFS the WHOLE import graph from a client entry and record EVERY forbidden edge into `into`, keyed
 * by the file that does the importing AND the exact runtime names it takes
 * (`<importing file> :: <forbidden target> { <names> }`). Keying by the importer — not the entry —
 * means a baseline entry pins exactly one edge, so a second leak from the same file (e.g. a new
 * `@/lib/prisma` import next to a tolerated enum import) is a NEW key and fails. Keying by the names
 * means a tolerated enum import can't quietly grow: adding `PrismaClient` (or one more enum) to it
 * changes the key and fails too. We never return early: one baselined edge must not hide any other.
 *
 * Type-only imports are skipped (erased at build), and `"use server"` modules are a boundary —
 * Next.js compiles them to client-side RPC proxies, so their server bodies never reach the browser.
 */
function collectLeaks(entry: string, into: Map<string, string>): void {
  const visited = new Set<string>([entry]);
  const queue: Array<{ file: string; trail: string[] }> = [{ file: entry, trail: [rel(entry)] }];
  // Cursor over a growing array = BFS without O(n) shifts.
  for (let i = 0; i < queue.length; i++) {
    const { file, trail } = queue[i];
    for (const edge of forbiddenEdgesOf(file)) {
      const key = `${rel(file)} :: ${edge}`;
      if (!into.has(key)) into.set(key, [...trail, edge].join(" -> "));
    }
    for (const { spec, typeOnly } of importsOf(file)) {
      if (typeOnly || forbiddenReason(spec)) continue; // forbidden edges were recorded above
      const next = resolveLocal(spec, file);
      if (next && !visited.has(next)) {
        visited.add(next);
        if (isUseServer(next)) continue; // server-action boundary: do not follow into server code
        queue.push({ file: next, trail: [...trail, rel(next)] });
      }
    }
  }
}

/** Repo-relative path in forward-slash form, so BASELINE keys match on Windows too (CI is POSIX, but keep it portable). */
function rel(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

/**
 * Known, pre-existing leaks, keyed by the IMPORTING file, the forbidden target and the EXACT runtime
 * names taken from it (`<file> :: <target> { <names> }`). Today every entry is a module that imports
 * Prisma ENUMS as values from `@prisma/client` and is reachable from a `"use client"` component —
 * client components themselves plus a few shared lib modules (validation schemas, constants, utils).
 * These are tolerated so the gate is green today, but the backlog only shrinks: the test fails on any
 * NEW key (a new file; a new forbidden target in a listed file, e.g. `@/lib/prisma`; or a listed file
 * taking one more name from Prisma — another enum or `PrismaClient` itself), and fails if a listed
 * entry no longer matches (fixed, or its names changed) but is still listed here.
 *
 * An entry may only ever LOSE names. To clear a name or an entry: import the enum/type from a
 * browser-safe module (a `@/lib/constants/*` union or `import type`) instead of `@prisma/client`, then
 * edit or delete its line below. Never add a line or a name to make a new leak pass. See
 * docs/KNOWN_ISSUES.md ("Prisma imports in client components").
 */
const BASELINE = new Set<string>([
  "app/dashboard/payroll/[id]/payroll-run-actions.tsx :: @prisma/client { PayrollRunStatus }",
  "components/appointments/appointment-detail-modal.tsx :: @prisma/client { AppointmentStatus, PaymentMethod }",
  "components/appointments/appointment-form.tsx :: @prisma/client { PaymentMethod, RecurrenceEndType, RecurrencePattern }",
  "components/appointments/end-condition-selector.tsx :: @prisma/client { RecurrenceEndType }",
  "components/appointments/pattern-selector.tsx :: @prisma/client { RecurrencePattern }",
  "components/appointments/recurring-series-badge.tsx :: @prisma/client { RecurrencePattern }",
  "components/appointments/series-management-panel.tsx :: @prisma/client { RecurrenceEndType, RecurrencePattern }",
  "components/clients/client-card.tsx :: @prisma/client { LoyaltyTier }",
  "components/clients/loyalty-dashboard.tsx :: @prisma/client { LoyaltyTier, LoyaltyTransactionType }",
  "components/clients/recurring-series-card.tsx :: @prisma/client { AppointmentStatus, RecurrenceEndType, RecurrencePattern }",
  "components/invoices/invoice-actions.tsx :: @prisma/client { PaymentMethod }",
  "components/payroll/payroll-entry-table.tsx :: @prisma/client { PayrollEntryStatus, PayrollRunStatus }",
  "components/payroll/payroll-run-list.tsx :: @prisma/client { PayrollRunStatus }",
  "components/payroll/payroll-search.tsx :: @prisma/client { PayrollRunStatus }",
  "components/payroll/salary-config-form.tsx :: @prisma/client { PayType }",
  "components/sales/checkout-form.tsx :: @prisma/client { PaymentMethod }",
  "components/schedules/schedule-month-view.tsx :: @prisma/client { ShiftType }",
  "components/schedules/schedule-page-client.tsx :: @prisma/client { ShiftType }",
  "components/schedules/schedule-pdf.tsx :: @prisma/client { ShiftType }",
  "components/schedules/schedule-week-view.tsx :: @prisma/client { ShiftType }",
  "lib/constants/payment-methods.tsx :: @prisma/client { PaymentMethod }",
  "lib/utils/loyalty.ts :: @prisma/client { LoyaltyTier, LoyaltyTransactionType }",
  "lib/utils/recurring.ts :: @prisma/client { RecurrenceEndType, RecurrencePattern }",
  "lib/validations/invoice.ts :: @prisma/client { InvoiceStatus, PaymentMethod }",
  "lib/validations/payroll.ts :: @prisma/client { PayType, PayrollRunStatus }",
]);

const directive = (src: string, name: string): boolean => hasModuleDirective(parse(src), name);
const imports = (src: string): ImportRef[] => extractImports(parse(src));

describe("hasModuleDirective — what counts as a module-level directive", () => {
  it("accepts the directive on its own line, with or without a semicolon", () => {
    expect(directive('"use client";\nimport x from "./x";', "use client")).toBe(true);
    expect(directive("'use client'\nimport x from './x';", "use client")).toBe(true);
  });

  it("accepts the directive when an import follows on the same line (Next.js does)", () => {
    expect(directive('"use client"; import "./safe";', "use client")).toBe(true);
  });

  it("ignores leading comments and blank lines, and allows other directives before it", () => {
    expect(directive('// header\n/* block */\n\n"use client";\n', "use client")).toBe(true);
    expect(directive('"use strict";\n"use client";\n', "use client")).toBe(true);
  });

  it("rejects a directive that is not in the prologue, is only inside a function body, or is the wrong directive", () => {
    expect(directive('import x from "./x";\n"use client";', "use client")).toBe(false);
    expect(directive('export async function act() {\n  "use server";\n}', "use server")).toBe(false);
    expect(directive('"use client"', "use server")).toBe(false);
    expect(directive('"use client".length;', "use client")).toBe(false); // an expression, not a directive
    expect(directive('const s = "use client";', "use client")).toBe(false);
  });
});

describe("extractImports — what counts as a runtime import, and which names it takes", () => {
  it("sees a value import that shares its line with the directive, and several imports on one line", () => {
    expect(imports('"use client"; import { PrismaClient } from "@prisma/client";')).toEqual([
      { spec: "@prisma/client", typeOnly: false, names: ["PrismaClient"] },
    ]);
    expect(imports('import a from "a"; import b from "b";').map((r) => r.spec)).toEqual(["a", "b"]);
  });

  it("is not confused by an earlier type alias, comments, or strings that look like imports", () => {
    expect(imports('export type Foo = { a: 1 };\nimport y from "y";')).toEqual([{ spec: "y", typeOnly: false, names: ["default"] }]);
    expect(imports('// import x from "nope"\n/* import y from "nope2" */\nconst s = \'import z from "nope3"\';')).toEqual([]);
  });

  it("marks type-only forms as erased and skips type-position imports entirely", () => {
    const src = [
      'import type { A } from "a";',
      'import { type B, type C } from "b";',
      'export type { D } from "d";',
      'export { type E } from "e";',
      'type T = typeof import("f");',
      'let g: import("g").G;',
    ].join("\n");
    expect(imports(src)).toEqual(
      ["a", "b", "d", "e"].map((spec) => ({ spec, typeOnly: true, names: [] })),
    );
  });

  it("treats every other import shape as a runtime import, recording the names it takes", () => {
    const src = [
      'import { type A, B } from "mixed";',
      'import * as ns from "ns";',
      'import {} from "empty";',
      'import "side";',
      'export * from "star";',
      'export { x, y as z } from "reexport";',
      'export {} from "emptyre";',
      'import eq = require("eq");',
      'function later() { return import("dynamic"); }',
      'const r = require("cjs");',
    ].join("\n");
    expect(imports(src)).toEqual([
      { spec: "mixed", typeOnly: false, names: ["B"] },
      { spec: "ns", typeOnly: false, names: ["*"] },
      { spec: "empty", typeOnly: false, names: ["*"] },
      { spec: "side", typeOnly: false, names: ["*"] },
      { spec: "star", typeOnly: false, names: ["*"] },
      { spec: "reexport", typeOnly: false, names: ["x", "y"] },
      { spec: "emptyre", typeOnly: false, names: ["*"] },
      { spec: "eq", typeOnly: false, names: ["*"] },
      { spec: "dynamic", typeOnly: false, names: ["*"] },
      { spec: "cjs", typeOnly: false, names: ["*"] },
    ]);
  });

  it("records the module's own export name, not a local alias, and a default alongside named imports", () => {
    expect(imports('import { PaymentMethod as PM, ShiftType } from "@prisma/client";')).toEqual([
      { spec: "@prisma/client", typeOnly: false, names: ["PaymentMethod", "ShiftType"] },
    ]);
    expect(imports('import React, { useState } from "react";')).toEqual([
      { spec: "react", typeOnly: false, names: ["default", "useState"] },
    ]);
  });
});

describe("forbiddenReason — what counts as a server-only import", () => {
  it("catches the Prisma client by package root and by any subpath", () => {
    expect(forbiddenReason("@prisma/client")).toBe("@prisma/client");
    expect(forbiddenReason("@prisma/client/edge")).toBe("@prisma/client/edge");
    expect(forbiddenReason("@prisma/client/runtime/library")).toBe("@prisma/client/runtime/library");
    expect(forbiddenReason("@prisma/client/index-browser")).toBe("@prisma/client/index-browser");
    expect(forbiddenReason(".prisma/client")).toBe(".prisma/client");
    expect(forbiddenReason(".prisma/client/default")).toBe(".prisma/client/default");
  });

  it("catches server-only, the Prisma singleton and node builtins", () => {
    expect(forbiddenReason("server-only")).toBe("server-only");
    expect(forbiddenReason("@/lib/prisma")).toBe("@/lib/prisma");
    expect(forbiddenReason("node:fs")).toBe('node builtin "node:fs"');
    expect(forbiddenReason("fs")).toBe('node builtin "fs"');
  });

  it("does not flag look-alike or unrelated specifiers", () => {
    expect(forbiddenReason("@prisma/clientele")).toBeNull();
    expect(forbiddenReason("@/lib/prisma-helpers")).toBeNull();
    expect(forbiddenReason("react")).toBeNull();
    expect(forbiddenReason("zod")).toBeNull();
  });
});

describe("collectLeaks on a fixture — a leak reached through a local helper", () => {
  // Created in a hook, not the describe body: a filtered run (`-t`) skips a suite's hooks together, so
  // creation and cleanup are always paired and nothing is left in the temp folder.
  let dir: string;
  beforeAll((): void => {
    dir = mkdtempSync(join(tmpdir(), "boundary-fixture-"));
  });
  afterAll((): void => {
    if (dir) rmSync(dir, { recursive: true, force: true }); // unset only if beforeAll threw; don't mask that error
  });

  it("catches a Prisma import that shares its line with the directive, reached through a local helper", () => {
    const helper = join(dir, "helper.ts");
    writeFileSync(helper, '"use client"; import { PrismaClient } from "@prisma/client"; export const p = PrismaClient;\n');
    const entry = join(dir, "entry.tsx");
    writeFileSync(entry, '"use client";\nimport { p } from "./helper";\nexport const E = (): typeof p => p;\n');
    const sf = sourceOf(entry);
    expect(sf).not.toBeNull();
    expect(sf !== null && hasModuleDirective(sf, "use client")).toBe(true);

    const leaks = new Map<string, string>();
    collectLeaks(entry, leaks);
    expect([...leaks.keys()]).toEqual([`${rel(helper)} :: @prisma/client { PrismaClient }`]);
  });

  it("pins a tolerated enum import to its exact names, so adding PrismaClient to it is a new key", () => {
    const enumOnly = join(dir, "enum-only.tsx");
    writeFileSync(enumOnly, ['"use client";', 'import { PaymentMethod } from "@prisma/client";', "export const a = PaymentMethod;", ""].join("\n"));
    const grown = join(dir, "grown.tsx");
    writeFileSync(
      grown,
      [
        '"use client";',
        'import { PaymentMethod } from "@prisma/client";',
        'import { PrismaClient } from "@prisma/client";',
        "export const b = [PaymentMethod, PrismaClient];",
        "",
      ].join("\n"),
    );
    const leaks = new Map<string, string>();
    collectLeaks(enumOnly, leaks);
    collectLeaks(grown, leaks);
    expect([...leaks.keys()]).toEqual([
      `${rel(enumOnly)} :: @prisma/client { PaymentMethod }`,
      // Two import statements from the same module merge into one edge listing every name taken.
      `${rel(grown)} :: @prisma/client { PaymentMethod, PrismaClient }`,
    ]);
  });
});

describe("walk — discovery covers any folder, skipping only generated output, dot-folders and symlinks", () => {
  // A fresh folder per test (not per suite): each test asserts on the exact contents, so they must not share.
  let dir: string;
  beforeEach((): void => {
    dir = mkdtempSync(join(tmpdir(), "boundary-walk-"));
  });
  afterEach((): void => {
    if (dir) rmSync(dir, { recursive: true, force: true }); // unset only if beforeEach threw; don't mask that error
  });

  it("GENERATED_DIRS entries are unique bare folder names (consumers append `/**`; walk matches one path segment)", () => {
    expect(GENERATED_DIRS).toEqual([...new Set(GENERATED_DIRS)]);
    for (const d of GENERATED_DIRS) expect(d).toMatch(/^[^\\/*?[\]{}]+$/);
  });

  /** Write an empty module at `relPath` inside the fixture, creating parent folders. */
  const touch = (relPath: string): string => {
    const full = join(dir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "export {};\n");
    return full;
  };
  const found = (): string[] => walk(dir).map((f) => relative(dir, f)).sort();

  it("finds source files in a brand-new top-level folder and in nested folders, but not in skipped ones", () => {
    const keep = [
      join("features", "widget.tsx"),
      join("hooks", "deep", "use-thing.ts"),
      "root-level.js",
      ".hidden-root-file.js", // only dot-FOLDERS are skipped; a dot-file with a source extension is scanned
      join("e2e", "spec.ts"),
      // the generated-output names only count at the repo root, exactly like ESLint's `<dir>/**` ignores
      join("components", "build", "widget.tsx"),
      join("app", "out", "page.tsx"),
    ];
    const drop = [
      // every shared generated-output folder at the root (`.next` and `node_modules` are also caught by the
      // dot-folder / any-depth rules; the rest prove the root list)
      ...GENERATED_DIRS.map((d) => join(d, "nested", "generated.ts")),
      join("e2e", "node_modules", "pkg", "index.ts"), // node_modules is skipped at ANY depth
      join(".git", "hooks", "h.ts"),
      join("features", "types.d.ts"),
      join("features", "styles.css"),
      ".coverage-floor-tmp.vitest.config.mts", // `.mts` is not a source extension (temp copy of the Vitest config)
    ];
    for (const relPath of [...keep, ...drop]) touch(relPath);
    expect(found()).toEqual([...keep].sort());
  });

  // Symlink creation needs a privilege on Windows; CI and development run on POSIX.
  it.skipIf(process.platform === "win32")("never follows a symlink, whether it points at a file or a folder", () => {
    const realDir = join(dir, "shared-real");
    const realFile = touch(join("shared-real", "thing.tsx"));
    symlinkSync(realDir, join(dir, "components-link"), "dir");
    symlinkSync(realFile, join(dir, "thing-link.tsx"), "file");
    const results = found();
    expect(results).toContain(join("shared-real", "thing.tsx"));
    expect(results.some((f) => f.startsWith("components-link") || f === "thing-link.tsx")).toBe(false);
  });
});

describe("server/client import boundary", () => {
  const allFiles = walk(ROOT);
  const clientEntries = allFiles.filter((f) => {
    const sf = sourceOf(f);
    return sf !== null && hasModuleDirective(sf, "use client");
  });
  // key -> first trail seen; deduped across entries (a shared helper reached from many components is one edge)
  const leaks = new Map<string, string>();
  for (const entry of clientEntries) collectLeaks(entry, leaks);

  it("finds client components to check (sanity)", () => {
    expect(clientEntries.length).toBeGreaterThan(0);
  });

  it("no NEW server-only import is reachable from a client component (Prisma client, server-only, node: builtins)", () => {
    const fresh = [...leaks].filter(([key]) => !BASELINE.has(key)).map(([key, trail]) => `${key}   <-  ${trail}`);
    expect(
      fresh,
      "Server-only code is now reachable from a client component. Import shared enums/constants/schemas from a browser-safe module instead (key shown first, import trail after):",
    ).toEqual([]);
  });

  it("baseline may tolerate enums only — never the Prisma client itself or a whole-module import", () => {
    // Mechanical half of the "entries may only lose names" rule: editing BASELINE to admit
    // `PrismaClient`, the `Prisma` namespace or `*` can never make the gate green.
    const forbiddenNames = /\{[^}]*\b(PrismaClient|Prisma|\*)\b[^}]*\}|\{ \* \}/;
    expect([...BASELINE].filter((key) => forbiddenNames.test(key))).toEqual([]);
  });

  it("baseline only shrinks — edit or remove any entry that no longer matches", () => {
    const stale = [...BASELINE].filter((key) => !leaks.has(key));
    expect(
      stale,
      "These BASELINE entries no longer match what the file imports today. Fixed file: delete the entry. Fewer Prisma names than listed: shrink the entry to the names that remain. If the other test reports the SAME file with MORE names (or `*`), revert that import instead — an entry may only ever lose names:",
    ).toEqual([]);
  });
});
