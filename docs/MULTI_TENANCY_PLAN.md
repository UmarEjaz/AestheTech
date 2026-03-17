# Multi-Tenancy Implementation Plan

> **Status:** Phases 1-5 Complete, Phase 6 (Testing) Pending
> **Branch:** `feature/multi-tenancy`
> **Estimated effort:** 3-4 weeks
> **Scope:** ~8 new files, ~35 modified files, ~150 query touch-points

---

## Current State

- No `Salon` model, no `salonId` anywhere in the schema
- `Settings` uses `findFirst()` — single global row
- `User.role` is on the User model directly
- Unique constraints (`Client.phone`, `Product.sku`, `Invoice.invoiceNumber`) are global — would collide across salons
- Session carries `{ id, email, role }` — no salon context
- Redis cache keys have no salon scoping
- 18 models total, 14 action files, 5 API routes

---

## Phase 1: Schema Changes (Week 1) — Foundation [DONE]

Everything depends on this phase.

### 1A. New `Salon` Model

```prisma
model Salon {
  id                    String    @id @default(cuid())
  name                  String
  slug                  String    @unique
  address               String?
  phone                 String?
  email                 String?
  logo                  String?
  subscriptionStatus    String    @default("TRIAL") // TRIAL, ACTIVE, SUSPENDED, CANCELLED
  subscriptionPlan      String?   // BASIC, PRO, ENTERPRISE
  subscriptionExpiresAt DateTime?
  isActive              Boolean   @default(true)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  members                      SalonMember[]
  settings                     Settings?
  clients                      Client[]
  services                     Service[]
  products                     Product[]
  appointments                 Appointment[]
  sales                        Sale[]
  invoices                     Invoice[]
  schedules                    Schedule[]
  loyaltyPoints                LoyaltyPoints[]
  loyaltyTransactions          LoyaltyTransaction[]
  recurringAppointmentSeries   RecurringAppointmentSeries[]
  auditLogs                    AuditLog[]

  @@map("salons")
}
```

### 1B. New `SalonMember` Join Table

User-Salon relationship with role. A user can belong to multiple salons (e.g., freelance stylist). `SUPER_ADMIN` stays on User model as a platform-level flag.

```prisma
model SalonMember {
  id        String   @id @default(cuid())
  userId    String
  salonId   String
  role      Role     // OWNER, ADMIN, STAFF, RECEPTIONIST
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  salon Salon @relation(fields: [salonId], references: [id], onDelete: Cascade)

  @@unique([userId, salonId])
  @@index([salonId])
  @@map("salon_members")
}
```

### 1C. User Model Changes

- Remove `role` field (moves to SalonMember)
- Add `isSuperAdmin Boolean @default(false)` — platform-level flag
- Add `salonMembers SalonMember[]` relation
- Keep `email @unique` (users are platform-level entities)

### 1D. Add `salonId` to Tenant-Scoped Models

**Add `salonId` to these 13 models:**

| Model | Notes |
|---|---|
| Client | `phone` unique becomes `@@unique([salonId, phone])` |
| Service | Per-salon services |
| Product | `sku` unique becomes `@@unique([salonId, sku])` |
| Appointment | Per-salon |
| Sale | Per-salon |
| SaleItem | For direct query performance |
| Invoice | `invoiceNumber` unique becomes `@@unique([salonId, invoiceNumber])` |
| Schedule | Per-salon |
| LoyaltyPoints | Per-salon |
| LoyaltyTransaction | Per-salon |
| RecurringAppointmentSeries | Per-salon |
| AuditLog | Per-salon (SUPER_ADMIN logs use `salonId = null`) |
| Settings | Becomes 1:1 with Salon via `salonId @unique` |

**Skip `salonId` on these 4 (accessed only via parent relations):**
Payment, Refund, RecurringSeriesException, RecurringSeriesAuditLog

### 1E. Unique Constraint Changes

| Current (Global) | Becomes (Per-Salon) |
|---|---|
| `Client.phone @unique` | `@@unique([salonId, phone])` |
| `Product.sku @unique` | `@@unique([salonId, sku])` |
| `Invoice.invoiceNumber @unique` | `@@unique([salonId, invoiceNumber])` |
| `User.email @unique` | Stays global |

### 1F. Migration Sequence

```bash
npx prisma migrate dev --name add_salon_model
npx prisma migrate dev --name add_salon_member_model
npx prisma migrate dev --name add_salonId_to_tenant_models  # nullable initially
# Run data migration script to assign existing data to default salon
npx prisma migrate dev --name make_salonId_required_and_update_uniques
npx prisma migrate dev --name remove_role_from_user
```

### 1G. Data Migration Script

1. Create a "Default Salon" record using current Settings data
2. For each existing User: create a `SalonMember` with their current role
3. Set `salonId` on all existing records to the Default Salon's ID
4. Update seed file to create salon + salon members

---

## Phase 2: Auth & Session Changes (Week 1-2) — Everything depends on this [DONE]

### 2A. New Session Shape

