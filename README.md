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

- **Frontend**: Next.js 14+, React, TypeScript, ShadCN/UI, Tailwind CSS
- **Backend**: Next.js API Routes, Server Actions, Prisma ORM
- **Database**: PostgreSQL
- **Authentication**: NextAuth.js with RBAC
- **Validation**: Zod
- **Testing**: Jest, React Testing Library
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
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed database (optional)
npx prisma db seed
```

5. **Run the development server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript compiler check
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage report

### Project Structure

```
AestheTech/
├── docs/                    # Project documentation
│   ├── PROJECT_OVERVIEW.md  # Detailed requirements and scope
│   ├── TASK_LIST.md        # Development task tracking
│   └── ARCHITECTURE.md     # System architecture and design
├── scripts/                # Utility scripts
│   └── testing/           # Test automation scripts
├── src/
│   ├── app/               # Next.js app directory (routes)
│   ├── components/        # React components
│   ├── lib/               # Utility functions
│   ├── prisma/            # Database schema and migrations
│   └── types/             # TypeScript type definitions
├── public/                # Static assets
├── tests/                 # Test files
├── CLAUDE.md             # AI development context
└── START_HERE.md         # Getting started guide
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

```bash
# Generate Prisma Client
npx prisma generate

# Create a migration
npx prisma migrate dev --name migration_name

# Apply migrations
npx prisma migrate deploy

# Open Prisma Studio (database GUI)
npx prisma studio

# Reset database (⚠️ deletes all data)
npx prisma migrate reset
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
