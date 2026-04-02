---
name: planning
description: >-
  Rules for generating implementation plans from PRD specs. Defines plan file
  format, task decomposition rules, context budgets, scenario mapping, task
  status lifecycle, naming conventions, and slug generation. Used by /m:plan.
---

# Planning

Rules for generating implementation plan files in `.molcajete/plans/`. Plans are **JSON files** inside directories — never markdown. A plan decomposes specified use cases into ordered tasks that the build command will execute.

## When to Use

- Generating an implementation plan from specified use cases with /m:plan
- Understanding task decomposition rules and context budgets
- Referencing plan file format and naming conventions

## Plan File Format

Plan files live at `.molcajete/plans/{YYYYMMDDHHmm}-{slug}/plan.json`. Each plan gets its own directory so BDD reports and validation artifacts can live alongside the plan. The exact JSON structure is defined by [plan-schema.json](./templates/plan-schema.json). Read the schema before generating any plan file. The output must be valid JSON written with `JSON.stringify(data, null, 2)` formatting — do not produce markdown plan files.

### Plan Directory Structure

```
.molcajete/plans/{YYYYMMDDHHmm}-{slug}/
  plan.json
  reports/
    T-001-validate-1.json
    T-001-validate-2.json
    T-002-validate-1.json
    final-test.json
```

## Task Decomposition Rules

### BDD-Aligned Tasks — 1 Task = 1 Scenario

Each top-level task maps to exactly **one** Gherkin scenario. The `scenario` field contains the `SC-XXXX` ID (without `@` prefix). No task may own multiple scenarios.

**Good decomposition:**
- "Implement patient registration (SC-QWOO)" — one task, one scenario
- "Implement duplicate email rejection (SC-QWOP)" — one task, one scenario

**Bad decomposition:**
- "Implement registration and login (SC-QWOO, SC-QWOP)" — two scenarios in one task
- "Set up database models" — layer-based, doesn't map to any scenario
- "Create API routes" — infrastructure without BDD traceability

### Infrastructure Absorption

Infrastructure tasks are **not** standalone top-level tasks. The first scenario task absorbs infrastructure cost — break it into sub-tasks when infrastructure + implementation exceeds 200K context:

- **Sub-task 1:** Builds shared infrastructure (test harness, database migrations, shared middleware)
- **Sub-task 2:** Implements the scenario's step definitions and production code

The parent task's BDD gate validates both when its single scenario passes. Sub-tasks inherit `scenario` from the parent but BDD is skipped at sub-task level.

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

If a task would exceed the budget, split it into **sub-tasks** within the same task (see Sub-Task Decomposition below). Do not create separate top-level tasks for what is logically one unit of work.

### Sub-Task Decomposition

Sub-tasks break a large task into sequential steps that share a single worktree and branch. Use sub-tasks when a task is too large for one context window but logically belongs together.

#### When to Use Sub-Tasks

| Condition | Sub-tasks? |
|-----------|-----------|
| Under 200K estimated context, no new infra needed | No |
| Over 200K estimated context | Yes |
| New infrastructure needed that other parts depend on | Yes |

#### Sub-Task Rules

- **ID format:** `T-NNN-M` — parent task ID + dash + integer (e.g., `T-003-1`, `T-003-2`). Never use decimal IDs.
- **`sub_tasks` field:** `null` when the task has no sub-tasks. An array of sub-task objects when decomposed.
- **Inheritance:** Sub-tasks inherit `use_case`, `feature`, `domain`, `architecture`, `intent`, and `scenario` from the parent task. These fields are not repeated in the sub-task object.
- **Dependencies:** `depends_on` in a sub-task references **sibling sub-task IDs only** (e.g., `T-003-1`), never top-level task IDs.
- **Shared worktree:** All sub-tasks run in the parent task's worktree — no separate branches.
- **Validation split:** Sub-tasks get formatting + linting + code review + completeness checks (no BDD). BDD tests run only at the parent task level after all sub-tasks complete.
- **Sizing:** Each sub-task should fit within 200K tokens. The parent task's `estimated_context` reflects the total across all sub-tasks.

#### Sub-Task Object Shape

See the `sub_task_schema` section in [plan-schema.json](./templates/plan-schema.json) for the exact fields. Key differences from top-level tasks:
- No `use_case`, `feature`, `domain`, `architecture`, `intent`, or `scenario` (inherited from parent)
- `depends_on` scoped to sibling IDs
- `summary`, `errors` work the same as top-level tasks

### Task Ordering

Order tasks by dependency chain:
1. Data model tasks before API tasks
2. Core logic before edge cases
3. Happy-path scenarios before error-handling scenarios

Express dependencies explicitly with the `Depends on` field.

## Done Signals

Every task must have a done signal that determines when it is complete.

### BDD Gate

The task is done when its BDD tests pass. The `scenario` field controls filtering:

- **Non-null `scenario`** (`"SC-XXXX"`): Run BDD with `--tags` filter for `@SC-XXXX` (derived by prepending `@`). The task is done when the scenario passes.
- **Null `scenario`**: BDD gate is **skipped** — only format, lint, code review, and completeness gates run.

Only sub-tasks and chores tasks (documentation) may have null `scenario`.

Example: `"scenario": "SC-QWOO"` → runs `@SC-QWOO`

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

Full plan directory example: `202603261430-user-authentication/plan.json`

## Scope Field Rules

The `scope` field in the plan JSON records exactly the IDs the user passed to the plan command — no expansion.

- If user passes `FEAT-0A1b`, scope is `["FEAT-0A1b"]` — not the feature plus all its UCs
- If user passes `UC-0A1b UC-0A2c`, scope is `["UC-0A1b", "UC-0A2c"]`
- If no arguments (full scan mode), scope is `["full-scan"]`

The planner still expands internally to discover plannable work (e.g., resolving a feature to its UCs), but the `scope` field only stores the original input.

## Schema

Read the plan schema before generating:

```
${CLAUDE_PLUGIN_ROOT}/plan/skills/planning/templates/plan-schema.json
```
