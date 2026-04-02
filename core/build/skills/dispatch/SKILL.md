---
name: dispatch
description: >-
  Rules and conventions for the build dispatch pipeline. Defines session types,
  dev-validate cycle, sub-task lifecycle, task status lifecycle, intent handling,
  quality gates, plan JSON schema, worktree naming, merge procedure, conflict
  resolution, architecture updates, PRD propagation, and BDD detection.
  Referenced by build.md, session commands, and molcajete.mjs.
---

# Dispatch

Rules for the `/m:build` dispatch pipeline. All build components — the skill entry point (`build.md`), session commands (`sessions/*.md`), and the orchestrator (`molcajete.mjs`) — follow these conventions.

## When to Use

- Understanding how `/m:build` dispatches and gates tasks
- Writing or modifying dispatch pipeline components
- Referencing plan JSON schema or status lifecycle
- Understanding the dev-validate cycle and session types

## Session Types

The build pipeline uses purpose-specific sessions orchestrated by `molcajete.mjs`. Each session has a single responsibility.

| Session | Needs Claude? | Purpose |
|---------|---------------|---------|
| Environment check | Yes | Interpret test output, diagnose service failures |
| Worktree preparation | Node.js first, Claude on error | Deterministic git commands; Claude fixes stale worktrees, conflicts |
| Development | Yes | Write code, unit tests |
| Commit session | Yes | Stage files and create commits after validation passes (uses git-committing skill) |
| Validation coordinator | Yes | Spawn parallel read-only sub-agents for all quality gates |
| Merge + cleanup | Node.js first, Claude on conflict | Deterministic rebase/merge; dev-validate cycle on conflicts |
| Final tests | Yes | Run and interpret full BDD suite for plan scope |

Session commands live in `${CLAUDE_PLUGIN_ROOT}/build/commands/sessions/`:
- `env-check.md` — pre-flight environment and BDD check
- `dev-session.md` — development session (implement code + tests, no quality gates, no commits)
- `validate-session.md` — validation coordinator (parallel read-only gates)
- `commit-session.md` — commit session (stages and commits validated changes using git-committing skill)
- `final-tests.md` — post-flight BDD suite for all plan features
- `worktree-fix.md` — diagnose and fix worktree creation failures

## Dev-Validate Cycle

The core loop between development and validation sessions:

```
Dev Session (code only, no commit)
  │
  ▼
Validation Session (read-only gates on uncommitted changes)
  │
  ├── fail ──> Dev Session (with issues) ──> loop back
  │
  └── pass ──> Commit Session (git-committing skill)
                │
                ├── success ──> done (proceed to merge or next sub-task)
                │
                └── hook fail ──> Dev Session (with hook errors) ──> loop back to validation
                                    │
                                    └── max 7 total cycles ──> mark failed
```

- Max **7 dev-validate cycles** per task or sub-task. Hook failures consume a cycle from the same budget — no separate retry counter.
- Each cycle is a fresh Claude session with full context budget.
- On validation failure, ALL issues from ALL gates are fed to the next dev session.
- The dev session fixes ALL issues in one pass — never one at a time.
- The commit session only runs after validation passes. It stages files and creates commits using the git-committing skill.

### Validation Level by Context

| Context | Gates Run |
|---------|-----------|
| Sub-task (ID: `T-NNN-M`) | Formatting, linting, code review, completeness (NO BDD) |
| Task (ID: `T-NNN`) | Formatting, linting, code review, completeness, BDD tests |
| Plan-level (post-flight fix) | BDD tests for all features in plan scope |

The validation coordinator auto-detects whether it's validating a sub-task or task by the ID format — no special flags needed.

## Sub-Task Lifecycle

Sub-tasks break a large task into sequential steps within a shared worktree.

### Rules

- **One worktree per task, not per sub-task.** Sub-tasks are sequential steps on the same branch.
- Sub-tasks inherit `use_cases`, `feature`, `domain`, `architecture`, `intent`, `done_tags` from the parent task.
- Sub-task `depends_on` references sibling sub-task IDs only (e.g., `T-003-1`).
- Sub-task IDs follow `T-NNN-M` format (parent ID + dash + integer). Never decimal.
- Sub-task state lives in `tasks[].sub_tasks[]` in the plan JSON.

### Execution Flow

