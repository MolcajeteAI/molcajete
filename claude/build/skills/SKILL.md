---
name: dispatch
description: >-
  Rules and conventions for the build dispatch pipeline. Defines session types,
  dev-test-review cycle, sub-task lifecycle, task status lifecycle, intent handling,
  quality gates, plan JSON schema, hook protocol, architecture updates, PRD
  propagation, and BDD test execution.
  Referenced by build.md, session commands, and molcajete.mjs.
---

# Dispatch

Rules for the build dispatch pipeline. All build components — session commands (`build/commands/*.md`) and the orchestrator (`molcajete.mjs`) — follow these conventions.

## When to Use

- Understanding how the build dispatch pipeline gates tasks
- Writing or modifying dispatch pipeline components
- Referencing plan JSON schema or status lifecycle
- Understanding the dev-test-review cycle and session types

## Session Types

The build pipeline uses purpose-specific sessions orchestrated by `molcajete.mjs`. Each session has a single responsibility.

| Session | Needs Claude? | Purpose |
|---------|---------------|---------|
| Development | Yes (Opus) | Write code, unit tests, commit changes |
| Test hook | No (hook) | Run all programmatic quality checks via developer-defined `test` hook |
| Review | Yes (Sonnet) | Code review + completeness gates (parallel read-only sub-agents) |
| Documentation | Yes (Haiku coordinator, Opus + Sonnet sub-agents) | Architecture updates, PRD propagation, README updates |

Session commands live in `${CLAUDE_PLUGIN_ROOT}/build/commands/`:
- `develop.md` — development session (implement code + tests, commit changes)
- `validate.md` — validation coordinator (code review + completeness gates only)
- `document.md` — documentation session (architecture updates, PRD propagation, READMEs)

## Dev-Test-Review Cycle

The core loop between development, testing, and review:

```
Dev Session (code + commit)
  │
  ▼
Test Hook (programmatic checks)
  │
  ├── fail ──> Dev Session (with issues) ──> loop back
  │
  └── pass ──> Review Session (Claude judgment)
                │
                ├── issues ──> Dev Session (with issues) ──> loop back to test
                │
                └── all clear ──> done (proceed to next sub-task or doc session)
                                    │
                                    └── max 7 total cycles ──> mark failed
```

- Max **7 dev-test-review cycles** per task or sub-task. Test and review failures consume cycles from the same budget.
- Each cycle is a fresh Claude session with full context budget.
- On failure, ALL issues from ALL gates are fed to the next dev session.
- The dev session fixes ALL issues in one pass — never one at a time.

### Validation Level by Context

| Context | Gates Run |
|---------|-----------|
| Sub-task (ID: `T-NNN-M`) | Test hook (scope: subtask) + review |
| Task (ID: `T-NNN`) | Test hook (scope: task) + review |

The test hook receives a `scope` field so the developer can decide what checks to run at each level — for example, skip BDD tests when scope is `"subtask"`.

## Sub-Task Lifecycle

Sub-tasks break a large task into sequential steps.

### Rules

- Sub-tasks are sequential steps on the same branch.
- Sub-tasks inherit `use_case`, `feature`, `module`, `architecture`, `intent`, `scenario` from the parent task.
- Sub-task `depends_on` references sibling sub-task IDs only (e.g., `T-003-1`).
- Sub-task IDs follow `T-NNN-M` format (parent ID + dash + integer). Never decimal.
- Sub-task state lives in `tasks[].sub_tasks[]` in the plan JSON.

### Execution Flow

1. Sub-tasks run sequentially (respecting `depends_on`)
2. Each sub-task goes through a dev-test-review cycle
3. After all sub-tasks complete, task-level validation runs (test hook with scope `task` + review)
4. If task-level validation fails, a fix dev session gets full task scope (all sub-task summaries, all files modified)

### Sub-Task Fields

