# AestheTech - Salon Management Application
## Project Overview & Scope

### Executive Summary

AestheTech is a comprehensive Salon Management Application designed to revolutionize how salons operate by automating and streamlining daily operations. The system provides end-to-end management of sales, appointments, staff schedules, client relationships, and business analytics.

### Project Goals

1. **Operational Efficiency**: Reduce manual administrative tasks by 70%
2. **Client Experience**: Improve client satisfaction through better appointment management and personalized service
3. **Business Intelligence**: Provide actionable insights through comprehensive reporting
4. **Staff Productivity**: Streamline staff scheduling and service delivery
5. **Revenue Growth**: Increase customer retention through loyalty points system

### Target Users

1. **Salon Owners**: Need overview of business performance, revenue, and growth metrics
2. **Managers/Admins**: Handle day-to-day operations, staff management, and client relationships
3. **Receptionists**: Manage appointments, check-ins, and front-desk operations
4. **Staff/Stylists**: View schedules, access client information, and record service delivery
5. **Super Admins**: Manage multiple salon locations and system configuration

---

## Core Features (MVP)

### 1. Sales Management

**Purpose**: Track and manage all revenue-generating activities

**Features**:
- Record service sales with staff assignment
- Record product sales with inventory tracking (future phase)
- Apply discounts and promotions
- Process multiple payment methods (cash, card, digital wallets)
- Split payments across multiple methods
- Automatic invoice generation
- Receipt printing and email delivery

**User Stories**:
- As a receptionist, I can quickly record a sale with multiple services
- As a staff member, I can view my sales performance
- As an owner, I can track daily/weekly/monthly revenue

### 2. Invoice Management

**Purpose**: Generate and track all financial transactions

**Features**:
- Automatic invoice generation from sales
- Invoice numbering system (auto-incrementing, customizable format)
- Tax calculation and breakdown
- Invoice status tracking (paid, pending, overdue, cancelled)
- Invoice search and filtering
- PDF invoice generation
- Email invoice to clients
- Invoice history for clients
- Refund and cancellation handling

**User Stories**:
- As a receptionist, I can generate an invoice immediately after service completion
- As an admin, I can search for invoices by client, date, or invoice number
- As a client, I receive an email with my invoice after each visit

### 3. Appointment Scheduling

**Purpose**: Manage and optimize appointment bookings

**Features**:
- Calendar view (day, week, month)
- Book appointments with specific staff members
- Service duration and buffer time management
- Appointment status (scheduled, confirmed, in-progress, completed, cancelled, no-show)
- Appointment reminders (email/SMS - future phase)
- Walk-in client handling
- Recurring appointment scheduling
- Appointment conflict detection
- Color-coded appointments by status/service type
- Drag-and-drop rescheduling

**User Stories**:
- As a receptionist, I can book an appointment and see available time slots
- As a staff member, I can view my daily schedule at a glance
- As a client, I receive reminders about my upcoming appointments

### 4. Staff Schedule Management

**Purpose**: Optimize staff allocation and work schedules

**Features**:
- Weekly/monthly schedule creation
- Shift management (opening, closing, split shifts)
- Staff availability tracking
- Time-off request management
- Schedule conflict alerts
- Staff workload balancing
- Schedule templates for recurring patterns
- Export schedules (PDF, print)

**User Stories**:
- As an admin, I can create staff schedules for the month
- As a staff member, I can request time off through the system
- As a manager, I can see who is available for a specific time slot

### 5. Client Management

**Purpose**: Maintain comprehensive client relationships and history

**Features**:
- Client profile creation (name, contact, birthday, preferences)
- Contact information (phone, email, address)
- Service history with dates and staff
- Appointment history (past and upcoming)
- Client preferences and notes
- Allergies and sensitivities tracking
- Favorite services and staff
- Client photos (before/after)
- Client loyalty points balance
- Client spending history
- Client tags and categories
- Advanced search and filtering

**User Stories**:
- As a staff member, I can quickly view a client's service history before their appointment
- As a receptionist, I can find client information using phone number or name
- As an admin, I can add notes about client preferences for personalized service

### 6. Reports & Dashboard

**Purpose**: Provide business intelligence and actionable insights