1. Orchestrator creates worktree for the parent task
2. Sub-tasks run sequentially (respecting `depends_on`)
3. Each sub-task goes through a dev-validate cycle (NO BDD)
4. After all sub-tasks complete, task-level validation runs (WITH BDD)
5. If task-level validation fails, a fix dev session gets full task scope (all sub-task summaries, all files modified)
6. After validation passes, merge the worktree

### Sub-Task Fields

Sub-task objects in the plan JSON:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `T-NNN-M` — parent task ID + dash + integer |
| `title` | string | Human-readable sub-task title |
| `status` | string | Same lifecycle as tasks: pending → in_progress → implemented/failed |
| `estimated_context` | string | Estimated context budget for this sub-task |
| `depends_on` | string[] | Sibling sub-task IDs only |
| `description` | string | What to implement |
| `files_to_modify` | string[] | Expected file paths |
| `summary` | string\|null | Written post-build |
| `commits` | string[] | Commit SHAs |
| `quality_gates` | object\|null | Gate results (no bdd_tests for sub-tasks) |
| `error` | string\|null | Error message if failed |

## Pre-flight / Post-flight

### Pre-flight (Environment Check)

Before any task runs, the orchestrator spawns an environment check session that:

1. Verifies services are running (Docker, databases, etc.)
2. Runs BDD tests filtered by all feature tags in the plan scope, excluding `@pending` and `@dirty` scenarios
3. **All non-pending, non-dirty tests must pass.** Any failure aborts the build.

This establishes a green baseline. Any failure in the final tests is then guaranteed to be caused by the plan's changes.

### Post-flight (Final Tests)

After all tasks are implemented and merged:

1. Run BDD suite for all feature tags in the plan scope, excluding `@pending` and `@dirty` scenarios as a safety net (filters out scenarios from in-scope features that no task targeted)
2. If all green AND `unaddressed` is empty → PRD status propagation + completion report
3. If all green BUT `unaddressed` is non-empty → report success with warning: list unaddressed scenarios. **Do not propagate `implemented` status** for features/UCs that have unaddressed scenarios. Only propagate status for features/UCs where every scenario was addressed.
4. If failures → plan-level dev-validate cycle (not bound to any single task, because failures may be caused by interactions between tasks)
5. Max 7 plan-level fix cycles before marking the plan as failed

## Task Status Lifecycle

```
pending -> in_progress -> implemented
                       -> failed
```

| Status | Meaning |
|--------|---------|
| `pending` | Not started, waiting for dependencies or dispatch |
| `in_progress` | Currently being executed |
| `implemented` | Done signal satisfied, merged to base branch |
| `failed` | Attempted but could not complete — needs intervention |

Status updates happen in the plan JSON file. The orchestrator (`molcajete.mjs`) handles all status transitions.

## BDD Command Detection

The dispatcher reads pre-computed BDD commands from `.molcajete/apps.md` → **Testing** → **BDD** subsection. These are populated by `/m:setup` (Stage 5b: Verification Profile).

**Command lookup by need:**

| Need | Scope Row |
|------|-----------|
| Pre-flight env check | "By tag expression" with `({scope_tags}) and not @pending and not @dirty` |
| Task validation | "By scenario" with the task's `done_tags` (no lifecycle filter — `@pending` already removed by dev session) |
| Final tests | "By tag expression" with `({scope_tags}) and not @pending and not @dirty` |

**Fallback** (if apps.md has no Testing → BDD section): detect the BDD framework from the apps.md BDD section, or sniff step file extensions in `bdd/steps/`:

| Extension | Framework | Command |
|-----------|-----------|---------|
| `.py` | behave | `behave` |
| `.ts` | cucumber-js | `npx cucumber-js` |
| `.js` | cucumber-js | `npx cucumber-js` |
| `.go` | godog | `godog` |
| `.rb` | cucumber-ruby | `bundle exec cucumber` |

## Project Configuration

All project configuration lives in a single file: `.molcajete/apps.md`. It is populated by `/m:setup` (tooling detection stage) and can be re-detected with `/m:setup` → "Update tooling only".

### apps.md Sections

