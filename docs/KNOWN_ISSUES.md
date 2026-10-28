# AestheTech - Known Issues & Fixes Needed

> **Usage**: When starting a fix session, paste the relevant prompt below to Claude so it has full context.

---

## Staff Schedule Management

### Issue: No conflict detection for overlapping schedules

**Status**: Not implemented
**Task List Reference**: Line 187 in TASK_LIST.md
**File**: `lib/actions/schedule.ts`

**Problem**: Schedule actions only validate basic fields (time format, day of week). There is no overlap detection between shifts. Two overlapping shifts can be assigned to the same staff member on the same day without any warning or error.

**Example**: Staff member "Sarah" could have:
- Shift 1: Monday 9:00 AM - 1:00 PM
- Shift 2: Monday 12:00 PM - 5:00 PM

These overlap by 1 hour but the system allows it silently.

**Prompt to fix**:
```
In lib/actions/schedule.ts, there is no conflict detection for staff schedules.
When creating or updating a schedule entry, add overlap detection that checks
if the same staff member already has a shift on the same day that overlaps
with the new/updated shift's time range. If a conflict is found, return an
error message like "This shift overlaps with an existing shift for this staff
member on [day]". Check the existing appointment conflict detection in
lib/actions/appointment.ts (checkConflict function around line 174) for
reference on how conflicts are handled in this codebase.
```

---

## Client Management

### Issue: Client filtering by status not implemented

**Status**: Partial — tag filtering and walk-in filtering work, but no status filter
**Task List Reference**: Line 73 in TASK_LIST.md
**Files**: `components/clients/client-search.tsx`, `components/clients/client-table.tsx`

**Problem**: The task says "Implement client filtering (by tags, status)" but only tag filtering and walk-in filtering exist. There is no filter for client status. The Client model only has an `isActive` boolean, not a proper status field. Users cannot filter clients by active/inactive status from the UI.

**Prompt to fix**:
```
In components/clients/client-search.tsx and client-table.tsx, add an
active/inactive status filter for clients. The Client model in
prisma/schema.prisma already has an `isActive` boolean field. Add a
filter dropdown or toggle (similar to the existing tag filter in
client-search.tsx lines 87-113) that lets users filter by:
- All clients (default)
- Active clients only (isActive = true)
- Inactive clients only (isActive = false)
Pass the filter as a URL query parameter and apply it in the client
list query.
```

---

## File-size shrink backlog

**Rule** (see `CLAUDE.md` § Gates before every commit): new files stay under **500 lines**, new
components under **200**. A file already over its limit must not grow — any PR that touches one either
splits it or says why not. This is the list of current offenders to burn down over time; measured off
`main` on 2026-10-28.

### Non-component files over 500 lines
| Lines | File |
|------:|------|
| 1703 | `lib/actions/recurring-series.ts` |
| 1471 | `lib/actions/appointment.ts` |
| 1002 | `lib/actions/payroll.ts` |
| 1001 | `lib/actions/dashboard.ts` |
|  946 | `lib/actions/sale.ts` |
|  839 | `lib/actions/user.ts` |
|  741 | `lib/actions/schedule.ts` |
|  717 | `lib/actions/permission.ts` |
|  707 | `lib/actions/invoice.ts` |
|  655 | `lib/actions/role.ts` |
|  640 | `lib/actions/client.ts` |
|  532 | `lib/utils/recurring.ts` |
|  517 | `lib/actions/salon.ts` |

### Components over 200 lines
| Lines | File |
|------:|------|
| 2295 | `components/appointments/appointment-form.tsx` |
| 1820 | `components/sales/checkout-form.tsx` |
| 1158 | `components/appointments/appointment-calendar.tsx` |
|  922 | `components/appointments/appointment-detail-modal.tsx` |
|  844 | `components/schedules/schedule-week-view.tsx` |
|  822 | `components/settings/settings-form.tsx` |
|  822 | `app/dashboard/settings/roles/roles-client.tsx` |
|  813 | `components/appointments/staff-lane-grid.tsx` |
|  748 | `components/appointments/series-management-panel.tsx` |
|  704 | `components/reports/reports-charts.tsx` |
|  651 | `components/staff/staff-table.tsx` |
|  485 | `components/clients/client-table.tsx` |
|  466 | `app/dashboard/sales/[id]/page.tsx` |
|  439 | `app/dashboard/clients/[id]/page.tsx` |
|  430 | `components/clients/client-form.tsx` |
|  424 | `components/invoices/invoice-pdf.tsx` |
|  414 | `components/categories/category-manager.tsx` |
|  413 | `components/dashboard/dashboard-widgets.tsx` |
|  406 | `components/sales/sales-table.tsx` |
|  389 | `components/staff/staff-form.tsx` |
|  358 | `components/appointments/exception-dates-manager.tsx` |
|  350 | `app/admin/page.tsx` |
|  343 | `app/dashboard/invoices/[id]/page.tsx` |
|  334 | `components/audit/audit-log-client.tsx` |
|  318 | `components/appointments/conflict-resolution-ui.tsx` |
|  317 | `components/reports/report-pdf.tsx` |
|  308 | `components/clients/recurring-series-card.tsx` |
|  305 | `components/staff/user-permissions-editor.tsx` |
|  303 | `components/schedules/schedule-pdf.tsx` |
|  300 | `components/payroll/payroll-run-list.tsx` |
|  299 | `components/appointments/pattern-selector.tsx` |
|  294 | `components/payroll/payroll-entry-table.tsx` |
|  287 | `app/dashboard/branches/[id]/branch-staff-table.tsx` |
|  286 | `components/schedules/schedule-month-view.tsx` |
|  286 | `app/admin/salons/[id]/page.tsx` |
|  283 | `components/products/product-form.tsx` |
|  273 | `components/invoices/invoice-actions.tsx` |
|  262 | `components/clients/loyalty-dashboard.tsx` |
|  260 | `components/sales/refund-dialog.tsx` |
|  257 | `components/invoices/invoice-table.tsx` |