```typescript
interface Session {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    salonId: string | null;      // null for SUPER_ADMIN not viewing a salon
    salonRole: Role | null;      // role within current salon
    isSuperAdmin: boolean;
  };
}
```

### 2B. Login Flow

- After credential verification, look up user's `SalonMember` records
- 1 membership → auto-select that salon
- Multiple memberships → redirect to `/select-salon` page
- `isSuperAdmin` → can select any salon or operate at platform level

### 2C. Shared `checkAuth()` Helper

Extract from 14 duplicated `checkAuth()` functions into one `lib/auth-helpers.ts`:

```typescript
async function checkAuth(permission: Permission): Promise<{
  userId: string;
  role: Role;
  salonId: string;
} | null>
```

### 2D. Middleware Changes

- Verify session has valid `salonId` for `/dashboard` routes
- If no `salonId`, redirect to `/select-salon`
- SUPER_ADMIN bypass for `/admin` pages

---

## Phase 3: Query Isolation (Week 2-3) — Largest volume of work [DONE]

Every Prisma query across 14 action files + 5 API routes needs `salonId` in `where` clauses and `create` data.

### 3A. Approach: Manual Filtering

Not using Prisma extensions. Each query explicitly gets `salonId` from the auth result. More verbose but transparent and debuggable.

Optional: Add a dev-only Prisma middleware that warns if a query on a tenant-scoped model is missing `salonId`.

### 3B. File-by-File Changes

| File | Touch-points | Notable changes |
|---|---|---|
| `lib/actions/settings.ts` | 4 | `getSettings(salonId)` via `findUnique` — cascades to 7 callers |
| `lib/actions/dashboard.ts` | 12 | All aggregate queries scoped by salon |
| `lib/actions/sale.ts` | 15 | Invoice number generation becomes salon-scoped |
| `lib/actions/appointment.ts` | 15 | Conflict checks scoped by salon |
| `lib/actions/client.ts` | 10 | Phone duplicate check becomes salon-scoped |
| `lib/actions/invoice.ts` | 12 | Refund transactions scoped |
| `lib/actions/user.ts` | 10 | Major refactor — query via SalonMember joins |
| `lib/actions/service.ts` | 8 | CRUD scoped |
| `lib/actions/product.ts` | 10 | SKU uniqueness check per salon |
| `lib/actions/schedule.ts` | 12 | Staff schedule queries scoped |
| `lib/actions/recurring-series.ts` | 20+ | Most complex file |
| `lib/actions/loyalty.ts` | 6 | Advisory lock key includes salonId |
| `lib/actions/audit.ts` | 4 | Creation and listing scoped |
| `lib/actions/email.ts` | 4 | Settings lookup scoped |

### 3C. API Route Changes

| File | Changes |
|---|---|
| `app/api/ical/appointment/[id]/route.ts` | Salon verification on lookup |
| `app/api/ical/client/[id]/route.ts` | Salon verification |
| `app/api/ical/series/[id]/route.ts` | Salon verification |
| `app/api/cron/expire-points/route.ts` | Iterate over all salons |
| `app/api/upload/route.ts` | Salon-namespaced file paths |

### 3D. Settings Access Pattern

`getSettings()` is called from 7 different action files. Changes from `findFirst()` to:

```typescript
export async function getSettings(salonId: string): Promise<ActionResult<SettingsData>> {
  const settings = await prisma.settings.findUnique({
    where: { salonId },
  });
}
```

Callers: dashboard.ts (2), sale.ts (2), appointment.ts (1), email.ts (2), loyalty.ts (1), invoice.ts (1), recurring-series.ts (2+)

### 3E. Invoice Number Generation

```typescript
async function generateInvoiceNumber(timezone: string, salonId: string): Promise<string> {
  const count = await prisma.invoice.count({
    where: { salonId, createdAt: { gte: start, lte: end } },
  });
}
```

---

## Phase 4: Cache & Permissions (Week 3) [DONE]

### 4A. Cache Key Namespacing

```
# Before
dashboard:stats:{tz}
reports:{tz}:{startISO}:{endISO}

# After
salon:{salonId}:dashboard:stats:{tz}
salon:{salonId}:reports:{tz}:{startISO}:{endISO}
```

### 4B. Salon-Scoped Invalidation

```typescript
export async function invalidateDashboardCache(salonId: string): Promise<void> {
  await scanAndDelete(redis, `salon:${salonId}:*`);
}
```

All 20 mutation call sites pass `salonId`. Other salons' caches remain untouched.

### 4C. Permissions

- `hasPermission()` gets an `isSuperAdmin` param — super admins bypass all checks
- Role comes from SalonMember, not User
- `canManageRole()` hierarchy stays the same, operates on salon-level roles

---

## Phase 5: UI Changes (Week 3-4) [DONE]

### New Pages

| Page | Purpose |
|---|---|
| `/select-salon` | Post-login salon picker for multi-salon users |
| `/admin/salons` | SUPER_ADMIN: list all salons |
| `/admin/salons/new` | SUPER_ADMIN: create salon |
| `/admin/salons/[id]` | SUPER_ADMIN: salon details, subscription management |

