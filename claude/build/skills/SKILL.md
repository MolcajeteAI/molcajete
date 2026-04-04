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

Rules for the build dispatch pipeline. All build components — session commands (`build/commands/*.md`) and the orchestrator (`molcajete.mjs`) — follow these conventions.

## When to Use

- Understanding how the build dispatch pipeline gates tasks
- Writing or modifying dispatch pipeline components
- Referencing plan JSON schema or status lifecycle
- Understanding the dev-validate cycle and session types

## Session Types

The build pipeline uses purpose-specific sessions orchestrated by `molcajete.mjs`. Each session has a single responsibility.

| Session | Needs Claude? | Purpose |
|---------|---------------|---------|
| Pre-flight | No (hooks) | Health check + BDD tests via `health-check` and `run-tests` hooks |
| Worktree preparation | Node.js first, hook or Claude on error | Deterministic git commands; optional `create-worktree` hook; Claude fixes stale worktrees |
| Development | Yes | Write code, unit tests |
| Commit session | Yes | Stage files and create commits after validation passes (uses git-committing skill) |
| Validation (hooks) | No (hooks) | Format, lint, BDD tests via hooks (sub-second) |
| Validation (Claude) | Yes | Code review + completeness gates (parallel read-only sub-agents) |
| Documentation | Yes (haiku coordinator, opus + sonnet sub-agents) | Architecture updates, PRD propagation, README updates (post-commit, pre-merge) |
| Merge + cleanup | Node.js first, hook or Claude on conflict | Deterministic rebase/merge; optional `merge`/`cleanup` hooks; dev-validate cycle on conflicts |
| Post-flight | No (hooks) | Full BDD suite via `run-tests` hook |

Session commands live in `${CLAUDE_PLUGIN_ROOT}/build/commands/`:
- `develop.md` — development session (implement code + tests, no quality gates, no commits)
- `validate.md` — validation coordinator (code review + completeness gates only)
- `commit.md` — commit session (stages and commits validated changes using git-committing skill)
- `document.md` — documentation session (architecture updates, PRD propagation, READMEs)
- `resolve-conflicts.md` — diagnose and fix worktree creation failures

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
- Sub-tasks inherit `use_case`, `feature`, `domain`, `architecture`, `intent`, `scenario` from the parent task.
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
| `errors` | string[] | Error messages if failed |

## Pre-flight / Post-flight

### Pre-flight (Hook-Based)

Before any task runs, the orchestrator calls hooks programmatically (no Claude session):

1. `health-check` hook — verifies services are running (Docker, databases, etc.)
2. `run-tests` hook with `scope: "preflight"` — runs BDD tests filtered by all feature tags in the plan scope, excluding `@pending` and `@dirty` scenarios
3. **All checks must pass.** Any failure aborts the build.

This establishes a green baseline. Any failure in the final tests is then guaranteed to be caused by the plan's changes.

### Post-flight (Hook-Based)

After all tasks are implemented and merged:

1. `run-tests` hook with `scope: "final"` — runs BDD suite for all feature tags in the plan scope, excluding `@pending` and `@dirty` scenarios
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

The `run-tests` hook in `.molcajete/hooks/` handles all BDD test execution. The orchestrator passes tags as an array — the hook itself joins them with the framework's OR syntax (baked in by `/m:setup` as the `__TAG_JOIN__` placeholder). The orchestrator calls it with different inputs depending on context:

| Need | Input |
|------|-------|
| Pre-flight env check | `{ "tags": ["(@FEAT-XXXX or @FEAT-YYYY) and not @pending and not @dirty"], "scope": "preflight" }` |
| Task validation | `{ "tags": ["@SC-XXXX", "@SC-YYYY"], "scope": "task", "feature_id": "...", "usecase_id": "...", "scenario_id": "..." }` |
| Final tests | `{ "tags": ["(@FEAT-XXXX or @FEAT-YYYY) and not @pending and not @dirty"], "scope": "final" }` |