Sub-task objects in the plan JSON:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `T-NNN-M` — parent task ID + dash + integer |
| `title` | string | Human-readable sub-task title |
| `status` | string | Same lifecycle as tasks: pending → in_progress → implemented/failed |
| `description` | string | What to implement |
| `files_to_modify` | string[] | Expected file paths |
| `estimated_context` | string | Estimated context budget for this sub-task |
| `depends_on` | string[] | Sibling sub-task IDs only |
| `summary` | string\|null | Written post-build |
| `errors` | string[] | Error messages if failed |

## Task Status Lifecycle

```
pending -> in_progress -> implemented
                       -> failed
```

| Status | Meaning |
|--------|---------|
| `pending` | Not started, waiting for dependencies or dispatch |
| `in_progress` | Currently being executed |
| `implemented` | Done signal satisfied |
| `failed` | Attempted but could not complete — needs intervention |

Status updates happen in the plan JSON file. The orchestrator (`molcajete.mjs`) handles all status transitions.

## BDD Command Detection

The `test` hook in `.molcajete/hooks/` handles all test execution including BDD. The orchestrator passes a `TestHookInput` payload:

```json
{
  "task_id": "T-001",
  "commit": "abc123...",
  "files": ["src/auth/register.ts"],
  "tags": ["@SC-0A1b"],
  "scope": "task | subtask | final"
}
```

The hook returns a `TestHookOutput`:

```json
{
  "status": "success | failure",
  "issues": []
}
```

The developer controls what runs at each scope level. The hook has the BDD framework command, tag syntax, and output format baked in by `/m:setup`. Users can replace it with any script in any language.

**Fallback** (if `test` hook is missing): the orchestrator aborts with a mandatory hook error. Run `molcajete setup` to generate hooks.

## Project Configuration

### Build Settings

Build behavior is configured in `.molcajete/settings.json`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxDevCycles` | number | `7` | Maximum dev-test-review cycles per task or sub-task |

### Hook Protocol

- **Location:** `.molcajete/hooks/{hook-name}.{ext}` (e.g., `test.mjs`, `start.sh`)
- **Discovery:** The orchestrator scans `.molcajete/hooks/` and matches files by name without extension
- **Format:** Executable files with shebangs (default: `#!/usr/bin/env node` for `.mjs`, any language works)
- **Input:** JSON payload via stdin
- **Output:** JSON to stdout
- **Exit codes:** 0 = success (read stdout JSON), non-zero = failure (stderr has details)

### Mandatory Hook (1)

| Hook | Purpose | Input | Output |
|------|---------|-------|--------|
| `test` | Run all programmatic quality checks | `TestHookInput` (see BDD Command Detection) | `TestHookOutput` |

If the mandatory hook is missing, the orchestrator aborts: `"Missing mandatory hook: test. Run molcajete setup or provide it manually."`

### Git Utilities for Hooks

The `@molcajeteai/cli` package exports three composable git utility functions that hook authors can use for branching and merging workflows:

```typescript
import { merge, rebase, resolveConflicts } from '@molcajeteai/cli';
```

| Function | Purpose |
|----------|---------|
| `merge(base, branch, options?)` | Merge `branch` into current HEAD. Defaults to `--ff-only`; set `{ ffOnly: false }` for real merges. Calls `resolveConflicts` on conflicts. |
| `rebase(onto, branch)` | Rebase `branch` onto `onto`. Calls `resolveConflicts` on conflicts. |
| `resolveConflicts()` | Raw primitive — assumes git is mid-merge or mid-rebase. Spawns Claude to resolve conflict markers, stage files, and continue. |

All three return `GitResult`: `{ status: 'success', commit: string }` or `{ status: 'failure', error: string }`.

**Example: `before-task` hook with branching:**

