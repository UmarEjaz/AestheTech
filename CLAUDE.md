# AestheTech - Salon Management Application

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
├── docs/                    # All project documentation
│   ├── PROJECT_OVERVIEW.md  # Detailed project scope and requirements
│   ├── TASK_LIST.md        # Development tasks with progress tracking
│   └── ARCHITECTURE.md     # System architecture and design decisions
├── scripts/                # Utility scripts
│   └── testing/           # Test scripts and utilities
├── src/                   # Source code
│   ├── app/              # Next.js app directory
│   ├── components/       # React components
│   ├── lib/              # Utility functions and shared code
│   ├── prisma/           # Database schema and migrations
│   └── types/            # TypeScript type definitions
├── public/               # Static assets
└── tests/                # Test files
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

- **Prisma Schema**: All database changes must update `prisma/schema.prisma`
- **Migrations**: Always create migrations for schema changes: `npx prisma migrate dev --name descriptive_name`
- **Seed Data**: Update seed file when adding new tables or required data
- **Indexes**: Add indexes for frequently queried fields
- **Relations**: Properly define relations with cascade rules

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
npx prisma generate     # Generate Prisma Client
npx prisma migrate dev  # Create and apply migration
npx prisma studio       # Open Prisma Studio GUI
npx prisma db seed      # Seed database with test data
npx prisma db push      # Push schema changes without migration
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
bash scripts/deploy.sh  # Deploy to Railway (if script exists)
```

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
- **Hotfixes**: `hotfix/descriptive-name`
- **Commit Messages**: Use conventional commits format (e.g., `feat:`, `fix:`, `docs:`)

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
NEXTAUTH_URL="http://localhost:3000"
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
- If Prisma Client errors occur, run `npx prisma generate`
- For migration conflicts, reset with `npx prisma migrate reset` (WARNING: deletes all data)

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