The hook has the BDD framework command, tag flag syntax, tag join separator, and output format baked in by `/m:setup`. Users can replace it with any script in any language.

**Fallback** (if `run-tests` hook is missing): the orchestrator aborts with a mandatory hook error. Run `/m:setup` to generate hooks.

## Project Configuration

### Build Settings

Build behavior is configured in `.molcajete/settings.json`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `useWorktrees` | boolean | `true` | Worktree mode (per-task isolation) vs serial mode (base branch). Implies parallel support when `true`. |
| `allowParallelTasks` | boolean | `false` | Allow parallel task execution (requires `useWorktrees: true`) |
| `startTimeout` | number | `120000` | Milliseconds to poll health-check after `start` hook before aborting |

### Environment Startup

The orchestrator manages environment lifecycle via hooks:

1. `start` hook (optional — if missing, assumes manual start)
2. Poll `health-check` every 10 seconds, printing per-service status
3. Continue until all services "ready" or `startTimeout` exceeded
4. Timeout aborts the build

**Worktree mode:** environment start/stop brackets each task (cwd = worktree). Pre-flight and post-flight get their own start/stop at project root.

**Serial mode:** environment starts once before pre-flight, stops after post-flight.

Project configuration is defined by executable hook scripts in `.molcajete/hooks/`. Each hook handles one checkpoint. Generated by `/m:setup` (Stage 5: Hook Generation), re-generable with `/m:setup` → "Update hooks only".

### Hook Protocol

- **Location:** `.molcajete/hooks/{hook-name}.{ext}` (e.g., `health-check.mjs`, `lint.sh`)
- **Discovery:** The orchestrator scans `.molcajete/hooks/` and matches files by name without extension
- **Format:** Executable files with shebangs (default: `#!/usr/bin/env node` for `.mjs`, any language works)
- **Input:** JSON payload via stdin
- **Output:** JSON to stdout
- **Exit codes:** 0 = success (read stdout JSON), non-zero = failure (stderr has details)

### Mandatory Hooks

| Hook | Purpose | Input | Output |
|------|---------|-------|--------|
| `health-check` | Verify dev environment services | `{ "services": [...] }` (optional filter) | `{ "status": "ready"\|"failed", "services": { "postgres": "ready", "redis": "failed" } }` |
| `run-tests` | Run BDD tests with tag filtering | `{ "tags": ["@SC-001", "@SC-002"], "scope": "task"\|"preflight"\|"final", "feature_id": "...", "usecase_id": "...", "scenario_id": "..." }` | `{ "status": "pass"\|"fail"\|"error", "failures": [], "summary": "" }` |
| `format` | Run formatter in check mode | `{ "files": [...], "services": ["server", "bdd"], "feature_id": "...", "usecase_id": "...", "scenario_id": "..." }` | `{ "status": "pass"\|"fail", "issues": [] }` |
| `lint` | Run linter in report mode | `{ "files": [...], "services": ["server", "bdd"], "feature_id": "...", "usecase_id": "...", "scenario_id": "..." }` | `{ "status": "pass"\|"fail", "issues": [] }` |

If a mandatory hook is missing, the orchestrator aborts: `"Missing mandatory hook: {name}. Run /m:setup or provide it manually."`

### Optional Hooks

**Generated by setup but not mandatory for build.** Setup creates `start`, `stop`, and `logs` hooks alongside the 4 mandatory hooks (7 total generated by default). The orchestrator calls `start` via `tryHook` in pre-flight — if the user deletes it, manual start is fine. The build does not abort for missing optional hooks.