**Reports**:
- Revenue reports (daily, weekly, monthly, yearly)
- Sales by service type
- Sales by staff member
- Appointment statistics (booked, completed, no-shows, cancellations)
- Client acquisition and retention rates
- Peak hours and busy days analysis
- Staff performance metrics
- Product sales analysis (future phase)
- Payment method breakdown

**Dashboard Widgets**:
- Today's revenue vs. target
- Today's appointments (completed/remaining)
- Active clients vs. new clients
- Top performing services
- Top performing staff
- Recent sales
- Upcoming appointments
- Quick actions (new sale, new appointment, new client)

**User Stories**:
- As an owner, I can see my monthly revenue trend at a glance
- As a manager, I can identify which services are most popular
- As a staff member, I can view my performance metrics

### 7. Loyalty Points System

**Purpose**: Increase customer retention and repeat business

**Features**:
- Automatic points earning (configurable per service/product)
- Points earning rules (e.g., $1 spent = 1 point)
- Points redemption for discounts or free services
- Points expiration rules (optional)
- Points history and transactions
- Points balance display on invoices
- Birthday bonus points
- Referral bonus points (future phase)
- Loyalty tiers (Silver, Gold, Platinum) with benefits

**User Stories**:
- As a client, I earn points automatically with every purchase
- As a receptionist, I can apply points as payment during checkout
- As an admin, I can configure points earning and redemption rules

---

## User Roles & Permissions

### Super Admin
- **Access**: Everything across all salons
- **Capabilities**:
  - Manage salon locations
  - System configuration
  - Global reports
  - User management across all salons

### Owner
- **Access**: Full access to their salon
- **Capabilities**:
  - All admin capabilities
  - Financial reports
  - Staff management
  - System settings for their salon

### Admin
- **Access**: Full operational access
- **Capabilities**:
  - Manage clients, appointments, sales
  - Manage staff schedules
  - View reports
  - Configure salon settings
  - Cannot delete salon or modify critical settings

### Staff
- **Access**: Limited operational access
- **Capabilities**:
  - View their schedule
  - View client information
  - Record sales for their services
  - View their performance metrics
  - Cannot access financial reports or settings

### Receptionist
- **Access**: Front desk operations
- **Capabilities**:
  - Manage appointments
  - Record sales
  - Check-in clients
  - View client information
  - Cannot access staff schedules or settings

---

## Technical Requirements

### Frontend Requirements

- **Framework**: Next.js (latest stable version) with App Router
- **Language**: TypeScript (strict mode enabled)
- **UI Library**: ShadCN/UI with purple theme
- **Styling**: Tailwind CSS
- **Forms**: React Hook Form with Zod validation
- **State Management**: React Context API (minimal global state)
- **Data Fetching**: Server Components and Server Actions
- **Responsive Design**: Mobile-first approach
- **Theme**: Light/Dark mode support
- **Accessibility**: WCAG 2.1 AA compliance

### Backend Requirements

- **Runtime**: Node.js (latest LTS version)
- **Framework**: Next.js API Routes and Server Actions
- **ORM**: Prisma
- **Database**: PostgreSQL (version 14+)
- **Authentication**: NextAuth.js with JWT
- **Validation**: Zod schemas on all inputs
- **Error Handling**: Centralized error handling with proper logging
- **API Design**: RESTful principles for API routes

### Security Requirements

- **Authentication**: Secure session management with NextAuth.js
- **Authorization**: Role-Based Access Control (RBAC) on all routes
- **Input Validation**: Zod validation on all user inputs and external data
- **SQL Injection Prevention**: Prisma ORM (parameterized queries)
- **XSS Prevention**: React auto-escaping + Content Security Policy
- **CSRF Protection**: Built-in with Next.js
- **Password Security**: Bcrypt hashing for passwords
- **Environment Variables**: Secure storage of secrets
- **HTTPS**: Enforce HTTPS in production

### Performance Requirements

- **First Contentful Paint**: < 1.5s
- **Time to Interactive**: < 3s
- **Lighthouse Score**: > 90 (Performance, Accessibility, Best Practices)
- **Mobile Performance**: Optimized for 3G networks
- **Database Queries**: < 100ms for common queries
- **Page Size**: < 500KB initial load

### Testing Requirements

