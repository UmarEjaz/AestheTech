# AestheTech - System Architecture

## Table of Contents
1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture Patterns](#architecture-patterns)
4. [Database Design](#database-design)
5. [API Design](#api-design)
6. [Authentication & Authorization](#authentication--authorization)
7. [Security Architecture](#security-architecture)
8. [Performance Optimization](#performance-optimization)
9. [Deployment Architecture](#deployment-architecture)
10. [Design Decisions](#design-decisions)

---

## System Overview

AestheTech follows a modern, full-stack Next.js architecture with a focus on:
- **Server-Side Rendering (SSR)** for optimal performance
- **Server Actions** for mutations to reduce API overhead
- **Type Safety** throughout the entire stack
- **Mobile-First Design** for optimal mobile experience
- **Role-Based Access Control** for security

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client Layer                        │
│  (Next.js App Router + React + TypeScript + ShadCN/UI)    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTP/HTTPS
                     │
┌────────────────────▼────────────────────────────────────────┐
│                    Application Layer                        │
│         (Next.js Server Components + Server Actions)        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Auth Layer   │  │ Business     │  │ API Routes   │     │
│  │ (NextAuth.js)│  │ Logic        │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Prisma Client
                     │
┌────────────────────▼────────────────────────────────────────┐
│                     Data Layer                              │
│                 (PostgreSQL Database)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Users │ Clients │ Appointments │ Sales │ Invoices  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend
- **Next.js 14+**: React framework with App Router
- **React 18+**: UI library
- **TypeScript 5+**: Type safety
- **ShadCN/UI**: Component library (Radix UI + Tailwind)
- **Tailwind CSS**: Utility-first CSS framework
- **React Hook Form**: Form management
- **Zod**: Schema validation
- **date-fns**: Date manipulation

### Backend
- **Next.js API Routes**: RESTful endpoints
- **Next.js Server Actions**: Type-safe mutations
- **Prisma**: ORM and database toolkit
- **NextAuth.js**: Authentication library
- **bcrypt**: Password hashing

### Database
- **PostgreSQL 14+**: Primary database
- **Prisma Migrate**: Schema migrations

### Development Tools
- **TypeScript**: Language
- **ESLint**: Linting
- **Prettier**: Code formatting
- **Jest**: Unit testing
- **React Testing Library**: Component testing
- **GitHub Actions**: CI/CD

### Deployment
- **Railway**: Hosting platform
- **PostgreSQL on Railway**: Database hosting
- **GitHub**: Version control and CI/CD trigger

---

## Architecture Patterns

### 1. Next.js App Router Pattern

We use the Next.js App Router (not Pages Router) for:
- Better performance with React Server Components
- Improved data fetching with async/await
- Simplified routing with file-system based routing
- Built-in layouts and loading states

**Directory Structure**:
```
src/app/
├── (auth)/              # Auth-related pages (login, register)
│   ├── login/
│   └── layout.tsx
├── (dashboard)/         # Protected dashboard pages
│   ├── clients/
│   ├── appointments/
│   ├── sales/
│   ├── invoices/
│   ├── schedule/
│   ├── reports/
│   └── layout.tsx       # Dashboard layout with sidebar
├── api/                 # API routes
│   ├── clients/
│   ├── appointments/
│   └── auth/
└── layout.tsx           # Root layout
```

### 2. Server Components First

**Default**: All components are Server Components unless they need interactivity.

**Use Client Components (`'use client'`) only when**:
- Using React hooks (useState, useEffect, etc.)
- Using browser APIs
- Event handlers (onClick, onChange, etc.)
- Using context providers

### 3. Server Actions for Mutations

Instead of API routes for mutations, we use Server Actions:

```typescript
// actions/clients.ts
'use server'

export async function createClient(data: ClientFormData) {
  const session = await getServerSession()
  if (!session) throw new Error('Unauthorized')

  // Validate with Zod
  const validated = clientSchema.parse(data)

  // Create in database
  const client = await prisma.client.create({
    data: validated
  })

  revalidatePath('/dashboard/clients')
  return client
}
```

**Benefits**:
- Type-safe (TypeScript end-to-end)
- No need to define API routes
- Automatic revalidation
- Better developer experience

### 4. Layered Architecture

```
Presentation Layer (UI Components)
        ↓
Business Logic Layer (Server Actions/Services)
        ↓
Data Access Layer (Prisma ORM)
        ↓
Database (PostgreSQL)
```

---

## Database Design

### Entity Relationship Diagram

```
┌──────────────┐         ┌──────────────┐
│    User      │         │   Client     │
├──────────────┤         ├──────────────┤
│ id           │         │ id           │
│ email        │         │ firstName    │
│ password     │         │ lastName     │
│ role         │    ┌────│ email        │
│ firstName    │    │    │ phone        │
│ lastName     │    │    │ birthday     │
└──────┬───────┘    │    │ notes        │
       │            │    │ preferences  │
       │            │    │ allergies    │
       │            │    │ createdAt    │
       │            │    └──────┬───────┘
       │            │           │
       │            │           │ 1:N
       │            │           │
       │    ┌───────▼───────┐   │
       │    │  Appointment  │◄──┘
       │    ├───────────────┤
       │    │ id            │
       └────│►clientId      │
            │ serviceId     │
        ┌───│►staffId       │
        │   │ startTime     │
        │   │ endTime       │
        │   │ status        │
        │   │ notes         │
        │   └───────────────┘
        │
        │   ┌──────────────┐
        │   │   Service    │
        │   ├──────────────┤
        │   │ id           │
        │   │ name         │
        │   │ description  │
        │   │ duration     │
        │   │ price        │
        │   │ points       │
        │   │ category     │
        │   └──────────────┘
        │
        │   ┌──────────────┐
        │   │    Sale      │
        │   ├──────────────┤
        │   │ id           │
        │   │ clientId     │
        │   │ staffId      │
        │   │ totalAmount  │
        │   │ discount     │
        │   │ finalAmount  │
        │   │ createdAt    │
        │   └──────┬───────┘
        │          │
        │          │ 1:N
        │          │
        │   ┌──────▼───────┐       ┌──────────────┐
        │   │  SaleItem    │       │   Invoice    │
        │   ├──────────────┤       ├──────────────┤
        │   │ id           │       │ id           │
        │   │ saleId       │       │ saleId       │
        │   │ serviceId    │       │ invoiceNumber│
        │   │ quantity     │       │ clientId     │
        │   │ price        │       │ amount       │
        │   │ staffId      │       │ tax          │
        │   └──────────────┘       │ total        │
        │                          │ status       │
        │   ┌──────────────┐       │ issuedAt     │
        │   │  Schedule    │       └──────┬───────┘
        │   ├──────────────┤              │
        └───│►staffId      │              │ 1:N
            │ dayOfWeek    │              │
            │ startTime    │       ┌──────▼───────┐
            │ endTime      │       │   Payment    │
            │ shiftType    │       ├──────────────┤
            │ isAvailable  │       │ id           │
            └──────────────┘       │ invoiceId    │
                                   │ amount       │
┌──────────────────┐               │ method       │
│  LoyaltyPoints   │               │ paidAt       │
├──────────────────┤               └──────────────┘
│ id               │
│ clientId         │
│ balance          │
│ tier             │
└──────────────────┘
        │
        │ 1:N
        │
┌───────▼──────────────────┐
│  LoyaltyTransaction      │
├──────────────────────────┤
│ id                       │
│ clientId                 │
│ saleId (optional)        │
│ points                   │
│ type (earned/redeemed)   │
│ description              │
│ createdAt                │
└──────────────────────────┘
```

### Prisma Schema

```prisma
// User model for staff/admin accounts
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String
  role      Role
  firstName String
  lastName  String
  phone     String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  appointments  Appointment[] @relation("StaffAppointments")
  schedules     Schedule[]
  sales         Sale[]
  saleItems     SaleItem[]

  @@map("users")
}

enum Role {
  SUPER_ADMIN
  OWNER
  ADMIN
  STAFF
  RECEPTIONIST
}

// Client model for customers
model Client {
  id          String   @id @default(cuid())
  firstName   String
  lastName    String
  email       String?
  phone       String   @unique
  birthday    DateTime?
  address     String?
  notes       String?
  preferences String?
  allergies   String?
  tags        String[]
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  appointments        Appointment[]
  sales               Sale[]
  invoices            Invoice[]
  loyaltyPoints       LoyaltyPoints?
  loyaltyTransactions LoyaltyTransaction[]

  @@map("clients")
}

// Service model
model Service {
  id          String   @id @default(cuid())
  name        String
  description String?
  duration    Int      // in minutes
  price       Decimal  @db.Decimal(10, 2)
  points      Int      @default(0) // loyalty points earned
  category    String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  appointments Appointment[]
  saleItems    SaleItem[]

  @@map("services")
}

// Appointment model
model Appointment {
  id        String            @id @default(cuid())
  clientId  String
  serviceId String
  staffId   String
  startTime DateTime
  endTime   DateTime
  status    AppointmentStatus @default(SCHEDULED)
  notes     String?
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt

  // Relations
  client  Client  @relation(fields: [clientId], references: [id], onDelete: Cascade)
  service Service @relation(fields: [serviceId], references: [id])
  staff   User    @relation("StaffAppointments", fields: [staffId], references: [id])

  @@index([clientId])
  @@index([staffId])
  @@index([startTime])
  @@map("appointments")
}

enum AppointmentStatus {
  SCHEDULED
  CONFIRMED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  NO_SHOW
}

// Sale model
model Sale {
  id          String   @id @default(cuid())
  clientId    String
  staffId     String
  totalAmount Decimal  @db.Decimal(10, 2)
  discount    Decimal  @default(0) @db.Decimal(10, 2)
  finalAmount Decimal  @db.Decimal(10, 2)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  client              Client               @relation(fields: [clientId], references: [id])
  staff               User                 @relation(fields: [staffId], references: [id])
  items               SaleItem[]
  invoice             Invoice?
  loyaltyTransactions LoyaltyTransaction[]

  @@index([clientId])
  @@index([staffId])
  @@index([createdAt])
  @@map("sales")
}

// SaleItem model (line items)
model SaleItem {
  id        String   @id @default(cuid())
  saleId    String
  serviceId String
  staffId   String   // staff who performed the service
  quantity  Int      @default(1)
  price     Decimal  @db.Decimal(10, 2)
  createdAt DateTime @default(now())

  // Relations
  sale    Sale    @relation(fields: [saleId], references: [id], onDelete: Cascade)
  service Service @relation(fields: [serviceId], references: [id])
  staff   User    @relation(fields: [staffId], references: [id])

  @@index([saleId])
  @@map("sale_items")
}

// Invoice model
model Invoice {
  id            String        @id @default(cuid())
  invoiceNumber String        @unique
  saleId        String        @unique
  clientId      String
  amount        Decimal       @db.Decimal(10, 2)
  tax           Decimal       @default(0) @db.Decimal(10, 2)
  total         Decimal       @db.Decimal(10, 2)
  status        InvoiceStatus @default(PENDING)
  issuedAt      DateTime      @default(now())
  paidAt        DateTime?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  // Relations
  sale     Sale      @relation(fields: [saleId], references: [id])
  client   Client    @relation(fields: [clientId], references: [id])
  payments Payment[]

  @@index([clientId])
  @@index([invoiceNumber])
  @@index([status])
  @@map("invoices")
}

enum InvoiceStatus {
  PENDING
  PAID
  OVERDUE
  CANCELLED
}

// Payment model
model Payment {
  id        String        @id @default(cuid())
  invoiceId String
  amount    Decimal       @db.Decimal(10, 2)
  method    PaymentMethod
  paidAt    DateTime      @default(now())
  createdAt DateTime      @default(now())

  // Relations
  invoice Invoice @relation(fields: [invoiceId], references: [id])

  @@index([invoiceId])
  @@map("payments")
}

enum PaymentMethod {
  CASH
  CARD
  DIGITAL_WALLET
  LOYALTY_POINTS
  OTHER
}

// Schedule model
model Schedule {
  id          String     @id @default(cuid())
  staffId     String
  dayOfWeek   Int        // 0 = Sunday, 6 = Saturday
  startTime   String     // HH:mm format
  endTime     String     // HH:mm format
  shiftType   ShiftType  @default(REGULAR)
  isAvailable Boolean    @default(true)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  // Relations
  staff User @relation(fields: [staffId], references: [id], onDelete: Cascade)

  @@index([staffId])
  @@map("schedules")
}

enum ShiftType {
  OPENING
  CLOSING
  REGULAR
  SPLIT
}

// LoyaltyPoints model
model LoyaltyPoints {
  id        String       @id @default(cuid())
  clientId  String       @unique
  balance   Int          @default(0)
  tier      LoyaltyTier  @default(SILVER)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  // Relations
  client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@map("loyalty_points")
}

enum LoyaltyTier {
  SILVER
  GOLD
  PLATINUM
}

// LoyaltyTransaction model
model LoyaltyTransaction {
  id          String                 @id @default(cuid())
  clientId    String
  saleId      String?
  points      Int
  type        LoyaltyTransactionType
  description String?
  createdAt   DateTime               @default(now())

  // Relations
  client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)
  sale   Sale?  @relation(fields: [saleId], references: [id])

  @@index([clientId])
  @@map("loyalty_transactions")
}

enum LoyaltyTransactionType {
  EARNED
  REDEEMED
  BONUS
  EXPIRED
}
```

### Database Indexes

**Critical indexes for performance**:
- `clientId` on appointments, sales, invoices
- `staffId` on appointments, sales
- `startTime` on appointments (for calendar queries)
- `createdAt` on sales (for reports)
- `invoiceNumber` on invoices (unique, for fast lookups)
- `status` on invoices (for filtering)

---

## API Design

### RESTful API Routes

```
/api/auth/[...nextauth]  # NextAuth.js endpoints

/api/clients
  GET    /api/clients              # List all clients
  POST   /api/clients              # Create new client
  GET    /api/clients/[id]         # Get client by ID
  PATCH  /api/clients/[id]         # Update client
  DELETE /api/clients/[id]         # Delete client
  GET    /api/clients/[id]/history # Get client service history

/api/appointments
  GET    /api/appointments              # List appointments
  POST   /api/appointments              # Create appointment
  GET    /api/appointments/[id]         # Get appointment
  PATCH  /api/appointments/[id]         # Update appointment
  DELETE /api/appointments/[id]         # Cancel appointment
  GET    /api/appointments/staff/[id]   # Get staff schedule

/api/services
  GET    /api/services         # List services
  POST   /api/services         # Create service
  PATCH  /api/services/[id]    # Update service
  DELETE /api/services/[id]    # Delete service

/api/sales
  GET    /api/sales            # List sales
  POST   /api/sales            # Create sale
  GET    /api/sales/[id]       # Get sale details

/api/invoices
  GET    /api/invoices         # List invoices
  GET    /api/invoices/[id]    # Get invoice
  PATCH  /api/invoices/[id]    # Update invoice status
  GET    /api/invoices/[id]/pdf # Generate PDF

/api/reports
  GET    /api/reports/revenue       # Revenue report
  GET    /api/reports/appointments  # Appointment statistics
  GET    /api/reports/staff         # Staff performance

/api/loyalty
  GET    /api/loyalty/[clientId]         # Get client points
  POST   /api/loyalty/[clientId]/redeem  # Redeem points
```

### Server Actions (Preferred for Mutations)

```typescript
// src/actions/clients.ts
'use server'
export async function createClient(data: ClientFormData)
export async function updateClient(id: string, data: ClientFormData)
export async function deleteClient(id: string)

// src/actions/appointments.ts
'use server'
export async function createAppointment(data: AppointmentFormData)
export async function rescheduleAppointment(id: string, newTime: DateTime)
export async function cancelAppointment(id: string)

// src/actions/sales.ts
'use server'
export async function createSale(data: SaleFormData)
export async function processPayment(saleId: string, payments: Payment[])

// src/actions/invoices.ts
'use server'
export async function generateInvoice(saleId: string)
export async function sendInvoiceEmail(invoiceId: string)
```

---

## Authentication & Authorization

### NextAuth.js Configuration

```typescript
// src/lib/auth.ts
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      async authorize(credentials) {
        // Verify credentials with database
        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })

        if (!user) return null

        const isValid = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!isValid) return null

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role
        }
      }
    })
  ],
  session: {
    strategy: 'jwt'
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      session.user.role = token.role
      session.user.id = token.id
      return session
    }
  }
}
```

### Permission Matrix

| Role         | Clients | Appointments | Sales | Invoices | Staff | Schedules | Reports | Settings |
|--------------|---------|--------------|-------|----------|-------|-----------|---------|----------|
| SUPER_ADMIN  | ✓       | ✓            | ✓     | ✓        | ✓     | ✓         | ✓       | ✓        |
| OWNER        | ✓       | ✓            | ✓     | ✓        | ✓     | ✓         | ✓       | ✓        |
| ADMIN        | ✓       | ✓            | ✓     | ✓        | ✓     | ✓         | ✓       | View     |
| STAFF        | View    | View (own)   | Own   | View     | View  | View (own)| Own     | -        |
| RECEPTIONIST | ✓       | ✓            | ✓     | ✓        | View  | View      | View    | -        |

### Authorization Helpers

```typescript
// src/lib/permissions.ts
export function canManageClients(role: Role): boolean {
  return ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'RECEPTIONIST'].includes(role)
}

export function canViewReports(role: Role): boolean {
  return ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'RECEPTIONIST', 'STAFF'].includes(role)
}

export function canManageSettings(role: Role): boolean {
  return ['SUPER_ADMIN', 'OWNER'].includes(role)
}
```

---

## Security Architecture

### Input Validation with Zod

```typescript
// src/lib/validations/client.ts
import { z } from 'zod'

export const clientSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number'),
  birthday: z.date().optional(),
  notes: z.string().max(500).optional(),
  preferences: z.string().max(500).optional(),
  allergies: z.string().max(500).optional()
})

export type ClientFormData = z.infer<typeof clientSchema>
```

### Security Checklist

- ✅ Password hashing with bcrypt
- ✅ JWT-based authentication
- ✅ CSRF protection (built-in with Next.js)
- ✅ Input validation with Zod
- ✅ SQL injection prevention (Prisma ORM)
- ✅ XSS prevention (React auto-escaping)
- ✅ Role-based access control
- ✅ Secure environment variables
- ✅ HTTPS enforcement in production
- ✅ Rate limiting (optional, can use middleware)

---

## Performance Optimization

### 1. Database Optimization
- Use indexes on frequently queried fields
- Implement pagination for large lists
- Use `select` to fetch only needed fields
- Use `include` sparingly to avoid over-fetching

### 2. Caching Strategy
- Cache static data (services, settings)
- Use `revalidate` in Server Components
- Implement stale-while-revalidate for reports
- Redis cache for frequently accessed data (optional)

### 3. Code Splitting
- Dynamic imports for heavy components
- Route-based code splitting (automatic with Next.js)
- Lazy load modals and dialogs

### 4. Image Optimization
- Use `next/image` for all images
- Serve images in WebP format
- Implement responsive images

### 5. Bundle Optimization
- Analyze bundle with `@next/bundle-analyzer`
- Remove unused dependencies
- Use tree-shaking-friendly libraries

---

## Deployment Architecture

### Railway Deployment

```
GitHub Repository
      ↓
  (Push to main)
      ↓
GitHub Actions (CI/CD)
  - Run tests
  - Run linter
  - Build Next.js app
      ↓
    (Deploy)
      ↓
Railway Platform
  - Next.js Application (Web Service)
  - PostgreSQL Database
  - Environment Variables
```

### Environment Variables

```env
# Database
DATABASE_URL="postgresql://..."

# NextAuth
NEXTAUTH_URL="https://aesthetech.app"
NEXTAUTH_SECRET="..."

# Application
NODE_ENV="production"
NEXT_PUBLIC_APP_URL="https://aesthetech.app"

# Email (optional, for notifications)
SMTP_HOST="..."
SMTP_PORT="..."
SMTP_USER="..."
SMTP_PASSWORD="..."
```

---

## Design Decisions

### Why Next.js App Router over Pages Router?
- Better performance with React Server Components
- Improved data fetching patterns
- Built-in loading and error states
- Future-proof architecture

### Why Prisma over other ORMs?
- Type-safe database access
- Great developer experience
- Built-in migration tool
- Excellent TypeScript support

### Why Server Actions over API Routes?
- Type-safe end-to-end
- Less boilerplate
- Better performance (no extra round trip)
- Automatic revalidation

### Why ShadCN/UI over other component libraries?
- Fully customizable (owns the code)
- Accessible out of the box (Radix UI)
- Works seamlessly with Tailwind
- No runtime overhead

### Why PostgreSQL over MySQL/MongoDB?
- Better support for complex queries
- Strong ACID compliance
- Excellent JSON support
- Great performance at scale

### Why Railway over Vercel?
- Full PostgreSQL database included
- Better pricing for database-heavy apps
- Easy scaling
- Good developer experience

---

## Future Considerations

### Scalability
- Implement Redis for caching
- Consider read replicas for database
- Implement CDN for static assets
- Consider queue system for async tasks (BullMQ)

### Monitoring
- Implement error tracking (Sentry)
- Add performance monitoring (Vercel Analytics)
- Set up uptime monitoring
- Implement logging (Winston or Pino)

### Multi-Tenancy
- Design for multiple salon locations
- Tenant isolation at database level
- Subdomain routing per salon

---

*This architecture document should be updated as the system evolves and new decisions are made.*