| Section | What it contains |
|---------|-----------------|
| **Runtime** | How the environment runs (docker-compose, local, etc.) with start/stop commands |
| **Services** | Databases, caches, queues with ports and health check commands |
| **Applications** | Web apps, APIs, and runnable targets with ports and run commands |
| **Modules** | Project modules with directories and languages |
| **BDD** | Framework, language, and format (e.g., behave / python / gherkin) |
| **Tooling** | Per-domain format and lint commands table |
| **Testing** | Pre-computed BDD + unit test commands with `{placeholder}` tokens |
| **Pre-commit Hooks** | Hook tooling and configuration |
| **Scripts** | Wrapper scripts (reference only — build agent uses Tooling and Testing sections) |
| **Warnings** | Gaps detected during setup |
| **Notes** | Freeform user notes |

The **Tooling** table has a `bdd` row that holds format and lint commands for BDD step definition files (`bdd/`). It is always present when BDD is configured.

The **Testing** section holds pre-computed execution commands for BDD and unit test runners at every filtering level. Populated by `/m:setup` Stage 5b.

### How Sessions Use apps.md

**Tooling lookup by intent:**

- **`wire-bdd` intent:** Use the `bdd` row from the Tooling table for formatting and linting (step definitions only, no production code).
- **`implement` intent:** Use the `{domain}` row from the Tooling table for production code, PLUS the `bdd` row for step definitions.

**Other settings:**
- **BDD tests:** Read Testing → BDD subsection for pre-computed runner commands at each filtering level. Fall back to the BDD section's framework if the Testing section is missing.
- **Environment awareness:** Read Runtime section to understand whether services run in Docker. Parse the Services table for per-service health check commands.
- **Verification commands:** Testing → BDD and Testing → Unit Tests subsections provide pre-computed test execution commands for every filtering level — no scanning or guessing needed.

**Never skip format/lint as "not detected"** when Tooling entries exist in apps.md. Only skip if apps.md has no Tooling section AND no config files are found in the project.

## Worktree Management

### Creation

Create a worktree for each task (not per sub-task), branching from the plan's base branch:

```bash
mkdir -p .molcajete/worktrees
git worktree add -b "dispatch/{FEAT}-{T-NNN}" ".molcajete/worktrees/{FEAT}-{T-NNN}" "{BASE_BRANCH}"
```

All sub-tasks share the parent task's worktree. The orchestrator attempts creation via Node.js first — on failure, it spawns a worktree-fix session (Claude) to diagnose and resolve.

### Cleanup

After a successful merge (or on failure), remove the worktree and its branch:

```bash
git worktree remove ".molcajete/worktrees/{FEAT}-{T-NNN}"
git branch -d "dispatch/{FEAT}-{T-NNN}"
```

### Stale Worktree Handling

Before creating a worktree, check if it already exists:

```bash
git worktree list --porcelain
```

If a stale worktree exists for the same task (e.g., from a previous failed run):
1. Remove it: `git worktree remove --force ".molcajete/worktrees/{FEAT}-{T-NNN}"`
2. Delete the branch: `git branch -D "dispatch/{FEAT}-{T-NNN}"`
3. Then create fresh.

## Merge Procedure

After validation passes, the orchestrator merges the task's worktree branch back to the base branch. Node.js-first, with dev-validate fallback on conflicts.

### Steps

1. **Rebase onto base branch:**
   ```bash
   git -C "{worktree_path}" rebase "{BASE_BRANCH}"
   ```

2. **Fast-forward merge from the main worktree:**
   ```bash
   git checkout "{BASE_BRANCH}"
   git merge --no-edit "dispatch/{FEAT}-{T-NNN}"
   ```

3. **Update plan file and commit atomically:** Update the task's status to `implemented`, write the `summary`, `commits`, and `quality_gates` fields in the plan JSON, then commit the plan file on the base branch:
   ```bash
   git add .molcajete/plans/{plan_dir}/plan.json
   git commit -m "plan: mark {T-NNN} implemented"
   ```

4. **Cleanup worktree and branch:** (see Worktree Management → Cleanup)

### Conflict Resolution

If rebase fails with conflicts:

1. Abort the failed rebase
2. Launch a **dev session** with conflict details, worktree path, and task context — it resolves conflicts, stages, and commits
3. Launch a **validation session** (with BDD) to verify the resolution
4. If validation fails → loop back to dev session (same 7-cycle limit)
5. Once validation passes → retry the rebase and merge

## Implementation: `implement` Intent

