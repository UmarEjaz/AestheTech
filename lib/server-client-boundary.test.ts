import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, relative, resolve, sep, extname } from "node:path";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import ts from "typescript";

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
const SOURCE_DIRS = ["app", "components", "lib"];
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

/** `import ... from "x"`: type-only when the whole clause is `import type` or every named binding is `type`. */
function importClauseIsTypeOnly(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false; // `import "x"` side-effect import — the module runs
  if (clause.isTypeOnly) return true;
  if (clause.name) return false; // a default import is a value
  const nb = clause.namedBindings;
  if (nb && ts.isNamedImports(nb)) return nb.elements.length > 0 && nb.elements.every((e) => e.isTypeOnly);
  return false; // namespace import, or `import {} from "x"` (the module still evaluates)
}

/** `export ... from "x"`: type-only when `export type` or every named export is `type`. */
function exportIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const c = node.exportClause;
  if (c && ts.isNamedExports(c)) return c.elements.length > 0 && c.elements.every((e) => e.isTypeOnly);
  return false; // `export * from`, `export * as ns from`
}

/**
 * Every module specifier a file references, from the syntax tree: static `import`/`export ... from`,
 * `import x = require("...")`, and — anywhere in the file, including inside functions — dynamic
 * `import("...")` and CommonJS `require("...")` with a literal argument. Type-position imports
 * (`typeof import("x")`, `import("x").T`) are type nodes, not calls, so they are naturally skipped.
 */
function extractImports(sf: ts.SourceFile): ImportRef[] {
  const refs: ImportRef[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        refs.push({ spec: node.moduleSpecifier.text, typeOnly: importClauseIsTypeOnly(node.importClause) });
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        refs.push({ spec: node.moduleSpecifier.text, typeOnly: exportIsTypeOnly(node) });
      }
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
        refs.push({ spec: ref.expression.text, typeOnly: node.isTypeOnly });
      }
      return;
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isDynamicImport || isRequire) refs.push({ spec: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return refs;
}

/** Recursively list every source file under `dir`, skipping node_modules, .next and `.d.ts` files. */
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
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
 * BFS the WHOLE import graph from a client entry and record EVERY forbidden edge into `into`, keyed
 * by the file that does the importing (`<importing file> :: <forbidden target>`). Keying by the
 * importer — not the entry — means a baseline entry pins exactly one edge, so a second leak from the
 * same file (e.g. a new `@/lib/prisma` import next to a tolerated enum import) is a NEW key and fails.
 * We never return early: one baselined edge must not hide any other.
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
    for (const { spec, typeOnly } of importsOf(file)) {
      if (typeOnly) continue;
      const reason = forbiddenReason(spec);
      if (reason) {
        const key = `${rel(file)} :: ${reason}`;
        if (!into.has(key)) into.set(key, [...trail, reason].join(" -> "));
        continue;
      }
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
 * Known, pre-existing leaks, keyed by the IMPORTING file (`<file> :: <forbidden target>`). Today every
 * entry is a module that imports Prisma ENUMS as values from `@prisma/client` and is reachable from a
 * `"use client"` component — client components themselves plus a few shared lib modules (validation
 * schemas, constants, utils). These are tolerated so the gate is green today, but the backlog only
 * shrinks: the test fails on any NEW edge (a new file, or a new forbidden target in a listed file,
 * e.g. `@/lib/prisma`), and fails if a listed entry is fixed but still listed here.
 *
 * To clear an entry: import the enum/type from a browser-safe module (a `@/lib/constants/*` union or
 * `import type`) instead of `@prisma/client`, then delete its line below. Never add a line to make a
 * new leak pass. See docs/KNOWN_ISSUES.md ("Prisma imports in client components").
 */
const BASELINE = new Set<string>([
  "app/dashboard/payroll/[id]/payroll-run-actions.tsx :: @prisma/client",
  "components/appointments/appointment-detail-modal.tsx :: @prisma/client",
  "components/appointments/appointment-form.tsx :: @prisma/client",
  "components/appointments/end-condition-selector.tsx :: @prisma/client",
  "components/appointments/pattern-selector.tsx :: @prisma/client",
  "components/appointments/recurring-series-badge.tsx :: @prisma/client",
  "components/appointments/series-management-panel.tsx :: @prisma/client",
  "components/clients/client-card.tsx :: @prisma/client",
  "components/clients/loyalty-dashboard.tsx :: @prisma/client",
  "components/clients/recurring-series-card.tsx :: @prisma/client",
  "components/invoices/invoice-actions.tsx :: @prisma/client",
  "components/payroll/payroll-entry-table.tsx :: @prisma/client",
  "components/payroll/payroll-run-list.tsx :: @prisma/client",
  "components/payroll/payroll-search.tsx :: @prisma/client",
  "components/payroll/salary-config-form.tsx :: @prisma/client",
  "components/sales/checkout-form.tsx :: @prisma/client",
  "components/schedules/schedule-month-view.tsx :: @prisma/client",
  "components/schedules/schedule-page-client.tsx :: @prisma/client",
  "components/schedules/schedule-pdf.tsx :: @prisma/client",
  "components/schedules/schedule-week-view.tsx :: @prisma/client",
  "lib/constants/payment-methods.tsx :: @prisma/client",
  "lib/utils/loyalty.ts :: @prisma/client",
  "lib/utils/recurring.ts :: @prisma/client",
  "lib/validations/invoice.ts :: @prisma/client",
  "lib/validations/payroll.ts :: @prisma/client",
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

describe("extractImports — what counts as a runtime import", () => {
  it("sees a value import that shares its line with the directive, and several imports on one line", () => {
    expect(imports('"use client"; import { PrismaClient } from "@prisma/client";')).toEqual([
      { spec: "@prisma/client", typeOnly: false },
    ]);
    expect(imports('import a from "a"; import b from "b";').map((r) => r.spec)).toEqual(["a", "b"]);
  });

  it("is not confused by an earlier type alias, comments, or strings that look like imports", () => {
    expect(imports('export type Foo = { a: 1 };\nimport y from "y";')).toEqual([{ spec: "y", typeOnly: false }]);
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
    expect(imports(src)).toEqual([
      { spec: "a", typeOnly: true },
      { spec: "b", typeOnly: true },
      { spec: "d", typeOnly: true },
      { spec: "e", typeOnly: true },
    ]);
  });

  it("treats every other import shape as a runtime import", () => {
    const src = [
      'import { type A, B } from "mixed";',
      'import * as ns from "ns";',
      'import {} from "empty";',
      'import "side";',
      'export * from "star";',
      'export { x } from "reexport";',
      'import eq = require("eq");',
      'function later() { return import("dynamic"); }',
      'const r = require("cjs");',
    ].join("\n");
    expect(imports(src)).toEqual(
      ["mixed", "ns", "empty", "side", "star", "reexport", "eq", "dynamic", "cjs"].map((spec) => ({ spec, typeOnly: false })),
    );
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
  const dir = mkdtempSync(join(tmpdir(), "boundary-fixture-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
    const keys = [...leaks.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0].endsWith("helper.ts :: @prisma/client")).toBe(true);
  });
});

describe("server/client import boundary", () => {
  const allFiles = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)));
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

  it("baseline only shrinks — remove any entry that no longer leaks", () => {
    const resolved = [...BASELINE].filter((key) => !leaks.has(key));
    expect(
      resolved,
      "These baseline entries are fixed. Delete them from BASELINE in this file so the backlog can't silently regrow:",
    ).toEqual([]);
  });
});
