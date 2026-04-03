# Commit Message Examples

## Single-Line Commits

For simple, obvious changes, a single line is enough.

```
feat: Add user profile page
```

```
fix: Fix navigation menu on mobile
```

```
chore: Update dependencies to latest versions
```

```
refactor: Remove deprecated API endpoints
```

```
refactor: Simplify database connection logic
```

## Multi-Line Commits (No PRD Context)

For changes without feature/UC/scenario context, add bullet points describing what was done.

### Dependency Update

```
chore: Update React from v17 to v18

- Migrates to new root API
- Updates test setup
- Removes deprecated lifecycle methods
```

### Config Change

```
chore: Add ESLint strict mode rules

- Enables no-implicit-any
- Adds unused-imports plugin
- Fixes existing violations
```

## Multi-Line Commits (With PRD Context)

When the commit is part of a task with feature/UC/scenario context, include the spec references block.

### Feature Addition

```
feat: Add email verification for new users

- Sends verification link on registration
- Blocks login until email is verified
- Adds resend verification option
- Stores verification token in database

FEAT-0008
- UC-0023: Verify email address
  - SC-0071: Verification link sent on registration
  - SC-0072: Login blocked until verified
  - SC-0073: Resend verification link
```

### Bug Fix

```
fix: Fix race condition in payment processing

- Adds transaction locking
- Prevents duplicate charges
- Retries failed transactions once

FEAT-0003
- UC-0010: Process payment
  - SC-0031: Concurrent payment requests handled safely
```

### Step Definitions

```
test: Add step definitions for authentication flow

- Implements login success and failure steps
- Adds token expiration assertions
- Validates error message steps

FEAT-0001
- UC-0002: Log in with credentials
  - SC-0005: Successful login with valid credentials
  - SC-0006: Login rejected with wrong password
  - SC-0007: Login rejected with expired token
```

### Refactoring

```
refactor: Simplify error handling across API

- Creates central error handler
- Standardizes error response format
- Removes duplicate error code

FEAT-0005
- UC-0015: Handle API errors
  - SC-0045: Unknown route returns 404
  - SC-0046: Server error returns 500 with standard body
```

### Performance Improvement

```
perf: Improve database query performance

- Adds indexes on frequently queried columns
- Reduces N+1 queries with eager loading
- Caches user permissions

FEAT-0012
- UC-0040: Load user dashboard
  - SC-0120: Dashboard loads within 500ms
```

### Multiple Use Cases in One Commit

```
feat: Add user registration endpoint

- Creates registration handler with validation
- Adds bcrypt password hashing
- Sends welcome email on success

FEAT-0001
- UC-0001: Register new user
  - SC-0001: Valid registration with all fields
  - SC-0002: Duplicate email rejected
- UC-0003: Send welcome email
  - SC-0008: Welcome email sent after registration
```

## Anti-Patterns

### Too Vague

```
# BAD — no information about what changed
Updates code
Fixes issues
Changes things
WIP
```

### Too Technical for Subject Line

```
# BAD — move details to body
refactor: Refactor UserAuthenticationServiceFactoryBean implementation

# GOOD
refactor: Simplify user authentication setup
```

### Mentions AI or Tools

```
# BAD — never attribute to AI
Adds feature (generated with Claude)
AI-assisted refactoring
Claude suggested fixes

# GOOD — just describe the change
feat: Add user dashboard
refactor: Simplify authentication logic
fix: Fix login redirect
```

### Over-Explains Simple Changes

```
# BAD
fix: Fix typo in README

Changed 'teh' to 'the' on line 42 because it was misspelled.

# GOOD
fix: Fix typo in README
```

### Drops Prefixes When the Project Uses Them

```
# BAD — prefixes are the default, do not drop them
Adds user dashboard
Fixes payment error

# GOOD — use conventional prefixes
feat: Add user dashboard
fix: Fix payment error
```

### Introduces Verb-Only When Project Uses Prefixes

```
# BAD — project uses prefixes, match the style
Adds user dashboard
Fixes payment processing error

# GOOD
feat: Add user dashboard
fix: Fix payment processing error
```

### Uses Co-Author Attribution for AI

```
# BAD — never do this
feat: Add user authentication

Co-Authored-By: Claude <noreply@anthropic.com>

# GOOD — no attribution
feat: Add user authentication

- Creates login and registration pages
- Adds JWT token handling
- Stores user session in localStorage
```

### Missing Spec References When Task Has PRD Context

```
# BAD — task has feature/UC/scenario context but no refs block
feat: Add user registration endpoint

- Creates registration handler with validation
- Adds password hashing

# GOOD — includes spec references
feat: Add user registration endpoint

- Creates registration handler with validation
- Adds password hashing

FEAT-0001
- UC-0001: Register new user
  - SC-0001: Valid registration with all fields
  - SC-0002: Duplicate email rejected
```
