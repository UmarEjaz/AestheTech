# Testing Scripts

This directory contains utility scripts for testing the AestheTech application.

## Available Scripts

### `run-tests.sh`
**Main test runner that executes the complete test suite**

Runs:
- ESLint checks
- TypeScript type checking
- All unit tests with coverage

Usage:
```bash
bash scripts/testing/run-tests.sh
```

### `test-db.sh`
**Database-specific test runner**

Tests:
- Database connection
- Prisma Client generation
- Migration status
- Database-related tests

Usage:
```bash
bash scripts/testing/test-db.sh
```

Requirements:
- `DATABASE_URL` must be set in `.env`
- PostgreSQL database must be running

### `test-api.sh`
**API endpoint test runner**

Runs tests for:
- API routes
- Server Actions
- Endpoint authentication

Usage:
```bash
bash scripts/testing/test-api.sh
```

### `test-components.sh`
**React component test runner**

Runs tests for:
- UI components
- Accessibility (a11y)
- Component interactions

Usage:
```bash
bash scripts/testing/test-components.sh
```

## Making Scripts Executable

Before running the scripts, make them executable:

```bash
chmod +x scripts/testing/*.sh
```

## Running All Tests

To run the complete test suite:

```bash
bash scripts/testing/run-tests.sh
```

Or if executable:

```bash
./scripts/testing/run-tests.sh
```

## Continuous Integration

These scripts are designed to be used in CI/CD pipelines (GitHub Actions). See `.github/workflows/test.yml` for CI configuration.

## Test Coverage

After running tests, view the coverage report:

```bash
open coverage/lcov-report/index.html
```

## Writing Tests

### Unit Tests
Place unit tests next to the code they test:
```
src/lib/utils.ts
src/lib/utils.test.ts
```

### Component Tests
Place component tests next to components:
```
src/components/ClientCard.tsx
src/components/ClientCard.test.tsx
```

### Integration Tests
Place integration tests in `tests/` directory:
```
tests/integration/api/clients.test.ts
```

## Test Naming Conventions

- Unit tests: `*.test.ts` or `*.test.tsx`
- Integration tests: `*.integration.test.ts`
- E2E tests: `*.e2e.test.ts`

## Environment Variables for Testing

Create a `.env.test` file for test-specific environment variables:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/aesthetech_test"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="test-secret"
```

## Troubleshooting

### Tests Fail with Database Errors
1. Ensure PostgreSQL is running
2. Check `DATABASE_URL` in `.env`
3. Run `npx prisma migrate dev`

### Type Check Fails
1. Run `npm run type-check` to see errors
2. Ensure all dependencies are installed
3. Check `tsconfig.json` configuration

### Linting Fails
1. Run `npm run lint` to see errors
2. Run `npm run lint -- --fix` to auto-fix
3. Check `.eslintrc.json` configuration

## Best Practices

1. **Run tests before committing**: Always run `bash scripts/testing/run-tests.sh` before pushing code
2. **Write tests first**: Follow TDD when possible
3. **Keep tests fast**: Mock external dependencies
4. **Test edge cases**: Don't just test the happy path
5. **Maintain coverage**: Aim for 80%+ code coverage

---

For more information, see `/docs/PROJECT_OVERVIEW.md`