```typescript
import type { HookContext, TaskLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';
import { execSync } from 'node:child_process';

export default async function(ctx: HookContext<TaskLifecycleInput>): Promise<LifecycleOutput> {
  execSync(`git checkout -b task/${ctx.input.task_id}`, { stdio: 'pipe' });
  return { status: 'ok' };
}
```

**Example: `after-task` hook with rebase + merge:**

```typescript
import type { HookContext, TaskLifecycleInput, LifecycleOutput } from '@molcajeteai/cli';
import { rebase, merge } from '@molcajeteai/cli';
import { execSync } from 'node:child_process';

export default async function(ctx: HookContext<TaskLifecycleInput>): Promise<LifecycleOutput> {
  const branch = `task/${ctx.input.task_id}`;
  await rebase('main', branch);
  execSync('git checkout main', { stdio: 'pipe' });
  await merge('main', branch);
  return { status: 'ok' };
}
```

### Optional Hooks (10)

Generated with `molcajete setup --all`. The build does not abort for missing optional hooks.

| Hook | Purpose | Input | Default (without hook) |
|------|---------|-------|------------------------|
| `start` | Start dev environment | `{ build }` | No default (user starts manually) |
| `stop` | Stop dev environment | `{ build }` | No default (user stops manually) |
| `before-task` | Pre-task setup | `{ task_id, intent, feature_id?, usecase_id?, scenario_id?, build }` | No-op (skipped) |
| `after-task` | Post-task teardown or reporting | `{ task_id, status, summary, feature_id?, usecase_id?, scenario_id?, build }` | No-op (skipped) |
| `before-subtask` | Sub-task-level setup | `{ task_id, subtask_id, feature_id?, usecase_id?, scenario_id?, build }` | No-op (skipped) |
| `after-subtask` | Sub-task-level teardown | `{ task_id, subtask_id, status?, feature_id?, usecase_id?, scenario_id?, build }` | No-op (skipped) |
| `before-review` | Prepare for review | `{ task_id, build }` | No-op (skipped) |
| `after-review` | Collect review results | `{ task_id, issues, build }` | No-op (skipped) |
| `before-documentation` | Prepare for documentation | `{ build }` | No-op (skipped) |
| `after-documentation` | Post-documentation actions | `{ build }` | No-op (skipped) |

### Build Context

Every hook receives a `build` field (`BuildContext`) in its input payload containing plan-level context. The context is computed fresh from plan data each time a hook fires.

```typescript
interface BuildContext {
  plan_path: string;       // absolute path to plan.json
  plan_name: string;       // directory name (e.g., "202604021530-login")
  plan_status: string;     // current plan status
  base_branch: string;     // from plan data
  scope: string[];         // FEAT/UC IDs from plan scope
  stage: BuildStage;       // current pipeline stage
  completed: {
    tasks: string[];       // task IDs with status 'implemented'
    scenarios: string[];   // SC-XXXX IDs from completed tasks
    use_cases: string[];   // UC-XXXX where ALL plan tasks for that UC are done
    features: string[];    // FEAT-XXXX where ALL plan tasks for that feature are done
  };
}

type BuildStage = 'start' | 'before-task' | 'development' | 'validation' | 'after-task' | 'documentation' | 'stop';
```

**Stage values:**

| Stage | Hooks |
|-------|-------|
| `start` | `start` |
| `before-task` | `before-task`, `before-subtask`, `after-subtask` |
| `development` | `test` (during dev-test-review cycle) |
| `validation` | `test` (during task-level validation), `before-review`, `after-review` |
| `after-task` | `after-task` |
| `documentation` | `before-documentation`, `after-documentation` |
| `stop` | `stop` |

**Completion rollup** uses plan-scoped completion only:
- A UC is complete when ALL tasks in the plan that reference it are implemented
- A feature is complete when ALL tasks in the plan that reference it are implemented

### How the Orchestrator Uses Hooks

The orchestrator runs the `test` hook after the dev session commits. The test hook handles all programmatic checks — formatting, linting, BDD tests, whatever the developer configures.