### New Components

| Component | Purpose |
|---|---|
| `components/layout/salon-switcher.tsx` | Dropdown in header for multi-salon users / SUPER_ADMIN |

### Existing Page Changes

- Dashboard header shows salon name
- Staff management queries via SalonMember
- Settings page uses scoped `getSettings(salonId)`

---

## Phase 6: Testing (Week 4) [PENDING]

- Tenant isolation: data from Salon A not visible in Salon B
- SUPER_ADMIN cross-salon access
- Salon switching (JWT re-signing)
- Compound unique constraints (same phone in two salons works)
- Expired session handling (old JWTs without `salonId` force re-login)

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Forgotten `salonId` on a query → data leak | Dev-only Prisma middleware that warns/throws |
| Existing sessions break after deploy | Middleware detects missing `salonId`, forces re-login |
| Phone/SKU collisions during migration | Impossible — single-tenant data has no duplicates |
| Performance at scale | Composite indexes `@@index([salonId, createdAt])` partition data |
| JWT size increase | Adding salonId + salonRole is negligible |

---

## Complete File Manifest

### New Files (~8)

1. `lib/auth-helpers.ts` — shared `checkAuth()` with salonId
2. `prisma/data-migration.ts` — script to assign existing data to default salon
3. `app/select-salon/page.tsx` — salon selection after login
4. `app/admin/salons/page.tsx` — SUPER_ADMIN salon list
5. `app/admin/salons/new/page.tsx` — create salon
6. `app/admin/salons/[id]/page.tsx` — salon details
7. `components/layout/salon-switcher.tsx` — salon dropdown
8. `lib/actions/salon.ts` — salon CRUD server actions

### Modified Files (~35)

| File | Nature of change |
|---|---|
| `prisma/schema.prisma` | Add Salon, SalonMember; add salonId to 13 models; update uniques; modify User |
| `prisma/seed.ts` | Create salon, salon members; add salonId to all entities |
| `lib/auth.ts` | Add salonId/salonRole to JWT and session; look up SalonMember |
| `lib/permissions.ts` | Handle isSuperAdmin flag; update hasPermission signature |
| `lib/redis.ts` | Update cache key patterns; invalidation accepts salonId |
| `middleware.ts` | Add salonId validation; redirect to salon selection if missing |
| `lib/actions/dashboard.ts` | Add salonId to all queries; update cache keys |
| `lib/actions/sale.ts` | Add salonId to all queries/creates; salon-scoped invoice numbers |
| `lib/actions/appointment.ts` | Add salonId to all queries; scope conflict checks |
| `lib/actions/client.ts` | Add salonId to all queries; scope phone uniqueness |
| `lib/actions/invoice.ts` | Add salonId to all queries |
| `lib/actions/user.ts` | Major refactor: query via SalonMember; create SalonMember on user creation |
| `lib/actions/service.ts` | Add salonId to all queries |
| `lib/actions/product.ts` | Add salonId to all queries; scope SKU uniqueness |
| `lib/actions/schedule.ts` | Add salonId to all queries |
| `lib/actions/settings.ts` | `getSettings(salonId)` using findUnique; update all callers |
| `lib/actions/loyalty.ts` | Per-salon processing; salon-scoped advisory lock |
| `lib/actions/audit.ts` | Add salonId to creation and listing |
| `lib/actions/recurring-series.ts` | Add salonId to all queries (~20+ touch-points) |
| `lib/actions/email.ts` | Pass salonId through getSettings; scope sale lookups |
| `app/api/ical/appointment/[id]/route.ts` | Salon verification on query |
| `app/api/ical/client/[id]/route.ts` | Salon verification |
| `app/api/ical/series/[id]/route.ts` | Salon verification |
| `app/api/cron/expire-points/route.ts` | Multi-salon iteration |
| `app/api/upload/route.ts` | Salon-namespaced file paths |
| `app/dashboard/page.tsx` | Uses session.user.salonId |
| `app/dashboard/settings/page.tsx` | Uses scoped settings |
| `components/layout/dashboard-layout.tsx` | Show salon name, salon switcher |
| `components/layout/sidebar.tsx` | Show salon context; add SUPER_ADMIN nav items |
| `components/layout/header.tsx` | Salon name display and switcher |

### No Changes Needed

- `lib/prisma.ts` — global client stays as-is
- `lib/types.ts` — no changes
- `lib/validations/*.ts` — salonId comes from session, not user input
- `app/layout.tsx` — no changes

---

## Implementation Order (Critical Path)

```
Phase 1 (Schema) ──→ Phase 2 (Auth) ──→ Phase 3 (Queries) ──→ Phase 4 (Cache/Perms)
                                                                        │
                                                                        ▼
                                                              Phase 5 (UI) ──→ Phase 6 (Testing)
```

Start with `settings.ts` in Phase 3 because 7 other action files depend on `getSettings()`.
