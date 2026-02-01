Review all uncommitted changes before commit. Follow this process EXACTLY and THOROUGHLY.

## Step 1: Run Automated Checks
Run these commands and report any errors:
```bash
npm run lint
npm run type-check
```
If either fails, list all errors before proceeding.

## Step 2: Get the Changes
Run `git diff` to see unstaged changes and `git diff --cached` to see staged changes. Read EVERY modified file completely.

## Step 3: Deep Code Review

For EACH modified file, systematically check:

### Error Handling
- [ ] All async functions have try-catch blocks with catch (not just try-finally)
- [ ] Catch blocks provide user-friendly error messages (not silent failures)
- [ ] Server actions return proper error responses, not just throw
- [ ] Promise rejections are handled (no floating promises)

### Type Safety
- [ ] No `any` types without justification
- [ ] Ref types match the actual DOM element rendered (e.g., HTMLHeadingElement for h1-h6)
- [ ] Generic types are correctly applied
- [ ] Function return types are correct
- [ ] Props interfaces match actual usage

### Race Conditions & Concurrency
- [ ] Database reads used for validation happen INSIDE transactions, not before
- [ ] Critical operations use appropriate isolation levels (Serializable for financial ops)
- [ ] No time-of-check to time-of-use (TOCTOU) vulnerabilities
- [ ] Consider: "What if two users do this simultaneously?"

### Edge Cases & Business Logic
- [ ] Rounding with Math.floor/ceil doesn't cause cumulative errors (money, points, percentages)
- [ ] Boundary conditions handled (zero, negative, max values, empty arrays)
- [ ] Null/undefined cases properly handled
- [ ] Division by zero prevented
- [ ] Array access bounds checked

### Security (OWASP Top 10)
- [ ] All user inputs validated with Zod schemas BEFORE use
- [ ] No SQL injection (Prisma parameterized queries only)
- [ ] No XSS (check dangerouslySetInnerHTML, href="javascript:")
- [ ] Authorization checks on ALL protected operations
- [ ] No sensitive data in client components or logs
- [ ] No hardcoded secrets or credentials

### Performance
- [ ] No database queries inside loops (N+1 problem)
- [ ] Proper use of includes/selects in Prisma (no over-fetching)
- [ ] No missing loading states for async operations
- [ ] Large lists use pagination or virtualization

### Next.js & React Best Practices
- [ ] Server actions have proper error handling and return types
- [ ] "use client" only where actually needed
- [ ] revalidatePath called after mutations
- [ ] No state updates on unmounted components
- [ ] useEffect dependencies are correct
- [ ] Keys in lists are stable and unique

### Code Quality
- [ ] No commented-out code
- [ ] No console.log left in (except intentional logging)
- [ ] No duplicate code that should be abstracted
- [ ] Function/variable names are descriptive
- [ ] Complex logic has explanatory comments

## Step 4: Report Findings

### If issues found:
For EACH issue, provide:
```
**File:** path/to/file.ts:lineNumber
**Issue:** Brief description
**Why it matters:** Impact/risk
**Fix:** Code suggestion or approach
```

### If no issues found:
Confirm: "Code review complete. No issues found. Ready for commit."

## IMPORTANT
- Do NOT skip any checks
- Do NOT assume code is correct - verify each point
- Think adversarially: "How could this break?"
- Check the ENTIRE diff, not just the obvious parts