Forward path — specs drive code creation.

### Phase A: Production Code

1. Read Gherkin `.feature` file(s) for this task's scenarios (grep `bdd/features/` for `@UC-XXXX` tag)
2. Read the task description and files-to-create/modify list from the plan
3. Implement production code following project conventions, guided by Gherkin assertions
4. Write unit tests for the implemented code
5. Run unit tests and fix failures. **If tests fail due to setup errors** (missing dependencies, services not running, database unreachable), apply the **hard stop rule** from the BDD Tests gate — stop immediately, do not continue.
6. Self-review: `git diff` — check for debug statements, commented-out code, hardcoded secrets, TODO placeholders, obvious logic errors
7. Do not commit — the commit step handles this after validation. Proceed to Phase B.

### Phase B: Step Definitions + Docs

1. Read Gherkin `.feature` file(s) — extract all Given/When/Then step patterns for this task's `@SC-XXXX` tags
2. Read `bdd/steps/INDEX.md` for existing reusable step definitions
3. For each step pattern:
   - Check INDEX for existing match → reuse
   - If no match, determine placement (common_steps, api_steps, db_steps, {domain}_steps per gherkin skill)
   - Create or append to step definition file
4. Read the production code just written to understand actual selectors, API paths, function signatures
5. Implement each step definition with real assertion logic referencing real code
6. Follow the gherkin skill's step writing rules
7. Update `bdd/steps/INDEX.md`
8. **Docs update (per Docs Update section):** Update ARCHITECTURE.md, propagate PRD statuses, and update/create README.md files in code directories modified by Phase A
9. All files are now ready for validation. Do not commit — the commit step handles this after validation.

## Implementation: `wire-bdd` Intent

Reverse path — BDD wiring for existing code.

### Single Phase: Step Definitions + Docs

1. Read Gherkin `.feature` file(s) for this task's scenarios (grep `bdd/features/` for `@UC-XXXX` tag)
2. Extract all Given/When/Then step patterns matching `@SC-XXXX` tags
3. Read `bdd/steps/INDEX.md` for existing reusable step definitions
4. For each step pattern:
   - Check INDEX for existing match → reuse
   - If no match, determine placement per gherkin skill
   - Create or append to step definition file
5. Read existing application code (from ARCHITECTURE.md Code Map or task description)
6. Implement each step definition to call real app code and assert behavior
7. Follow the gherkin skill's step writing rules
8. **Do NOT modify production code** — only step definitions and docs
9. Update `bdd/steps/INDEX.md`
10. **Docs update (per Docs Update section):** Update ARCHITECTURE.md and propagate PRD statuses. No README.md updates for `wire-bdd` (code directories were not changed).
11. All files are now ready for validation. Do not commit — the commit step handles this after validation.

## Quality Gates

Quality gates are run by the validation coordinator session as parallel, read-only sub-agents. The coordinator reports issues — it does not fix them.

### 5 Gates (All Parallel, Read-Only)

| Gate | What it checks | Mode |
|------|---------------|------|
| Formatting | Changed files pass formatter | Check/dry-run (no writes) |
| Linting | Changed files pass linter | Report only (no --fix) |
| BDD Tests | Task's tagged scenarios pass | Run tests |
| Code Review | Step defs match specs, code meets requirements | Read + analysis |
| Completeness | All requirements traced to code, no stubs/TODOs | Read + Grep |

All five gates spawn as parallel sub-agents. Formatting uses `--check`/`--diff` flags (never `--write`). Linting omits `--fix`. Everything is read-only.

### Formatting + Linting Tooling

**Read tooling commands from `.molcajete/apps.md` Tooling section** based on the task's intent:

- **`wire-bdd` intent:** Use the `bdd` row's Format and Lint columns
- **`implement` intent:** Use both the `{domain}` row and the `bdd` row

**Fallback:** If apps.md has no Tooling section at all, fall back to scanning for config files. But if the Tooling table exists, use it — do not scan.

**Never skip** format or lint when a tooling entry exists in apps.md.

### BDD Tests

**MANDATORY at task level — skipped for sub-tasks.**

If `done_tags` is non-empty, run with tag filter:
```bash
{bdd_command} --tags="@SC-XXXX or @SC-YYYY"
```

If `done_tags` is empty, run the full suite unfiltered:
```bash
{bdd_command}
```

