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