| Hook | Purpose | Input | Default (without hook) |
|------|---------|-------|------------------------|
| `start` | Start dev environment (generated by setup) | `{ }` | No default (user starts manually) |
| `stop` | Stop dev environment (generated by setup) | `{ }` | No default (user stops manually) |
| `logs` | Retrieve environment logs (generated by setup) | `{ "service": "...", "lines": 100, "since": "5m" }` | No default (manual inspection) |
| `restart` | Stop then start dev environment | `{ }` | No default |
| `create-worktree` | Create a git worktree | `{ "path": "...", "branch": "...", "base_branch": "...", "feature_id": "...", "usecase_id": "..." }` | Built-in Node.js in molcajete.mjs |
| `cleanup` | Remove worktree and branch | `{ "path": "...", "branch": "...", "feature_id": "...", "usecase_id": "..." }` | Built-in Node.js in molcajete.mjs |
| `merge` | Merge task branch to base | `{ "worktree_path": "...", "branch": "...", "base_branch": "...", "feature_id": "...", "usecase_id": "..." }` | Built-in Node.js in molcajete.mjs |
| `before-task` / `after-task` | Task lifecycle events | `{ "task_id": "...", "feature_id": "...", "usecase_id": "...", "scenario_id": "...", ... }` | No-op (skipped) |
| `before-validate` / `after-validate` | Validation lifecycle events | `{ "task_id": "...", "feature_id": "...", "usecase_id": "...", "scenario_id": "...", "services": [...], ... }` | No-op (skipped) |
| `before-commit` / `after-commit` | Commit lifecycle events | `{ "task_id": "...", "feature_id": "...", "usecase_id": "...", "scenario_id": "...", "files": [...], "base_branch": "...", "working_branch": "...", ... }` | No-op (skipped) |

### How the Orchestrator Uses Hooks

**Mechanical gates** (format, lint, BDD tests) run as hook calls — sub-second, no Claude session needed:
- `format` hook runs in check mode (never writes files)
- `lint` hook runs in report mode (never auto-fixes)
- `run-tests` hook runs BDD tests with tag filtering
- The orchestrator runs format then lint sequentially (both may affect the same files), then BDD

**Claude gates** (code review, completeness) still run as Claude sessions — these require judgment.

**Service filtering by intent:**
- **`wire-bdd` intent:** hooks receive `{ "services": ["bdd"], "files": [...] }`
- **`implement` intent:** hooks receive `{ "services": ["{service}", "bdd"], "files": [...] }`