#### Setup Errors vs Test Failures — HARD STOP RULE

**Setup error (HARD STOP):** The test infrastructure itself is broken — tests cannot run at all. Indicators:
- Connection refused / connection timed out (services not running)
- Docker container not found / not running
- Database not reachable / authentication failed
- BDD runner not installed / command not found
- Missing Python/Node/Go dependencies required by the test runner

**If a setup error is detected:** Immediately set the task status to `failed` with error `"Setup error: {description}"` and STOP.

**Test failure (FIX IT):** Tests ran but assertions failed. The dev-validate cycle handles this — issues are fed back to the dev session.

### Code Review (Intent-Aware)

- **`implement`:** Check step def fidelity, production code conformance, unit test coverage
- **`wire-bdd`:** Check step def accuracy, no production code changes, scenario coverage

### Completeness (Intent-Aware)

- **`implement`:** Trace every requirement to code, flag TODOs/stubs/empty bodies
- **`wire-bdd`:** Verify step defs for all scenarios, no stub markers, steps call real code
- **Both:** Check `CLAUDE.md` + `.claude/rules/` compliance

### Gate Results Format

The validation coordinator outputs:

```json
{
  "formatting": [],
  "linting": ["src/auth/register.ts:14: missing trailing comma"],
  "bdd_tests": ["@SC-0A1b: expected 200 got 422 on POST /auth/register"],
  "code_review": [],
  "completeness": []
}
```

Empty array = gate passed. Non-empty = issues for that gate. The orchestrator checks: if all arrays empty → pass. Otherwise → feed all issues to the next dev session.

### Retry Policy

- **Max cycles:** 7 (dev-validate cycles per task or sub-task)
- Each cycle: dev session fixes ALL issues, validation session re-checks ALL gates
- After 7 failed cycles, the task is marked `failed` — NOT `implemented`
- **A task with failing tests is NEVER marked as done.**
- When a task fails, the build stops.

### Empty `done_tags` Behavior

When a task has `done_tags: []`, the BDD gate runs the **full suite unfiltered**. BDD tests are never skipped — empty tags means "test everything."

## Docs Update (Pre-Commit)

Architecture, PRD status, and README updates are included in the task's file changes and committed by the commit step after validation — not separate commits. These updates happen in the dev session as part of the implementation.

### Architecture Update

Update the feature's `ARCHITECTURE.md` if it exists (path from `tasks[].architecture`).

**What to update:**
- **Component Inventory:** Add new files and their roles
- **Code Map:** Trace UC-XXXX/SC-XXXX to implementation files
- **Architecture Decisions:** Document non-obvious choices made during implementation

Non-blocking — if the update fails, log a warning and continue.

### PRD Status Propagation

Roll up status changes through the PRD hierarchy.

**UC Status Rollup:**
For each UC-XXXX in the completed task's `use_cases`:
1. Find the UC file: `prd/domains/*/features/*/use-cases/{UC-XXXX}-*.md`
2. Read all scenario headings (`### SC-XXXX`) from the UC file
3. Check if all scenario tags are present in `done_tags` of `implemented` tasks across the plan
4. If all scenarios covered → update UC status to `implemented`

**Feature Status Rollup:**
After updating UC statuses:
1. Read the feature's `USE-CASES.md`
2. If ALL UCs in the feature are `implemented` → update feature status in `prd/FEATURES.md`
3. Skip features in the `global` domain (spec-only, no implementation status)

### Code Directory README Updates (`implement` intent only)

For `implement` tasks only (not `wire-bdd`), update or create `README.md` files in code directories that were created or significantly modified. **Do NOT** create README.md in every directory touched — only where a new package, module, or logical grouping was introduced.

### Staging Docs with Final Commit

All docs updates are staged together with the final code commit:

- **`wire-bdd` intent:** stage docs alongside step definitions
- **`implement` intent:** stage docs alongside step definitions in the Phase B commit

## Rate Limit Backoff

When running via `molcajete.mjs`, rate limit retries use exponential backoff:
- **Base:** 30s (configurable via `MOLCAJETE_BACKOFF_BASE`)
- **Growth:** doubling each attempt

## Plan JSON Schema

The plan file at `.molcajete/plans/{YYYYMMDDHHmm}-{slug}/plan.json` is the single source of truth for both plan content and dispatch state. Each plan lives in its own directory so validation reports can be stored alongside it.

