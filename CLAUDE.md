# AestheTech - Salon Management Application

## Working with Claude

This section governs how Claude works in this repo, and applies to every session. **Ask before making any changes** (rule 1).

**Context:** this app is local-only today. There is no staging or production environment yet, the database is disposable, and deployment is coming soon. The rules below that mention staging or production take effect the day those environments exist.

1. **Ask before any code or git change.** Approving a code change is not approval to commit. Commit and push each need their own explicit go-ahead every time — never bundled into an "apply this?" question. Never open a PR unless I say "open PR". Never merge — I merge every PR myself.
2. **No AI attribution anywhere.** No `Co-Authored-By` trailer in commits and no "Generated with Claude Code" footer in PR descriptions, even when the tooling asks for it.
3. **Never post on GitHub.** No PR comments, review replies, or issue comments. Draft the text and hand it to me; I post it.
4. **Databases.** The local Postgres is fine to use by default. From the day a staging or production database exists, never connect to, query, or write it without asking me first, every time. Production is read-only for Claude even with consent: write the exact command and I run it myself.
5. **Never print secret values.** No env var values, tokens, keys, or connection strings in replies — variable names only.
6. **Verify before speaking.** Run the grep, read, or test first, then state facts about the repo, config, or environment. Never answer from memory of an earlier run.
7. **Don't punt related work to a follow-up PR.** Split only for a hard blocker — a product decision I haven't made, data cleanup on a live database, or consent not yet given — and name the blocker.
8. **"Deployed" means verified live.** Once the app is deployed, "deployed" means you loaded the live site and saw the feature there. A merge is not a deploy. Otherwise say "merged, deploy pending verification".
9. **Notifications.** There is no notification system yet — it is planned. Until it exists, every feature plan includes a **Notifications** line listing the events a salon user would want to be told about (an assignment, a reply, a failure, a decision waiting) so they are wired up when the system lands, or says why there are none. Once the system exists, the line says which events notify whom, and every feature with such an event must raise one.
10. **Salon scoping.** `salonId` is resolved from the signed-in actor in `lib/auth-helpers.ts`; there are no literal salon ids in the app. Keep it that way: never hardcode `salonId` or any id that scopes data to a salon, resolve it from the actor on every call, every write to a salon-scoped table sets `salonId`, and flag any literal salon id in review.
11. **Timestamps.** The app stores UTC and formats through `lib/utils/timezone.ts` in the salon's timezone; server actions do not pre-format dates. Keep it that way: the server sends ISO strings, the browser formats them in the salon timezone, and UTC is shown only when the label says UTC.
12. **Branches.** Use `feature/`, `fix/`, `chore/`, `refactor/` prefixes (what the repo already uses). Never rename a branch after its PR opens.

## Gates before every commit

Every PR passes all of these, no exceptions.

