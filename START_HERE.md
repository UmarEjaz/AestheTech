# 🚀 AestheTech - Project Kickoff Guide

## Welcome to AestheTech Development!

This document contains the **initial prompt** you should give to Claude Code to begin developing the AestheTech Salon Management Application.

---

## Prerequisites

Before starting, ensure you have:
- [ ] Node.js (latest LTS version) installed
- [ ] PostgreSQL installed and running
- [ ] Git installed
- [ ] Code editor (VS Code recommended)
- [ ] Claude Code CLI installed

---

## Initial Prompt for Claude

Copy and paste the following prompt to Claude Code to begin the project:

```
I want to start building the AestheTech Salon Management Application. This is a comprehensive salon management system designed to automate salon operations.

IMPORTANT: Before starting any development work, please:

1. Read /CLAUDE.md thoroughly to understand the project context, tech stack, and development guidelines
2. Review /docs/PROJECT_OVERVIEW.md to understand the complete project scope and requirements
3. Review /docs/ARCHITECTURE.md to understand the system architecture and design decisions
4. Check /docs/TASK_LIST.md to see all planned tasks

Once you've reviewed all the documentation, please start with Phase 1: Project Foundation. Specifically:

1. Initialize a new Next.js project with TypeScript
2. Set up the project structure as outlined in CLAUDE.md
3. Install and configure all required dependencies (Tailwind CSS, ShadCN/UI, Prisma, NextAuth.js, etc.)
4. Configure the purple theme for ShadCN/UI components
5. Set up the basic project configuration files (tsconfig.json, next.config.js, .eslintrc.json)
6. Create the .env.example file with all required environment variables
7. Set up the folder structure as defined in the architecture

As you work, please:
- Update the task list in /docs/TASK_LIST.md by checking off completed tasks
- Follow all the guidelines in CLAUDE.md strictly
- Use TypeScript in strict mode for all code
- Implement proper error handling and validation
- Test your code before marking tasks as complete
- Ask questions if anything is unclear

Let's begin with the project initialization. Please start by creating the Next.js project and setting up the basic structure.
```

---

## Alternative: Step-by-Step Approach

If you prefer a more guided approach, you can start with smaller chunks:

### Step 1: Project Setup
```
Please help me set up the AestheTech project. First, read /CLAUDE.md, /docs/PROJECT_OVERVIEW.md, and /docs/ARCHITECTURE.md to understand the project.

Then, initialize a new Next.js 14+ project with:
- TypeScript in strict mode
- App Router (not Pages Router)
- Tailwind CSS
- ESLint and Prettier

Follow the tech stack specified in CLAUDE.md exactly.
```

### Step 2: Dependencies
```
Now that the Next.js project is initialized, please install and configure:
1. ShadCN/UI with purple theme
2. Prisma ORM
3. NextAuth.js
4. React Hook Form
5. Zod validation
6. All other dependencies listed in CLAUDE.md

Set up the project folder structure as defined in /docs/ARCHITECTURE.md
```

### Step 3: Database Setup
```
Please set up the database layer:
1. Create the complete Prisma schema as defined in /docs/ARCHITECTURE.md
2. Set up the .env file with DATABASE_URL
3. Run the initial migration
4. Create a seed file with sample data

Follow the database design exactly as specified in ARCHITECTURE.md
```

### Step 4: Authentication
```
Implement authentication using NextAuth.js:
1. Set up NextAuth.js configuration with JWT strategy
2. Create login page
3. Implement role-based access control (RBAC)
4. Create middleware for protected routes
5. Test the authentication flow

Refer to /docs/ARCHITECTURE.md for the authentication architecture.
```

---

## What to Expect

Claude will:
1. ✅ Read and understand all documentation
2. ✅ Initialize the Next.js project with correct configuration
3. ✅ Install all required dependencies
4. ✅ Set up the project structure
5. ✅ Configure Tailwind CSS and ShadCN/UI with purple theme
6. ✅ Create configuration files
7. ✅ Update the task list as tasks are completed

---

## Monitoring Progress

### Check Task Completion
```bash
cat docs/TASK_LIST.md
```

### View Project Structure
```bash
tree -L 3 -I 'node_modules|.next'
```

### Verify Installation
```bash
npm run dev  # Start development server
npm run lint # Run linter
npm run type-check # Check TypeScript
```

---

## Important Reminders

### For Claude:
- ✅ Always update `/docs/TASK_LIST.md` as you complete tasks
- ✅ Follow the tech stack strictly (no substitutions)
- ✅ Use TypeScript in strict mode
- ✅ Implement Zod validation for all inputs
- ✅ Test code before marking tasks complete
- ✅ Document decisions in the appropriate docs

### For You (Human Developer):
- 📖 Review the code Claude generates
- ✅ Test the application regularly
- 💬 Provide feedback to Claude when needed
- 📝 Update documentation if requirements change

---

## Troubleshooting

### If Claude seems stuck:
- Ask it to check the task list
- Point it to the relevant documentation
- Break down the task into smaller steps

### If you're not sure what to do next:
- Check `/docs/TASK_LIST.md` for the next uncompleted task
- Review `/docs/ARCHITECTURE.md` for technical guidance
- Read `/CLAUDE.md` for development guidelines

---

## Next Steps After Setup

Once Phase 1 (Project Foundation) is complete:

1. **Phase 2**: Start building core features (Client Management, Services, Appointments)
2. **Phase 3**: Implement sales and invoicing
3. **Phase 4**: Add reports and loyalty points
4. **Phase 5**: Polish, test, and optimize
5. **Phase 6**: Deploy to Railway

---

## Getting Help

If you encounter issues:
1. Check the documentation in `/docs/`
2. Review the `CLAUDE.md` file
3. Ask Claude for clarification
4. Review the error messages carefully

---

## Success Criteria

You'll know the initial setup is complete when:
- ✅ Next.js app runs on `http://localhost:3000`
- ✅ TypeScript compiles without errors
- ✅ Linter runs without errors
- ✅ All dependencies are installed
- ✅ Folder structure matches architecture docs
- ✅ ShadCN/UI is configured with purple theme
- ✅ `.env.example` file is created

---

**Ready to build something amazing? Copy the initial prompt above and let's get started! 🚀**