After the test hook passes, the orchestrator spawns a **review session** (Claude Sonnet) for judgment-based gates: code review and completeness.

If either test or review fails, issues are collected and fed back to the next dev session.

## Implementation: `implement` Intent

Specs First (greenfield) — specs drive code creation.

### Phase A: Production Code

1. Read Gherkin `.feature` file(s) for this task's scenarios (grep `bdd/features/` for `@UC-XXXX` tag)
2. Read the task description and files-to-create/modify list from the plan
3. Implement production code following project conventions, guided by Gherkin assertions
4. Write unit tests for the implemented code
5. Run unit tests and fix failures. **If tests fail due to setup errors** (missing dependencies, services not running, database unreachable), apply the **hard stop rule** from the BDD Tests gate — stop immediately, do not continue.
6. Self-review: `git diff` — check for debug statements, commented-out code, hardcoded secrets, TODO placeholders, obvious logic errors
7. Proceed to Phase B.

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
8. Commit all changes using the git-committing skill.

## Implementation: `wire-bdd` Intent

Code First (brownfield) — BDD wiring for existing code.

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
10. Commit all changes using the git-committing skill.

## Quality Gates

Quality gates run in two phases: **test hook** (mechanical, developer-defined) then **Claude review** (judgment, Claude session).

### Phase 1: Test Hook (Orchestrator, No Claude)

The orchestrator calls the `test` hook after the dev session commits:

| Gate | Scope | What it checks |
|------|-------|----------------|
| Test hook | subtask | Developer decides — typically format + lint |
| Test hook | task | Developer decides — typically format + lint + BDD tests |
| Test hook | final | Full suite for all features in plan scope |

The developer controls what runs at each scope level via the hook implementation.

### Phase 2: Claude Gates (Review Session)

The validation coordinator session spawns parallel sub-agents for gates that require Claude judgment:

| Gate | What it checks | Mode |
|------|---------------|------|
| Code Review | Step defs match specs, code meets requirements | Read + analysis |
| Completeness | All requirements traced to code, no stubs/TODOs | Read + Grep |

### BDD Tests (via `test` Hook)