- **Unit Tests**: Test all utility functions and business logic
- **Component Tests**: Test React components in isolation
- **Integration Tests**: Test API routes and database operations
- **E2E Tests**: Test critical user flows
- **Coverage**: Minimum 80% code coverage
- **Test Framework**: Jest with React Testing Library

### Deployment Requirements

- **Platform**: Railway
- **CI/CD**: GitHub Actions
- **Environment**: Staging and Production environments
- **Database**: PostgreSQL on Railway
- **Monitoring**: Application health checks
- **Logging**: Centralized logging for errors and important events
- **Backups**: Automated daily database backups

---

## Database Schema Overview

### Core Entities

1. **User**: System users (staff, admins, owners)
2. **Client**: Salon clients/customers
3. **Service**: Services offered by the salon
4. **Product**: Products sold by the salon (future phase)
5. **Appointment**: Scheduled appointments
6. **Sale**: Sales transactions
7. **Invoice**: Generated invoices
8. **Payment**: Payment records
9. **Schedule**: Staff schedules
10. **LoyaltyPoints**: Client points transactions
11. **Report**: Generated reports (cached)

*Detailed schema in `/docs/ARCHITECTURE.md`*

---

## Future Enhancements (Post-MVP)

### Phase 2
- Inventory management for products
- SMS notifications for appointments
- Online booking portal for clients
- Mobile app (React Native)
- Advanced analytics with charts
- Employee commission tracking
- Multi-location support

### Phase 3
- Marketing automation (email campaigns)
- Client feedback and reviews
- AI-powered appointment recommendations
- Integration with accounting software
- Payroll management
- Membership/subscription plans

---

## Success Metrics

### Business Metrics
- 90% user adoption within first month
- 50% reduction in appointment no-shows
- 30% increase in repeat client rate
- 25% increase in average transaction value (through loyalty points)

### Technical Metrics
- 99.9% uptime
- < 2s average page load time
- Zero critical security vulnerabilities
- 80%+ code coverage

### User Satisfaction
- Net Promoter Score (NPS) > 50
- System Usability Scale (SUS) score > 75
- < 5% error rate in user flows

---

## Constraints & Assumptions

### Constraints
- Budget: Development timeline of 8-12 weeks
- Team: AI-assisted development (Claude Code)
- Technology: Must use specified tech stack
- Compliance: Must handle personal data securely (privacy regulations)

### Assumptions
- Salon has stable internet connection
- Staff are comfortable with basic computer usage
- Client data can be digitized from existing records
- Single currency support (can expand later)
- English language only (can expand later)

---

## Risk Management

### Technical Risks
- **Risk**: Database performance issues with large datasets
- **Mitigation**: Implement proper indexing, pagination, and caching

- **Risk**: Third-party service downtime (Railway, Auth providers)
- **Mitigation**: Implement graceful degradation and error handling

### Business Risks
- **Risk**: Low user adoption due to change resistance
- **Mitigation**: Comprehensive training and gradual rollout

- **Risk**: Data migration from existing system
- **Mitigation**: Provide data import tools and support

---

## Getting Started

For AI development with Claude:

1. Review this document thoroughly
2. Check `/docs/TASK_LIST.md` for current priorities
3. Review `/docs/ARCHITECTURE.md` for technical decisions
4. Read `/CLAUDE.md` for development guidelines
5. Start with the first task in the task list

---

## Project Timeline

### Week 1-2: Foundation
- Project setup and configuration
- Database schema design
- Authentication implementation
- Basic UI components

### Week 3-4: Core Features (Part 1)
- Client management
- Service management
- Appointment scheduling

### Week 5-6: Core Features (Part 2)
- Sales management
- Invoice generation
- Staff scheduling

### Week 7-8: Advanced Features
- Reports and dashboard
- Loyalty points system
- Role-based access control

### Week 9-10: Polish & Testing
- UI/UX refinements
- Comprehensive testing
- Bug fixes
- Performance optimization

### Week 11-12: Deployment & Launch
- Staging deployment
- User acceptance testing
- Production deployment
- Documentation and training

---

## Contact & Support

For questions or clarifications during development:
- Refer to inline code comments
- Check `/docs/ARCHITECTURE.md` for design decisions
- Update `/docs/TASK_LIST.md` with progress
- Document new decisions in appropriate docs

---

*This document is a living document and will be updated as the project evolves.*
