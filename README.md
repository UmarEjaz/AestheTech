# AestheTech - Salon Management Application

A comprehensive salon management system designed to automate and streamline salon operations.

## Features

- **Sales Management**: Track services and product sales with automated invoicing
- **Appointment Scheduling**: Comprehensive calendar-based booking system
- **Client Management**: Maintain detailed client profiles with service history
- **Staff Scheduling**: Manage staff schedules and availability
- **Reports & Dashboard**: Business intelligence and analytics
- **Loyalty Points**: Customer retention through points-based rewards
- **Role-Based Access**: Multi-level user permissions (Super Admin, Owner, Admin, Staff, Receptionist)

## Tech Stack

- **Frontend**: Next.js 15, React, TypeScript, ShadCN/UI, Tailwind CSS
- **Backend**: Next.js API Routes, Server Actions, Prisma ORM
- **Database**: PostgreSQL
- **Authentication**: NextAuth.js with RBAC
- **Validation**: Zod
- **Testing**: Vitest with React Testing Library (unit/component) + Playwright (E2E)
- **Deployment**: Railway
- **CI/CD**: GitHub Actions

## Getting Started

### Prerequisites

- Node.js 18+ (latest LTS recommended)
- PostgreSQL 14+
- npm or yarn

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd AestheTech
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
```

Edit `.env` and add your database URL and other required variables.

4. **Set up the database**
```bash
# Generate Prisma Client
npm run db:generate

# Push the schema + apply constraints (dev path — no migrations)
npm run db:push

# Seed database (optional)
npm run db:seed
```

5. **Install the git hooks (one-time)**
```bash
npm run hooks:install
```
This points git at `.githooks/` (it sets `core.hooksPath`, so any hooks you had in `.git/hooks/` stop running), and the pre-commit hook then runs the changed-line lint gate. Set `SKIP_LINT=1` to bypass it in an emergency.

6. **Run the development server**
```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) to view the application.

## Development

### Available Scripts

- `npm run dev` - Start development server (port 3001)
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint across the repo (`eslint . --max-warnings 0`)
- `npm run lint:changed` - Lint only the lines this branch changed
- `npm run type-check` - Run TypeScript compiler check
- `npm test` - Run Vitest unit/component tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage report
- `npm run test:e2e` - Run Playwright end-to-end tests
- `npm run hooks:install` - Point git at `.githooks/` (one-time, per clone)

### Project Structure

```
AestheTech/
├── app/                    # Next.js App Router (routes, layouts, pages)
├── components/             # React components
├── lib/                    # Utility functions, server actions, shared code
├── prisma/                 # Database schema, seed, constraints.sql
├── e2e/                    # Playwright end-to-end specs
├── docs/                   # Project documentation
│   ├── PROJECT_OVERVIEW.md # Detailed requirements and scope
│   ├── TASK_LIST.md        # Development task tracking
│   └── ARCHITECTURE.md     # System architecture and design
├── scripts/                # Utility scripts
│   └── testing/            # Test automation scripts
├── public/                 # Static assets
├── CLAUDE.md               # AI development context
└── START_HERE.md           # Getting started guide
```

## Documentation

Comprehensive documentation is available in the `/docs` directory:

- **[PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)** - Complete project scope, features, and requirements
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture, database design, and technical decisions
- **[TASK_LIST.md](docs/TASK_LIST.md)** - Development task list with progress tracking
- **[CLAUDE.md](CLAUDE.md)** - AI-assisted development context and guidelines
- **[START_HERE.md](START_HERE.md)** - Initial setup guide and first steps

## Testing

Run the complete test suite:

```bash
# Run all tests
bash scripts/testing/run-tests.sh

# Run specific test suites
bash scripts/testing/test-db.sh        # Database tests
bash scripts/testing/test-api.sh       # API tests
bash scripts/testing/test-components.sh # Component tests
```

## Database

### Prisma Commands

During development the database is disposable, so schema changes go through `db push` (which also applies `prisma/constraints.sql`). Migration files are not used until the app is live with real customer data — see the Database Guidelines in `CLAUDE.md`.

```bash
# Generate Prisma Client
npm run db:generate

# Push schema changes + apply constraints (the dev path)
npm run db:push

# Open Prisma Studio (database GUI)
npm run db:studio

# Rebuild the local database from scratch (⚠️ deletes all local data)
npx prisma db push --force-reset && npm run db:constraints && npm run db:seed
```

## Deployment

The application is configured for deployment on Railway:

1. Push to GitHub
2. Connect Railway to your repository
3. Add environment variables in Railway dashboard
4. Deploy automatically on push to main

See `/docs/ARCHITECTURE.md` for detailed deployment instructions.

## User Roles

- **Super Admin**: Full system access across all salons
- **Owner**: Full access to their salon
- **Admin**: Operational management access
- **Staff**: Limited access to personal schedule and client info
- **Receptionist**: Front desk operations (appointments, sales, check-ins)

## Features Roadmap

### Phase 1 (Current) - MVP
- ✅ Project setup and foundation
- ✅ Authentication and authorization
- ✅ Client management
- ✅ Appointment scheduling
- ✅ Sales and invoicing
- ✅ Reports and dashboard
- ✅ Loyalty points system

### Phase 2 (Planned)
- Inventory management
- SMS notifications
- Online booking portal
- Mobile app
- Advanced analytics
- Commission tracking

### Phase 3 (Future)
- Marketing automation
- Client reviews
- AI recommendations
- Accounting integration
- Payroll management

## Contributing

This project is developed with AI assistance (Claude Code). See `CLAUDE.md` for AI development guidelines.

## Security

- Password hashing with bcrypt
- JWT-based authentication
- Role-based access control (RBAC)
- Input validation with Zod
- SQL injection prevention (Prisma ORM)
- XSS prevention (React auto-escaping)
- CSRF protection (Next.js built-in)

## Performance

- Server-side rendering (SSR)
- Static generation where possible
- Image optimization (next/image)
- Code splitting and lazy loading
- Database query optimization
- Caching strategies

## Support

For issues and questions:
- Check the documentation in `/docs`
- Review `CLAUDE.md` for development guidelines
- Check the task list in `/docs/TASK_LIST.md`

## License

[Add your license here]

## Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- UI components from [ShadCN/UI](https://ui.shadcn.com/)
- Database ORM by [Prisma](https://www.prisma.io/)
- Authentication by [NextAuth.js](https://next-auth.js.org/)

---

**Status**: In Development
**Version**: 0.1.0
**Last Updated**: 2025-11-12
