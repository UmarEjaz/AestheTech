import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { isBuiltin } from "node:module";

/**
 * Architectural guard: nothing a `"use client"` component imports — directly or transitively through
 * our own modules — may pull in server-only code. We walk the real import graph from every client
 * entry file and fail if any edge references the Prisma client (`@prisma/client*`, `.prisma/client*`
 * or our `@/lib/prisma` singleton), `server-only`, or a Node builtin (`node:`-prefixed or bare).
 * Shared constants and Zod schemas used by the browser must live in browser-safe modules.
 */

const ROOT = process.cwd();
const SOURCE_DIRS = ["app", "components", "lib"];
const SOURCE_EXT = [".ts", ".tsx", ".js", ".jsx"];
const RESOLVE_ORDER = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

// `import|export <clause> from '...'` (clause lets us drop type-only imports), bare side-effect
// `import '...'`, dynamic `import('...')`, and CommonJS `require('...')` / `import x = require('...')`.
// FROM_RE is anchored to the start of a line and the clause may not cross a `;`, so an unrelated
// `export type Foo = ...;` can't lazily swallow a later real import and mislabel it type-only.
const FROM_RE = /^[ \t]*(?:import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/gm;
const SIDE_EFFECT_RE = /\bimport\s*["']([^"']+)["']/g;
const DYNAMIC_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

interface ImportRef {
  spec: string;
  typeOnly: boolean;
}

/** Remove block and line comments so a commented-out or trailing-comment import isn't matched. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * True only when `name` ("use client" / "use server") is the module's FIRST statement — a
 * module-level directive. A `"use server"` inside a function body is an inline server action, not a
 * whole-module boundary, and must not be mistaken for one.
 */
function isModuleDirective(src: string, name: string): boolean {
  const firstCode = stripComments(src)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return new RegExp(`^["']${name}["'];?$`).test(firstCode ?? "");
}

/** A clause is type-only if it's `type ...` or every named specifier is `type`-prefixed (all erased). */
function isTypeOnlyClause(clause: string): boolean {
  const t = clause.trim();
  if (/^type\b/.test(t)) return true;
  const braces = t.match(/^\{([^}]*)\}$/);
  if (braces) {
    const names = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
    return names.length > 0 && names.every((n) => /^type\s/.test(n));
  }
  return false;
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

const importCache = new Map<string, ImportRef[]>();
/** Every import specifier in `file` (static, side-effect, dynamic, require), cached per file. */
function importsOf(file: string): ImportRef[] {
  const cached = importCache.get(file);
  if (cached) return cached;
  const refs: ImportRef[] = [];
  try {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(FROM_RE)) refs.push({ spec: m[2], typeOnly: isTypeOnlyClause(m[1]) });
    for (const m of src.matchAll(SIDE_EFFECT_RE)) refs.push({ spec: m[1], typeOnly: false });
    for (const m of src.matchAll(DYNAMIC_RE)) refs.push({ spec: m[1], typeOnly: false });
    for (const m of src.matchAll(REQUIRE_RE)) refs.push({ spec: m[1], typeOnly: false });
  } catch {
    // unreadable — treat as no imports
  }
  importCache.set(file, refs);
  return refs;
}

const useServerCache = new Map<string, boolean>();
/** Does `file` open with a module-level `"use server"` directive? Cached per file; unreadable = false. */
function isUseServer(file: string): boolean {
  const cached = useServerCache.get(file);
  if (cached !== undefined) return cached;
  let result = false;
  try {
    result = isModuleDirective(readFileSync(file, "utf8"), "use server");
  } catch {
    result = false;
  }
  useServerCache.set(file, result);
  return result;
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
  while (queue.length) {
    const { file, trail } = queue.shift()!;
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

describe("server/client import boundary", () => {
  const allFiles = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)));
  const clientEntries = allFiles.filter((f) => isModuleDirective(readFileSync(f, "utf8"), "use client"));
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