**The developer controls when BDD tests run** via the `scope` field in the test hook input. Typical patterns:
- `scope: "subtask"` — format + lint only (scenario isn't complete yet)
- `scope: "task"` — format + lint + BDD tests for the task's scenarios
- `scope: "final"` — full BDD suite for all features in plan scope

#### Setup Errors vs Test Failures — HARD STOP RULE

**Setup error (HARD STOP):** The test infrastructure itself is broken — tests cannot run at all. Indicators:
- Connection refused / connection timed out (services not running)
- HTTP 502 Bad Gateway / 503 Service Unavailable / 504 Gateway Timeout (upstream server down)
- Docker container not found / not running
- Database not reachable / authentication failed
- BDD runner not installed / command not found
- Missing Python/Node/Go dependencies required by the test runner

**If a setup error is detected:** The orchestrator immediately hard-stops the task — skips Claude gates, does NOT retry, marks the task as `failed` with errors `["Setup error: {description}"]`.

**Test failure (FIX IT):** Tests ran but assertions failed. The dev-test-review cycle handles this — issues are fed back to the dev session.

### Code Review (Intent-Aware)

- **`implement`:** Check step def fidelity, production code conformance, unit test coverage
- **`wire-bdd`:** Check step def accuracy, no production code changes, scenario coverage

### Completeness (Intent-Aware)

- **`implement`:** Trace every requirement to code, flag TODOs/stubs/empty bodies
- **`wire-bdd`:** Verify step defs for all scenarios, no stub markers, steps call real code
- **Both:** Check `CLAUDE.md` + `.claude/rules/` compliance

### Gate Results Format

The orchestrator collects results from test hook and Claude gates:

```json
{
  "test_issues": ["src/auth/register.ts:14: missing trailing comma"],
  "code_review": [],
  "completeness": []
}
```

- `test_issues` — populated by the test hook
- `code_review`, `completeness` — populated by Claude session

Empty array = gate passed. Non-empty = issues for that gate. The orchestrator checks: if all arrays empty → pass. Otherwise → feed all issues to the next dev session.

### Retry Policy

- **Max cycles:** 7 (dev-test-review cycles per task or sub-task)
- Each cycle: dev session fixes ALL issues, test hook + review re-check ALL gates
- After 7 failed cycles, the task is marked `failed` — NOT `implemented`
- **A task with failing tests is NEVER marked as done.**
- When a task fails, the build stops.

### Null `scenario` Behavior

When a task has `scenario: null`, the test hook still runs but receives empty `tags`. The developer can use this to skip BDD tests while still running format and lint checks. Only Claude gates (code review, completeness) always run.

## Documentation Session (Post-Validation)

After all validation passes, a dedicated doc session runs. This replaces inline docs updates — the dev session focuses purely on code.

### Task Flow

```
Dev → Test → Review → Doc Session → Doc Commit
```

### Doc Session

The orchestrator spawns a doc session (`document.md`) at haiku level. The session itself is lightweight coordination — it spawns two parallel sub-agents:

1. **Architecture agent** (opus) — Updates the feature's `ARCHITECTURE.md` (Component Inventory, Code Map, Architecture Decisions). Propagates PRD statuses (UC rollup → feature rollup).
2. **README agent** (sonnet, `implement` intent only, skipped for `wire-bdd`) — Examines `files_modified`, determines which directories need README creation/update, updates them.

### Doc Commit

After the doc session completes, the orchestrator stages doc files and commits with message `docs: update documentation for {T-NNN}`.

### Non-Blocking

Doc session failures are non-blocking warnings — the orchestrator logs the warning and proceeds.

### PRD Status Propagation

Handled by the architecture agent within the doc session.

**UC Status Rollup:**
For the UC-XXXX in the completed task's `use_case`:
1. Find the UC file: `prd/modules/*/features/*/use-cases/{UC-XXXX}-*.md`
2. Read all scenario headings (`### SC-XXXX`) from the UC file
3. Check if all scenario IDs are present in `scenario` fields of `implemented` tasks across the plan
4. If all scenarios covered → update UC status to `implemented`

**Feature Status Rollup:**
After updating UC statuses:
1. Read the feature's `USE-CASES.md`
2. If ALL UCs in the feature are `implemented` → update feature status in `prd/FEATURES.md`


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
  "tasks": [
    {
      "id": "T-001",
      "title": "Auth foundation",
      "use_case": "UC-0F4a",
      "feature": "FEAT-0F3y",
      "module": "app",
      "architecture": "prd/modules/app/features/FEAT-0F3y-auth-foundation/ARCHITECTURE.md",
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
| `tasks[].id` | string | Task ID (T-001, T-002, ...) |
| `tasks[].title` | string | Human-readable task title |
| `tasks[].use_case` | string | UC-XXXX ID this task advances |
| `tasks[].feature` | string | Parent feature ID (FEAT-XXXX) |
| `tasks[].module` | string | Module name from MODULES.md |
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

## Session Naming

- **Dev session:** `dev-{T-NNN}` or `dev-{T-NNN-M}`
- **Review session:** `review-{T-NNN}` or `review-{T-NNN-M}`
- **Doc session:** `doc-{T-NNN}`

## Summary Writing

After a task completes successfully, the summary is written into the task's `summary` field in the plan JSON file.

The summary contains:
- What was implemented (1-2 sentences)
- Key decisions made during implementation
- Watch-outs for dependent tasks

```json
"summary": "Implemented user registration endpoint with bcrypt password hashing. Key decisions: Used argon2id over bcrypt for future-proofing. Watch-outs: Registration handler is async — callers must await."
```
