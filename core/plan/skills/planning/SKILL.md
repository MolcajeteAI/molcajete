---
name: planning
description: >-
  Rules for generating implementation plans from PRD specs. Defines plan file
  format, task decomposition rules, context budgets, done signals, task status
  lifecycle, naming conventions, and slug generation. Used by /m:plan.
---

# Planning

Rules for generating implementation plan files in `.molcajete/plans/`. A plan decomposes specified use cases into ordered tasks that the build command will execute.

## When to Use

- Generating an implementation plan from specified use cases with /m:plan
- Understanding task decomposition rules and context budgets
- Referencing plan file format and naming conventions

## Plan File Format

Plan files live at `.molcajete/plans/{YYYYMMDDHHmm}-{slug}.md`. The exact schema is defined by the [plan template](./templates/plan-template.md). Read the template before generating any plan file.

## Task Decomposition Rules

### BDD-Aligned Tasks (Preferred)

Each task should advance at least one Gherkin scenario toward passing. Organize tasks by scenario assertions, not by architectural layers.

**Good decomposition:**
- "Implement user registration endpoint (SC-0A1b, SC-0A2c)" — advances specific scenarios
- "Add password validation logic (SC-0A3d)" — targets a specific assertion

**Bad decomposition:**
- "Set up database models" — layer-based, doesn't map to any scenario
- "Create API routes" — infrastructure without BDD traceability

### When Layer-Based Tasks Are Acceptable

Infrastructure tasks that don't map to any scenario are allowed when they are prerequisites for BDD-aligned tasks. Examples:
- Database migration setup
- Test harness configuration
- Shared middleware that multiple scenarios depend on

These tasks use the **validator done signal** instead of BDD gate.

### Using ARCHITECTURE.md Enrichment

When ARCHITECTURE.md contains a Code Map section with entries, use it to:
- Map scenarios to implementation files for more accurate task decomposition
- Include referenced files in each task's "Files to create/modify" list
- Estimate context budgets more precisely (the Code Map tells you which files each task needs)
- Identify shared files that appear across multiple scenarios — these may need infrastructure tasks

### Task Intent

Each task carries an `Intent` field that tells the build dispatcher what kind of work to do:

| Intent | Set by | Meaning |
|--------|--------|---------|
| `implement` | `/m:plan` | Build new code from specs. Tasks create files, implement logic, wire up components. |
| `wire-bdd` | `/m:reverse-plan` | Write BDD step definitions for existing code. The application already works — tasks implement step definitions that exercise it. |

The command that generates the plan sets the intent. Build reads it and adjusts its approach accordingly.

### Task Sizing

Each task must fit within an estimated **200K token context budget**. This budget covers:
- Reading relevant source files
- Reading relevant spec files (UC, REQUIREMENTS, ARCHITECTURE)
- Reading relevant Gherkin files
- The implementation work itself

If a task would exceed the budget, split it into smaller tasks that each stay under 200K.

### Task Ordering

Order tasks by dependency chain:
1. Infrastructure/setup tasks first (if any)
2. Data model tasks before API tasks
3. Core logic before edge cases
4. Happy-path scenarios before error-handling scenarios

Express dependencies explicitly with the `Depends on` field.

## Done Signals

Every task must have a done signal that determines when it is complete.

### BDD Gate (Primary)

The task is done when its mapped Gherkin scenarios pass. The done signal lists the specific `@SC-XXXX` tags that must pass.

Example: `Scenarios @SC-0A1b and @SC-0A2c pass`

### Validator Gate (Fallback)

For infrastructure tasks with no mapped scenarios, the done signal describes a validation check.

Example: `Database migrations run successfully and schema matches expected state`

Use validator gates sparingly — most tasks should have BDD gates.

## Task Status Lifecycle

```
pending → in_progress → implemented
                      → failed
```

| Status | Meaning |
|--------|---------|
| `pending` | Not started, waiting for dependencies |
| `in_progress` | Currently being worked on by m::build |
| `implemented` | Done signal satisfied |
| `failed` | Attempted but could not complete — needs intervention |

Plan-level status follows the same values:
- `pending` — no tasks started
- `in_progress` — at least one task in progress
- `implemented` — all tasks implemented
- `failed` — any task failed and work stopped

## Plan File Naming

### Timestamp

Format: `{YYYYMMDDHHmm}` — year, month, day, hour (24h), minute. Use the current time when generating the plan.

### Slug Generation

Derive the slug from the scope:

| Scope | Slug | Example |
|-------|------|---------|
| Single feature | Feature name in kebab-case | `user-authentication` |
| Single UC | UC name in kebab-case | `email-login` |
| Multiple features | `mixed` | `mixed` |
| Full scan | `full-scan` | `full-scan` |

Full plan file name example: `202603261430-user-authentication.md`

## Template

Read the plan template before generating:

```
${CLAUDE_PLUGIN_ROOT}/plan/skills/planning/templates/plan-template.md
```