When `files` are available (from the dev session's `files_modified` output), they are passed to format/lint hooks for file-aware routing. When not available, the hooks fall back to checking the full service directory.

## Worktree Management

### Creation

Create a worktree for each task (not per sub-task), branching from the plan's base branch:

```bash
mkdir -p .molcajete/worktrees
git worktree add -b "dispatch/{FEAT}-{T-NNN}" ".molcajete/worktrees/{FEAT}-{T-NNN}" "{BASE_BRANCH}"
```

All sub-tasks share the parent task's worktree. The orchestrator attempts creation via Node.js first — on failure, it spawns a resolve-conflicts session (Claude) to diagnose and resolve.

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

### Serial Mode (No Worktrees)

When `useWorktrees` is `false`:
- No worktree creation, merge, or cleanup
- Dev/validation sessions run with cwd = project root
- Commits land directly on the base branch
- Environment runs once for the entire build

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

3. **Update plan file and commit atomically:** Update the task's status to `implemented`, write the `summary` field in the plan JSON, then commit the plan file on the base branch:
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

### Phase B: Step Definitions

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
8. All files are now ready for validation. Do not commit — the commit step handles this after validation.

## Implementation: `wire-bdd` Intent

Reverse path — BDD wiring for existing code.

### Single Phase: Step Definitions

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
8. **Do NOT modify production code** — only step definitions
9. Update `bdd/steps/INDEX.md`
10. All files are now ready for validation. Do not commit — the commit step handles this after validation.

## Quality Gates

Quality gates run in two phases: **hook gates** (mechanical, sub-second) then **Claude gates** (judgment, Claude session).

### Phase 1: Hook Gates (Orchestrator, No Claude)

The orchestrator calls these hooks programmatically — no Claude session needed:

| Gate | Hook | Mode | When |
|------|------|------|------|
| Formatting | `format` | Check/dry-run (no writes) | Always |
| Linting | `lint` | Report only (no --fix) | Always |
| BDD Tests | `run-tests` | Run tests | Task-level only (skipped for sub-tasks) |

Format and lint run **sequentially** (both may affect the same files). BDD runs after both.

The orchestrator passes service and file information based on intent:
- **`wire-bdd` intent:** `{ "services": ["bdd"], "files": [...] }`
- **`implement` intent:** `{ "services": ["{service}", "bdd"], "files": [...] }`

### Phase 2: Claude Gates (Validation Session)

The validation coordinator session spawns parallel sub-agents for gates that require Claude judgment:

| Gate | What it checks | Mode |
|------|---------------|------|
| Code Review | Step defs match specs, code meets requirements | Read + analysis |
| Completeness | All requirements traced to code, no stubs/TODOs | Read + Grep |

### BDD Tests (via `run-tests` Hook)

**MANDATORY at task level — skipped for sub-tasks.**

The orchestrator calls the `run-tests` hook:
- If `scenario` is non-null: `{ "tags": ["@SC-XXXX"], "scope": "task" }` (derived by prepending `@` to `scenario`)
- If `scenario` is null: BDD hook is not called

#### Setup Errors vs Test Failures — HARD STOP RULE

**Setup error (HARD STOP):** The test infrastructure itself is broken — tests cannot run at all. Indicators:
- Connection refused / connection timed out (services not running)
- HTTP 502 Bad Gateway / 503 Service Unavailable / 504 Gateway Timeout (upstream server down)
- Docker container not found / not running
- Database not reachable / authentication failed
- BDD runner not installed / command not found
- Missing Python/Node/Go dependencies required by the test runner

**If a setup error is detected:** The `run-tests` hook returns `status: "error"`. The orchestrator immediately hard-stops the task — skips Claude gates, does NOT retry, marks the task as `failed` with errors `["Setup error: {description}"]`.

**Test failure (FIX IT):** Tests ran but assertions failed. The `run-tests` hook returns `status: "fail"`. The dev-validate cycle handles this — issues are fed back to the dev session.

### Code Review (Intent-Aware)

- **`implement`:** Check step def fidelity, production code conformance, unit test coverage
- **`wire-bdd`:** Check step def accuracy, no production code changes, scenario coverage

### Completeness (Intent-Aware)

- **`implement`:** Trace every requirement to code, flag TODOs/stubs/empty bodies
- **`wire-bdd`:** Verify step defs for all scenarios, no stub markers, steps call real code
- **Both:** Check `CLAUDE.md` + `.claude/rules/` compliance

### Gate Results Format

The orchestrator collects results from both hook gates and Claude gates into a unified structure:

```json
{
  "formatting": [],
  "linting": ["src/auth/register.ts:14: missing trailing comma"],
  "bdd_tests": ["@SC-0A1b: expected 200 got 422 on POST /auth/register"],
  "code_review": [],
  "completeness": []
}
```

- `formatting`, `linting`, `bdd_tests` — populated by hooks (sub-second)
- `code_review`, `completeness` — populated by Claude session

Empty array = gate passed. Non-empty = issues for that gate. The orchestrator checks: if all arrays empty → pass. Otherwise → feed all issues to the next dev session.

### Retry Policy

- **Max cycles:** 7 (dev-validate cycles per task or sub-task)
- Each cycle: dev session fixes ALL issues, validation session re-checks ALL gates
- After 7 failed cycles, the task is marked `failed` — NOT `implemented`
- **A task with failing tests is NEVER marked as done.**
- When a task fails, the build stops.

### Null `scenario` Behavior

When a task has `scenario: null`, the BDD gate is **skipped**. Only format, lint, code review, and completeness gates run. Null `scenario` is only valid for sub-tasks and chores tasks (documentation).

## Documentation Session (Post-Commit, Pre-Merge)

After the code commit passes, a dedicated doc session runs before the merge. This replaces inline docs updates — the dev session focuses purely on code.

### Task Flow

```
Dev → Validate → Code Commit → Doc Session → Doc Commit → Merge
```

### Doc Session

The orchestrator spawns a doc session (`document.md`) at haiku level. The session itself is lightweight coordination — it spawns two parallel sub-agents:

1. **Architecture agent** (opus) — Updates the feature's `ARCHITECTURE.md` (Component Inventory, Code Map, Architecture Decisions). Propagates PRD statuses (UC rollup → feature rollup).
2. **README agent** (sonnet, `implement` intent only, skipped for `wire-bdd`) — Examines `files_modified`, determines which directories need README creation/update, updates them.

### Doc Commit

After the doc session completes, the orchestrator stages doc files and commits with message `docs: update documentation for {T-NNN}`.

### Non-Blocking

Doc session failures are non-blocking warnings — the code still merges. The orchestrator logs the warning and proceeds to merge.

### PRD Status Propagation

Handled by the architecture agent within the doc session.

**UC Status Rollup:**
For the UC-XXXX in the completed task's `use_case`:
1. Find the UC file: `prd/domains/*/features/*/use-cases/{UC-XXXX}-*.md`
2. Read all scenario headings (`### SC-XXXX`) from the UC file
3. Check if all scenario IDs are present in `scenario` fields of `implemented` tasks across the plan
4. If all scenarios covered → update UC status to `implemented`

**Feature Status Rollup:**
After updating UC statuses:
1. Read the feature's `USE-CASES.md`
2. If ALL UCs in the feature are `implemented` → update feature status in `prd/FEATURES.md`
3. Skip features in the `global` domain (spec-only, no implementation status)

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
  "base_branch": "main",
  "bdd_command": "npx cucumber-js",
  "tasks": [
    {
      "id": "T-001",
      "title": "Auth foundation",
      "use_case": "UC-0F4a",
      "feature": "FEAT-0F3y",
      "domain": "app",
      "architecture": "prd/domains/app/features/FEAT-0F3y-auth-foundation/ARCHITECTURE.md",
      "intent": "implement",
      "status": "pending",
      "estimated_context": "~120K tokens",
      "scenario": "SC-0A1b",
      "depends_on": [],
      "description": "Implement user registration and login endpoints",
      "files_to_modify": ["src/auth/register.ts", "src/auth/login.ts"],
      "sub_tasks": null,
      "summary": null,
      "errors": []
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
| `base_branch` | string | Branch to merge completed tasks into |
| `bdd_command` | string\|null | BDD runner command |
| `tasks[].id` | string | Task ID (T-001, T-002, ...) |
| `tasks[].title` | string | Human-readable task title |
| `tasks[].use_case` | string | UC-XXXX ID this task advances |
| `tasks[].feature` | string | Parent feature ID (FEAT-XXXX) |
| `tasks[].domain` | string | Domain name from DOMAINS.md |
| `tasks[].architecture` | string | Path to feature's ARCHITECTURE.md |
| `tasks[].intent` | string | `"implement"` or `"wire-bdd"` |
| `tasks[].status` | string | Current status from lifecycle |
| `tasks[].estimated_context` | string | Estimated context budget for this task |
| `tasks[].scenario` | string\|null | `SC-XXXX` for regular tasks; null for chores tasks (BDD skipped) |
| `tasks[].depends_on` | string[] | Task IDs that must be `implemented` first |
| `tasks[].description` | string | What to implement, why, constraints |
| `tasks[].files_to_modify` | string[] | Expected file paths to create or modify |
| `tasks[].sub_tasks` | array\|null | Sub-task objects (null when no sub-tasks) |
| `tasks[].summary` | string\|null | Written post-build, null until then |
| `tasks[].errors` | string[] | Error messages if failed |

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
- **Single-task (via marketplace plugin):** No named session — runs in current session

## Summary Writing

After a task completes successfully, the summary is written into the task's `summary` field in the plan JSON file.

The summary contains:
- What was implemented (1-2 sentences)
- Key decisions made during implementation
- Watch-outs for dependent tasks

```json
"summary": "Implemented user registration endpoint with bcrypt password hashing. Key decisions: Used argon2id over bcrypt for future-proofing. Watch-outs: Registration handler is async — callers must await."
```