- **TypeScript:** `npx tsc --noEmit` prints nothing. It is clean today — keep it at zero.
- **ESLint, whole repo:** `npm run lint` runs `eslint . --max-warnings 0` and passes. Rules in force: `@typescript-eslint/no-explicit-any` (error) and `no-console` (error; `console.warn`/`console.error` allowed, and off in the CLI scripts under `scripts/**`, `prisma/**` and root-level `*.mjs`, which print by design).
- **Return types — ratcheted, not a big-bang.** `@typescript-eslint/explicit-function-return-type` is OFF in the whole-repo config today, because ~500 existing functions lack a return type (exact count tracked in `docs/KNOWN_ISSUES.md`). It is enforced two ways so the backlog only shrinks: (1) the changed-line floor below requires a return type on every line a change adds or modifies, so the backlog never grows; (2) the touched-file rule below requires return types on **every** function in any file a PR touches, so the backlog shrinks per PR.
- **Changed-line floor (pre-commit):** `npm run lint:changed` (`scripts/lint-changed.mjs`) lints only the lines a change adds or modifies — the whole ESLint ruleset plus `explicit-function-return-type` — and fails on findings sitting on those lines. The pre-commit hook runs `--staged`; set `SKIP_LINT=1` only as an emergency escape.
- **Touched files leave clean (PR standard):** any file a PR touches leaves with **zero** eslint problems across the whole file, pre-existing ones included — there is no legacy-file exception, and this includes adding a return type to every function in the file. Before every commit, run `node scripts/lint-changed.mjs --whole-file` (or `npx eslint --max-warnings 0 <every changed file>` with the return-type rule on) and fix whatever it reports.
- **Server code never reaches a client component:** a Vitest test walks the real import graph from every file containing `"use client"` and fails if any path reaches `@/lib/prisma`, `@prisma/client` (any entry point or subpath, including the generated `.prisma/client`), `server-only`, or a Node builtin (with or without the `node:` prefix). Shared constants and Zod schemas used by browser code live in browser-safe modules.
- **File size:** new files stay under 500 lines and new components under 200. A touched file already over the limit must not grow; the PR either splits it or says why not. Current offenders are the shrink backlog in `docs/KNOWN_ISSUES.md`.
- **Tests:** every PR adds or updates Vitest tests for the behaviour it changes, and a Playwright spec when it changes a critical flow (booking, checkout, invoicing). The coverage floor in `vitest.config.mts` only rises — never lower it. The thresholds have `autoUpdate` on, so `npm run test:coverage` rewrites them to the newly measured numbers whenever coverage improves; a PR that adds tests commits that updated config so the floor only ever climbs, and never leaves it where it was. CI enforces this: after the coverage run it fails if `vitest.config.mts` was rewritten, i.e. the raised floor wasn't committed. After rebasing onto `main`, re-run `npm run test:coverage` and commit the config if it changed (another merged PR may have raised coverage). Node 24 (`.nvmrc`) locally and in CI, so the numbers match.
- **CI actions:** every `uses:` in `.github/workflows/*.yml` is pinned to a full commit SHA with the version in a trailing comment, never a moving tag like `@v4`. Dependabot (`.github/dependabot.yml`) opens one grouped PR a month when newer versions exist; review and merge it like any other PR rather than editing SHAs by hand.
- **Review:** before every commit and push (including small follow-up fix commits), run the `coderabbit:code-reviewer` agent on the whole branch diff against `origin/main` plus uncommitted changes, fix every finding, re-run until clean, then run the gates, then ask me for the commit go-ahead. After the push, GitHub CodeRabbit reviews the PR; present each finding to me as **Issue / Legitimacy / CodeRabbit's suggested fix / Your fix if better / Recommended**, then wait for my pick. For a finding that is wrong, draft the reply and I post it. I merge.

## Project Context

This is a comprehensive Salon Management Application designed to automate and streamline salon operations. The system manages sales, invoices, appointments, staff schedules, client information, reports, and customer loyalty points.

## Technology Stack

- **Frontend**: Next.js (latest stable), React, TypeScript, ShadCN/UI (purple theme), Tailwind CSS
- **Backend**: Node.js (latest stable), Express (if needed), Prisma ORM
- **Database**: PostgreSQL
- **Auth**: NextAuth.js with Role-Based Access Control
- **Validation**: Zod schemas for all inputs
- **CI/CD**: GitHub Actions
- **Deployment**: Railway
- **Architecture**: Next.js App Router, server actions, modular structure
- **Design**: Mobile-first, fully responsive, light/dark mode

## User Roles

1. **Super Admin** - Full system access, manages all salons
2. **Owner** - Salon owner, full access to their salon
3. **Admin** - Administrative tasks, manage staff and clients
4. **Staff** - Service providers, view schedules and client info
5. **Receptionist** - Front desk operations, appointments, check-ins

## Core Features

- Sales management (services and products)
- Invoice generation and tracking
- Appointment scheduling and management
- Staff schedule management
- Client information management (contacts, preferences, history, notes)
- Reports and analytics dashboard
- Customer loyalty points system

## Project Structure

```
/
├── app/                   # Next.js App Router (routes, layouts, pages)
├── components/            # React components
├── lib/                   # Utility functions, server actions, shared code
├── prisma/               # Database schema, seed, constraints.sql
├── e2e/                  # Playwright end-to-end specs
├── docs/                 # All project documentation
│   ├── PROJECT_OVERVIEW.md  # Detailed project scope and requirements
│   ├── TASK_LIST.md        # Development tasks with progress tracking
│   └── ARCHITECTURE.md     # System architecture and design decisions
├── scripts/              # Utility scripts
│   └── testing/          # Test scripts and utilities
└── public/               # Static assets
```