---

## Prisma imports in client components (shrink backlog)

25 modules import a Prisma **enum** (e.g. `PaymentMethod`, `ShiftType`) as a runtime value from
`@prisma/client` and are reachable from a `"use client"` component — 20 client components plus 5 shared
lib modules (`lib/validations/invoice.ts`, `lib/validations/payroll.ts`, `lib/constants/payment-methods.tsx`,
`lib/utils/loyalty.ts`, `lib/utils/recurring.ts`). The architectural guard in
`lib/server-client-boundary.test.ts` blocks any **new** server-code leak into the browser, but tolerates
these 25 known edges via a `BASELINE` so the gate is green today. Entries are keyed by the **importing
file**, so each one pins exactly one edge: a new file, or a new forbidden target in a listed file (e.g.
adding `@/lib/prisma` next to a tolerated enum import), is a new key and fails. The backlog only shrinks:

- When a PR touches one of these files, change it to import the enum/type from a browser-safe module
  (a `@/lib/constants/*` string-union, or `import type` where only a type is needed) instead of
  `@prisma/client`, then delete its entry from `BASELINE` in the test.
- Never add a `BASELINE` entry to make a new leak pass.

The 25 entries live in `BASELINE` in `lib/server-client-boundary.test.ts`; the test fails if any of
them is fixed but still listed, so the list can't silently regrow. (Nothing reachable from a client
component imports the Prisma **client** itself, `server-only`, or a `node:` builtin — those are already
clean and always forbidden.)

---

## Return-type backlog (ratcheted, not a sweep)

`@typescript-eslint/explicit-function-return-type` is OFF in the whole-repo ESLint config because
**497** existing functions lack a return type (measured 2026-10-28 on this branch, the way the gate
measures it — see the command below). It is enforced by `scripts/lint-changed.mjs` instead: required
on every changed line (so this number never grows) and on every function of a touched file under
`--whole-file` (so it shrinks per PR). This number only goes down; re-measure with:

```bash
npx eslint . --rule '{"@typescript-eslint/explicit-function-return-type":["error",{"allowExpressions":true,"allowTypedFunctionExpressions":true,"allowHigherOrderFunctions":true,"allowDirectConstAssertionInArrowFunctions":true}]}' | grep -c explicit-function-return-type
```

---

## Return-type whole-file debt owed on two touched files (one-time exception)

The `chore/working-rules` branch touched two files **only** to delete stale `eslint-disable` lines
that `eslint .` reported (nothing behavioural changed):

- `components/appointments/appointment-calendar.tsx` — **18** functions still missing return types
- `components/sales/checkout-form.tsx` — **27** functions still missing return types

Per the whole-file rule in `CLAUDE.md`, touching a file means adding a return type to every function
in it. These **45** were **deliberately deferred** as a one-time exception for this foundational
branch, because retrofitting them into two large components that are also modified on an in-flight
feature branch would cause avoidable merge conflicts.

**This exception is one-time and applies only to the `chore/working-rules` branch.** It does not
carry forward: the next PR that makes a real change in either file must add return types to the whole
file and delete that file's entry from this list. (The changed-line gate already blocks any *new*
untyped function in the meantime.) This is the only whole-file exception taken on this branch.

Related, for the record: `components/invoices/invoice-pdf.tsx` (already over the 200-line component
limit) grew by **2 lines** on this branch — a type-only `ReactElement` import and a one-line a11y
suppression, both needed to make the lint gate green. Acknowledged here per the "a touched over-limit
file must not grow" rule; no behavioural change.

---