```json
{
  "title": "User Authentication",
  "generated": "2026-03-26T14:30:00Z",
  "status": "pending",
  "scope": ["FEAT-0F3y"],
  "overview": {
    "feature_count": 1,
    "use_case_count": 2,
    "scenario_count": 5,
    "estimated_tasks": 3,
    "total_estimated_context": "~450K tokens"
  },
  "base_branch": "main",
  "bdd_command": "npx cucumber-js",
  "tasks": [
    {
      "id": "T-001",
      "title": "Auth foundation",
      "use_cases": ["UC-0F4a", "UC-0F5b"],
      "feature": "FEAT-0F3y",
      "domain": "app",
      "architecture": "prd/domains/app/features/FEAT-0F3y-auth-foundation/ARCHITECTURE.md",
      "intent": "implement",
      "status": "pending",
      "estimated_context": "~120K tokens",
      "done_tags": ["@SC-0A1b", "@SC-0A2c"],
      "depends_on": [],
      "description": "Implement user registration and login endpoints",
      "files_to_modify": ["src/auth/register.ts", "src/auth/login.ts"],
      "sub_tasks": null,
      "summary": null,
      "commits": [],
      "quality_gates": null,
      "error": null
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Human-readable plan title |
| `generated` | string | ISO 8601 timestamp of plan creation |
| `status` | string | Plan-level status from lifecycle |
| `scope` | string[] | FEAT-XXXX and UC-XXXX IDs covered by this plan |
| `overview` | object | Summary counts and estimates |
| `base_branch` | string | Branch to merge completed tasks into |
| `bdd_command` | string\|null | BDD runner command |
| `tasks[].id` | string | Task ID (T-001, T-002, ...) |
| `tasks[].title` | string | Human-readable task title |
| `tasks[].use_cases` | string[] | UC-XXXX IDs this task advances |
| `tasks[].feature` | string | Parent feature ID (FEAT-XXXX) |
| `tasks[].domain` | string | Domain name from DOMAINS.md |
| `tasks[].architecture` | string | Path to feature's ARCHITECTURE.md |
| `tasks[].intent` | string | `"implement"` or `"wire-bdd"` |
| `tasks[].status` | string | Current status from lifecycle |
| `tasks[].estimated_context` | string | Estimated context budget for this task |
| `tasks[].done_tags` | string[] | `@SC-XXXX` tags for filtered BDD gate; empty array runs full suite |
| `tasks[].depends_on` | string[] | Task IDs that must be `implemented` first |
| `tasks[].description` | string | What to implement, why, constraints |
| `tasks[].files_to_modify` | string[] | Expected file paths to create or modify |
| `tasks[].sub_tasks` | array\|null | Sub-task objects (null when no sub-tasks) |
| `tasks[].summary` | string\|null | Written post-build, null until then |
| `tasks[].commits` | string[] | Commit SHAs |
| `tasks[].quality_gates` | object\|null | Gate results |
| `tasks[].error` | string\|null | Last error message if failed |

## Worktree Naming

Each task gets its own worktree (sub-tasks share the parent's):

- **Path:** `.molcajete/worktrees/{FEAT-XXXX}-{T-NNN}`
- **Branch:** `dispatch/{FEAT-XXXX}-{T-NNN}`

Examples:
- `.molcajete/worktrees/FEAT-0F3y-T-001` on branch `dispatch/FEAT-0F3y-T-001`
- `.molcajete/worktrees/FEAT-0G2a-T-003` on branch `dispatch/FEAT-0G2a-T-003`

## Session Naming

- **Dev session:** `dev-{T-NNN}` or `dev-{T-NNN-M}`
- **Validation session:** `validate-{T-NNN}` or `validate-{T-NNN-M}`
- **Interactive (via /m:build):** No named session — runs in current session

## Summary Writing

After a task completes successfully, the summary is written into the task's `summary` field in the plan JSON file.

The summary contains:
- What was implemented (1-2 sentences)
- Key decisions made during implementation
- Watch-outs for dependent tasks

```json
"summary": "Implemented user registration endpoint with bcrypt password hashing. Key decisions: Used argon2id over bcrypt for future-proofing. Watch-outs: Registration handler is async — callers must await."
```