## Important Development Guidelines

### IMPORTANT: Code Quality Standards

- **TypeScript First**: All code must be fully typed. No `any` types unless absolutely necessary with proper justification
- **Validation**: Use Zod schemas for all user inputs, API requests, and external data
- **Security**: Implement proper authentication checks on all protected routes and API endpoints
- **Error Handling**: Always implement proper error handling with user-friendly messages
- **Accessibility**: Follow WCAG 2.1 AA standards for all UI components
- **Performance**: Optimize for mobile devices, lazy load components when appropriate

### IMPORTANT: Next.js Best Practices

- Use App Router (not Pages Router)
- Implement Server Components by default, Client Components only when needed
- Use Server Actions for data mutations
- Implement proper loading and error states
- Use dynamic imports for code splitting
- Optimize images with next/image

### IMPORTANT: Database Guidelines

All schema changes update `prisma/schema.prisma`, add indexes for frequently queried fields, and define relations with cascade rules. Update the seed file when adding new tables or required data.

How schema changes reach a database depends on which stage we are in. The stages are written down here before they arrive so the policy is clear:

- **Stage 1 — now, development.** Local Postgres only. The database is disposable, so schema changes go through `npm run db:push` (a schema push plus `prisma/constraints.sql`). A destructive change needs my go-ahead and this exact command: `npx prisma db push --accept-data-loss && npm run db:constraints` (passing the flag through `npm run db:push -- …` does **not** work — npm appends it to the trailing `db:constraints` step, not to `prisma db push`). **Migration files are not created.**
- **Stage 2 — deployed, before the first paying salon.** Staging and production exist, still `db push`, but only I run it against them, and only after you ask for my consent each time. Every schema change gets a **"Database"** block in the PR description saying it must be applied to the deployed database *before* the code deploys — because Railway auto-deploy does not run schema changes. Additive columns count too: a missing nullable column still breaks every query that selects it.
- **Stage 3 — live with a salon whose data a `db push` could damage.** `db push` stops for that database. Either switch to `prisma migrate` (`migrate dev` locally, `migrate deploy` on the server), or use hand-written idempotent SQL files in `prisma/sql/<YYYYMMDD>_<name>.sql` applied with `prisma db execute`, plus an append-only ledger in `ops/runbooks/prod-db-changes.md` (date, what, exact file, who authorized, verify result, rollback). The choice is made when stage 3 arrives. **Do not create the ledger or the `prisma/sql/` folder now.**

The E2E safety guard `scripts/testing/guard-e2e-db.mjs` stays in place: it blocks the test suite from running against a `prod`/`production` database and requires `E2E_ALLOW_NONLOCAL_DB=1` for any non-local DB.

### IMPORTANT: Authentication & Authorization

- Use NextAuth.js for all authentication
- Implement Role-Based Access Control (RBAC) for all protected routes
- Check user permissions in Server Actions and API routes
- Never expose sensitive data in client components
- Implement session validation on every protected request

### IMPORTANT: UI/UX Guidelines

- **Theme**: Use purple as the primary brand color throughout
- **Components**: Use ShadCN/UI components exclusively
- **Responsive**: Mobile-first design, test on mobile viewport first
- **Dark Mode**: Support both light and dark themes
- **Loading States**: Show loading indicators for all async operations
- **Error States**: Display clear, actionable error messages

### IMPORTANT: Friction-Free UX (HARD RULE)

This app MUST be super user-friendly for non-technical salon staff. Nothing confusing, nothing cumbersome — every flow smooth, obvious, and friendly. Apply this as a checklist when building OR testing any feature:

- **Actions where users expect them**: if a user might do X while doing Y, offer X inline in the Y flow (e.g. take a deposit *while booking*, not only after). Never rely on the user guessing they must click into something to find an action.
- **No forced detours**: don't make a multi-step "create first, then go elsewhere" flow when one screen can do it. Keep optional steps optional but available in-place.
- **Instant feedback**: after any mutation the UI must immediately reflect the new state — re-derive open modals/cards from live data, never show stale snapshots.
- **Specific, reassuring toasts**: "$10.00 deposit recorded for Jennifer Smith", not "Deposit recorded".
- **Surface money/balance/status info early and prominently**, not buried behind another click.
- **Clean layouts**: avoid overly long/cramped modals; group sensibly and keep content scannable.

## Common Commands

### Development
```bash
npm run dev              # Start development server
npm run build           # Build for production
npm run start           # Start production server
npm run lint            # Run ESLint
npm run type-check      # Run TypeScript compiler check
```

### Database
```bash
npm run db:generate     # Generate Prisma Client
npm run db:push         # Apply schema changes + re-run constraints.sql (the dev path; no migrations)
npm run db:studio       # Open Prisma Studio GUI
npm run db:seed         # Seed database with test data
```

### Testing
```bash
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Generate coverage report
bash scripts/testing/run-tests.sh  # Run custom test suite
```

### Deployment
```bash
npm run build           # Build production bundle
```

Deployment is Railway auto-deploy on push to `main`. Note: Railway does **not** run schema changes — apply those first per the Database Guidelines above.

## File Naming Conventions

- **Components**: PascalCase (e.g., `ClientCard.tsx`, `AppointmentForm.tsx`)
- **Utilities**: camelCase (e.g., `formatDate.ts`, `calculatePoints.ts`)
- **API Routes**: kebab-case (e.g., `route.ts` in `/app/api/appointments/route.ts`)
- **Types**: PascalCase with descriptive names (e.g., `ClientProfile`, `AppointmentStatus`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_APPOINTMENTS_PER_DAY`)

## Git Workflow

- **Main Branch**: `main` (protected, requires PR)
- **Feature Branches**: `feature/descriptive-name`
- **Bug Fixes**: `fix/descriptive-name`
- **Chores**: `chore/descriptive-name`
- **Refactors**: `refactor/descriptive-name`
- **Commit Messages**: One plain sentence in past tense describing what changed (e.g. "Applied CodeRabbit review fixes: ..."). No type prefixes (`feat:`, `fix:`, `docs:`) and no AI-attribution trailer.

## Testing Strategy

- **Unit Tests**: Test individual functions and components
- **Integration Tests**: Test API routes and database operations
- **E2E Tests**: Test critical user flows (appointments, sales, invoicing)
- **Coverage Target**: Aim for 80% code coverage minimum

## Environment Variables

YOU MUST create a `.env` file with the following variables:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/aesthetech"

# NextAuth
NEXTAUTH_URL="http://localhost:3001"
NEXTAUTH_SECRET="your-secret-key"

# Application
NODE_ENV="development"
```

## Documentation References

- **Overview**: `/docs/PROJECT_OVERVIEW.md` - Detailed project scope
- **Tasks**: `/docs/TASK_LIST.md` - Track development progress
- **Architecture**: `/docs/ARCHITECTURE.md` - System design and decisions

## Common Troubleshooting

### Prisma Issues
- If Prisma Client errors occur, run `npm run db:generate`
- To rebuild the local disposable database from scratch: `npx prisma db push --force-reset && npm run db:constraints && npm run db:seed` (WARNING: deletes all local data)

### TypeScript Errors
- Run `npm run type-check` to see all type errors
- Check `tsconfig.json` for proper path aliases

### Build Errors
- Clear `.next` folder and rebuild
- Check for missing environment variables
- Verify all dependencies are installed

## AI Development Notes

- **Always** check `/docs/TASK_LIST.md` before starting new work
- **Update** task list with checkmarks as you complete tasks
- **Reference** `/docs/ARCHITECTURE.md` when making design decisions
- **Follow** the tech stack strictly - no substitutions without discussion
- **Test** your code before marking tasks complete
- **Document** any new patterns or decisions in appropriate docs

## Quick Start for Claude

1. Read `/docs/PROJECT_OVERVIEW.md` for full project context
2. Check `/docs/TASK_LIST.md` for current tasks
3. Review `/docs/ARCHITECTURE.md` for system design
4. Start with the first unchecked task
5. Update documentation as you progress
