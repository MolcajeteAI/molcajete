---
name: planning
description: >-
  Rules for generating implementation plans from PRD specs. Defines plan file
  format, task decomposition rules, context budgets, done signals, task status
  lifecycle, naming conventions, and slug generation. Used by /m:plan.
---

# Planning

Rules for generating implementation plan files in `.molcajete/plans/`. Plans are **JSON files** — never markdown. A plan decomposes specified use cases into ordered tasks that the build command will execute.

## When to Use

- Generating an implementation plan from specified use cases with /m:plan
- Understanding task decomposition rules and context budgets
- Referencing plan file format and naming conventions

## Plan File Format

Plan files live at `.molcajete/plans/{YYYYMMDDHHmm}-{slug}.json`. The exact JSON structure is defined by [plan-schema.json](./templates/plan-schema.json). Read the schema before generating any plan file. The output must be valid JSON written with `JSON.stringify(data, null, 2)` formatting — do not produce markdown plan files.

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

### Cross-Domain Awareness

Read `prd/DOMAINS.md` as part of project context. When a feature spans domains (tagged with multiple `@{domain}` tags), the first task for that feature absorbs infrastructure cost. Do not create T-000 infrastructure tasks per domain. Tasks slice vertically by scenario — a task's files may span any number of domains' codebases.

### Global Feature Planning

When the target is a global feature (domain is `global`, type is `spec-only`):

1. **Cross-domain task generation:** Generate tasks for each real domain, never for `global` itself. Each task's Domain field must reference a real domain.
2. **Group by domain:** Organize tasks into domain groups in the plan output.
3. **Global baseline context:** Each task description must reference the global feature's spec directory: "Global baseline: prd/domains/global/features/FEAT-XXXX-{slug}/"
4. **Domain overrides:** When a real domain has a feature with `refs` pointing to the global feature, prefer the domain feature's REQUIREMENTS.md and ARCHITECTURE.md over the global baseline for that domain's tasks.

### Refs Loading

When a domain feature declares `refs` in its REQUIREMENTS.md frontmatter:

1. Load each referenced global feature's REQUIREMENTS.md and ARCHITECTURE.md
2. Use global specs as baseline context alongside the domain feature's own specs
3. Global requirements inform task decomposition but domain requirements take precedence where they diverge

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

## Research Discovery

When generating an implementation plan, scan for relevant research briefs:

1. List `.molcajete/research/*.md` — filenames sort naturally by timestamp (newest first)
2. Read only the YAML frontmatter of each file (not the body)
3. Compare `description` and `query` against the plan's topic/scope
4. If relevant, read the full document and use it as context
5. Stop after the first relevant match to protect context window
6. Also scan `research/*.md` at project root the same way

The brief's "Existing Codebase Patterns" section helps understand what exists and what needs to change. The "Key Libraries/APIs" section informs task decomposition when new dependencies are involved.

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

Full plan file name example: `202603261430-user-authentication.json`

## Documentation Task Rule

Every plan must include a final task that updates directory documentation for all modules modified by the preceding tasks. This task:

- Is always the **last task** in the plan (highest T-NNN number)
- **Depends on** all other tasks in the plan
- Uses the **validator done signal**: "README.md files exist and are current for all directories containing modified files"
- **Intent** matches the plan's intent (`implement` or `wire-bdd`)
- References the code-documentation skill so the build agent knows the conventions
- Lists `{directory}/README.md` for every directory that appears in preceding tasks' "Files to create/modify" lists
- Skips directories on the code-documentation skill's skip list

This task goes through the same build pipeline as any other task — it is tracked, visible, and committed.

## Schema

Read the plan schema before generating:

```
${CLAUDE_PLUGIN_ROOT}/plan/skills/planning/templates/plan-schema.json
```
