---
name: dispatch
description: >-
  Rules and conventions for the build dispatch pipeline. Defines task status
  lifecycle, done signals, intent handling, quality gates, plan JSON schema,
  worktree naming, session naming, summary writing, merge procedure, conflict
  resolution, architecture updates, PRD propagation, and BDD detection.
  Referenced by build.md and molcajete.mjs.
---

# Dispatch

Rules for the `/m:build` dispatch pipeline. All build components — the skill entry point (`build.md`) and the shell script (`molcajete.mjs`) — follow these conventions.

## When to Use

- Understanding how `/m:build` dispatches and gates tasks
- Writing or modifying dispatch pipeline components
- Referencing plan JSON schema or status lifecycle

## Task Status Lifecycle

```
pending -> in_progress -> implemented
                       -> failed
```

| Status | Meaning |
|--------|---------|
| `pending` | Not started, waiting for dependencies or dispatch |
| `in_progress` | Currently being executed by a task agent |
| `implemented` | Done signal satisfied, merged to base branch |
| `failed` | Attempted but could not complete — needs intervention |

Status updates happen in the plan JSON file. When running via `molcajete.mjs`, the script handles post-task updates. When running via `/m:build` skill, the task agent updates the plan file directly.

## BDD Command Detection

Detect the BDD runner command using this priority:

1. **Cached setting:** Read `.molcajete/settings.json` → `bdd.framework` field. If present, use it and skip detection.
2. **BDD CLAUDE.md hint:** Read `bdd/CLAUDE.md` for runner hints.
3. **Step file extension sniffing:** Check `bdd/steps/` for file extensions:

| Extension | Framework | Command |
|-----------|-----------|---------|
| `.py` | behave | `behave` |
| `.ts` | cucumber-js | `npx cucumber-js` |
| `.js` | cucumber-js | `npx cucumber-js` |
| `.go` | godog | `godog` |
| `.rb` | cucumber-ruby | `bundle exec cucumber` |

After detection, cache the result in `.molcajete/settings.json` under `bdd.framework` so sniffing only runs once.

## Project Tooling Settings

The task agent reads `.molcajete/settings.json` for tooling commands. These are populated by `/m:setup` (tooling detection stage) and can be re-detected with `/m:setup` → "Update tooling only".

### Settings Schema

```json
{
  "bdd": {
    "language": "python",
    "framework": "behave",
    "format": "gherkin",
    "detected_at": "2026-03-31T10:00:00Z"
  },
  "environment": {
    "runtime": "docker-compose",
    "compose_file": "docker-compose.yml",
    "services": ["nginx", "server-dev", "server-test", "postgres", "redis"],
    "start": "make dev-d",
    "stop": "make dev-down",
    "detected_at": "2026-03-31T10:00:00Z"
  },
  "tooling": {
    "bdd": {
      "root": "bdd/",
      "language": "python",
      "format": { "command": "ruff format bdd/", "tool": "ruff" },
      "lint": { "command": "ruff check bdd/", "tool": "ruff" }
    },
    "server": {
      "root": "server/",
      "language": "go",
      "format": { "command": "make -C server fmt", "tool": "gofmt" },
      "lint": { "command": "make -C server lint", "tool": "golangci-lint" },
      "test": { "command": "make -C server test", "tool": "go test" }
    },
    "patient": {
      "root": "apps/patient/",
      "language": "typescript",
      "format": { "command": "pnpm --filter patient format", "tool": "biome" },
      "lint": { "command": "pnpm --filter patient lint", "tool": "biome" },
      "test": { "command": "pnpm --filter patient test", "tool": "vitest" }
    }
  },
  "scripts": {
    "make_targets": { "root": ["dev", "bdd", "init"], "server": ["build", "fmt", "lint", "test"] },
    "pnpm_scripts": { "root": ["dev", "build", "lint", "format"], "patient": ["dev", "build", "lint", "format", "test"] }
  },
  "warnings": []
}
```

The `tooling.bdd` entry is special — it holds format and lint commands for BDD step definition files (`bdd/`). It is always present when BDD is configured.

### How the Build Agent Uses Settings

**Tooling lookup by intent:**

- **`wire-bdd` intent:** Use `tooling.bdd` for formatting and linting (step definitions only, no production code).
- **`implement` intent:** Use `tooling.{domain}` for production code in Batch 1. After committing step definitions (Phase B), also run `tooling.bdd` format + lint on the `bdd/` directory.

**Other settings:**
- **BDD tests:** Read `bdd.framework` for the runner command.
- **Environment awareness:** Read `environment.runtime` to understand whether services run in Docker. If `docker-compose`, the agent knows services are containerized and should not try to start them locally.
- **Available scripts:** `scripts.make_targets` and `scripts.pnpm_scripts` tell the agent what commands exist without scanning Makefiles every time.

**Never skip format/lint as "not detected"** when `tooling` entries exist in settings.json. Only skip if settings.json has no `tooling` key AND no config files are found in the project.

## Worktree Management

### Creation

Create a worktree for each task, branching from the plan's base branch:

```bash
mkdir -p .molcajete/worktrees
git worktree add -b "dispatch/{FEAT}-{T-NNN}" ".molcajete/worktrees/{FEAT}-{T-NNN}" "{BASE_BRANCH}"
```

All subsequent work for that task happens inside this worktree path.

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

After all quality gates pass, merge the task's worktree branch back to the base branch.

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

3. **Cleanup worktree and branch:** (see Worktree Management → Cleanup)

If the merge itself fails after rebase, set task status to `failed`.

## Conflict Resolution

Rebase conflicts are resolved inline by the task agent.

### Primary: Resolve in Place

1. For each conflicted file, read the conflict markers and resolve using knowledge of the spec and implementation.
2. Stage resolved files: `git add {file}`
3. Continue rebase: `git -C "{worktree_path}" rebase --continue`

### Fallback: Replay on Fresh Base

If inline resolution fails or creates broken code:

1. Abort the rebase: `git -C "{worktree_path}" rebase --abort`
2. Note the commit SHAs from the worktree branch.
3. Create a fresh branch from the current base:
   ```bash
   git checkout "{BASE_BRANCH}"
   git checkout -b "dispatch/{FEAT}-{T-NNN}-replay"
   ```
4. Cherry-pick each commit in order, resolving conflicts as they arise.
5. Re-run BDD tests for the task's tags to validate.
6. If validation passes, use the replay branch for the merge. Clean up the original branch.

## Implementation: `implement` Intent

Forward path — specs drive code creation.

### Phase A: Production Code

1. Read Gherkin `.feature` file(s) for this task's scenarios (grep `bdd/features/` for `@UC-XXXX` tag)
2. Read the task description and files-to-create/modify list from the plan
3. Implement production code following project conventions, guided by Gherkin assertions
4. Write unit tests for the implemented code
5. Run unit tests and fix failures. **If tests fail due to setup errors** (missing dependencies, services not running, database unreachable), apply the **hard stop rule** from the BDD Tests gate — stop immediately, do not continue.
6. **Pre-commit quality check (sequential):** Run formatter then linter as a chained command (e.g., `npx prettier --write . && npx eslint --fix .`). Sequential — both modify files.
7. Self-review: `git diff` — check for debug statements, commented-out code, hardcoded secrets, TODO placeholders, obvious logic errors
8. Re-run unit tests if anything changed
9. Stage and commit production code (exclude BDD files):
   ```bash
   git add -A
   git reset HEAD -- bdd/
   git commit -m "{message per git-committing skill, including refs block}"
   ```

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
9. Stage and commit step definitions + docs together:
   ```bash
   git add bdd/ prd/ "{architecture_path}" {readme_paths}
   git commit -m "{message per git-committing skill, including refs block}"
   ```

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
11. Stage and commit step definitions + docs together:
    ```bash
    git add bdd/ prd/ "{architecture_path}"
    git commit -m "{message per git-committing skill, including refs block}"
    ```

## Quality Gate (Self-Validation)

The task agent runs all quality checks internally before merging. No separate review agent.

### 5 Gates (Two Batches)

**Batch 1 (sequential, single command):** Formatter + linter — these modify files.
**Batch 2 (parallel):** BDD tests, code review, completeness — read-only.

| Gate | Batch | What it checks | Tool |
|------|-------|---------------|------|
| Formatting | 1 | Changed files pass formatter | Bash (chained) |
| Linting | 1 | Changed files pass linter | Bash (chained) |
| BDD Tests | 2 | Task's tagged scenarios pass | Bash |
| Code Review | 2 | Step defs match specs, code meets requirements | Read + analysis |
| Completeness | 2 | All requirements traced to code, no stubs/TODOs | Read + Grep |

### Batch 1: Formatting + Linting

**Read tooling commands from `.molcajete/settings.json`** based on the task's intent:

- **`wire-bdd` intent:** Use `tooling.bdd.format.command` and `tooling.bdd.lint.command` (step definitions are in `bdd/`, not in any domain directory).
- **`implement` intent:** Use `tooling.{domain}.format.command` and `tooling.{domain}.lint.command` for production code, PLUS `tooling.bdd.format.command` and `tooling.bdd.lint.command` for step definitions written in Phase B.

Chain format then lint as a single sequential command per tooling entry:
```bash
# For wire-bdd:
{bdd_format_command} && {bdd_lint_command}

# For implement (production + bdd):
{domain_format_command} && {domain_lint_command} && {bdd_format_command} && {bdd_lint_command}
```

**Fallback:** If settings.json has no `tooling` key at all, fall back to scanning for config files (biome.json, .eslintrc, .golangci.yml, etc.) and building the command manually. But if `tooling` exists and has the relevant entry, use it — do not scan.

**Never skip** format or lint when a tooling entry exists in settings.json. Only skip if no `tooling` key exists AND no config files are found.

### Batch 2: BDD Tests

Run the BDD runner command with the task's done signal tags:
```bash
{bdd_command} --tags="@SC-XXXX or @SC-YYYY"
```

Skip only if `done_signal` is `validator`. You MUST actually run the command — do not skip because you think services aren't running.

#### Setup Errors vs Test Failures — HARD STOP RULE

After running tests, examine the output carefully and classify the result:

**Setup error (HARD STOP):** The test infrastructure itself is broken — tests cannot run at all. Indicators:
- Connection refused / connection timed out (services not running)
- Docker container not found / not running
- Database not reachable / authentication failed
- BDD runner not installed / command not found
- Missing Python/Node/Go dependencies required by the test runner
- Port not open / host not reachable
- Virtual environment not activated / packages not installed

**If a setup error is detected:** Immediately set the task status to `failed` with error `"Setup error: {description}"` and STOP. Do not retry, do not attempt to fix infrastructure, do not continue to other gates. This is a hard stop — no way around it. The user must fix the environment before re-running.

**Test failure (FIX IT):** Tests ran but assertions failed due to code issues. Indicators:
- Assertion errors (expected X got Y)
- HTTP status code mismatches (expected 200, got 422)
- Missing fields, wrong values, logic errors
- Step definition errors (undefined steps, wrong patterns)

**If tests fail due to code issues:** This is normal — fix the code. Follow the Gate Resolution and Retry Policy below. Tests must pass 100% before proceeding.

### Batch 2: Code Review (Self-Review, Intent-Aware)

- **`implement`:** Check step def fidelity (assertions match Gherkin specs), production code conformance (requirements addressed), unit test coverage
- **`wire-bdd`:** Check step def accuracy (calls correct functions/endpoints), no production code changes, scenario coverage

### Batch 2: Completeness (Intent-Aware)

- **`implement`:** Trace every requirement to code, flag TODOs/stubs/empty bodies
- **`wire-bdd`:** Verify step defs for all scenarios, no stub markers, steps call real code
- **Both:** Check `CLAUDE.md` + `.claude/rules/` compliance

### Gate Resolution

**BDD tests are a mandatory pass gate.** A task CANNOT be marked `done` or `implemented` if BDD tests are failing. There are zero exceptions. If the BDD tests gate fails, the task fails — period.

If all gates pass → proceed to merge.

If any gate fails → fix ALL reported issues in a single patch. Collect all failures across all gates, fix them all, commit, then re-run all gates from Batch 1. Do not fix one issue at a time.

**What "fix" means for BDD test failures:** Read the error output. Trace the failure to the root cause — wrong GraphQL mutation, missing field, incorrect URL, broken step definition logic, etc. Fix the actual code (step definitions for `wire-bdd`, production code + step definitions for `implement`). Do NOT mark the test as skipped, do NOT remove the failing scenario, do NOT report `done` with a watch-out. Fix the code until the test passes.

### Retry Policy

- **Max attempts:** 5 (internal to the task agent)
- Each attempt: fix ALL issues from ALL failing gates in one patch, commit, re-run all gates
- After 5 failed attempts, the task is marked `failed` with status `failed` — NOT `done`, NOT `implemented`
- **A task with failing tests is NEVER marked as done.** The task MUST fail if retries are exhausted.
- When a task fails, the next task in the plan MUST NOT start. The build stops.

### Intent Awareness

- **`implement`** (forward path): step definition fidelity, production code conformance, unit test coverage
- **`wire-bdd`** (backward path): step definition accuracy, no production code changes, scenario coverage

### Rule Compliance

The task agent reads `CLAUDE.md` and `.claude/rules/*.md` in the project root and enforces project-specific conventions during the completeness gate.

### Validator Gate (Fallback)

For infrastructure tasks with no mapped scenarios (`done_signal: "validator"`), the BDD tests gate is skipped. All other gates still run.

## Docs Update (Pre-Commit)

Architecture, PRD status, and README updates are folded into the task's **final commit** — not separate commits. These updates happen after quality gates pass, before the final stage and commit.

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
4. If all scenarios covered → update UC status to `implemented`:
   - In the UC file: change `status: pending` (or `dirty`) → `status: implemented`
   - In the feature's `USE-CASES.md`: update the row for this UC

**Feature Status Rollup:**
After updating UC statuses:
1. Read the feature's `USE-CASES.md`
2. If ALL UCs in the feature are `implemented` → update feature status:
   - In `prd/FEATURES.md`: update the row for this feature to `implemented`
3. Skip features in the `global` domain (spec-only, no implementation status)

### Code Directory README Updates (`implement` intent only)

For `implement` tasks only (not `wire-bdd`), update or create `README.md` files in code directories that were created or significantly modified by this task. This keeps code documentation in sync with implementation.

**When to update:**
- A new directory was created (e.g., `server/internal/auth/`) → create a README.md describing the package/module
- An existing directory received substantial new files → update its README.md if one exists

**What to include:**
- Package/module purpose (one paragraph)
- Key files and their roles
- Public API or exported functions (if applicable)
- Dependencies and usage patterns

**Do NOT** create README.md in every directory touched — only in directories where a new package, module, or logical grouping was introduced.

### Staging Docs with Final Commit

All docs updates (ARCHITECTURE.md, PRD status files, README.md) are staged together with the final code commit:

- **`wire-bdd` intent:** stage docs alongside step definitions in the single commit
- **`implement` intent:** stage docs alongside step definitions in the Phase B commit

```bash
# After making all docs updates:
git add "{architecture_path}" prd/ {readme_paths}
# These files are staged BEFORE the final commit — not as a separate commit
```

## Rate Limit Backoff

When running via `molcajete.mjs`, rate limit retries use exponential backoff:
- **Base:** 30s (configurable via `MOLCAJETE_BACKOFF_BASE`)
- **Growth:** doubling each attempt

## Plan JSON Schema

The plan file at `.molcajete/plans/{YYYYMMDDHHmm}-{slug}.json` is the single source of truth for both plan content and dispatch state.

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
      "architecture": "prd/domains/app/features/FEAT-0F3y/ARCHITECTURE.md",
      "intent": "implement",
      "status": "pending",
      "estimated_context": "~120K tokens",
      "done_signal": "bdd",
      "done_tags": ["@SC-0A1b", "@SC-0A2c"],
      "depends_on": [],
      "description": "Implement user registration and login endpoints",
      "files_to_modify": ["src/auth/register.ts", "src/auth/login.ts"],
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
| `bdd_command` | string\|null | BDD runner command (from settings cache or detection, null if not yet detectable) |
| `tasks[].id` | string | Task ID (T-001, T-002, ...) |
| `tasks[].title` | string | Human-readable task title |
| `tasks[].use_cases` | string[] | UC-XXXX IDs this task advances |
| `tasks[].feature` | string | Parent feature ID (FEAT-XXXX) |
| `tasks[].domain` | string | Domain name from DOMAINS.md |
| `tasks[].architecture` | string | Path to feature's ARCHITECTURE.md |
| `tasks[].intent` | string | `"implement"` or `"wire-bdd"` |
| `tasks[].status` | string | Current status from lifecycle |
| `tasks[].estimated_context` | string | Estimated context budget for this task |
| `tasks[].done_signal` | string | `"bdd"` or `"validator"` |
| `tasks[].done_tags` | string[] | `@SC-XXXX` tags for BDD gate (empty for validator) |
| `tasks[].depends_on` | string[] | Task IDs that must be `implemented` first |
| `tasks[].description` | string | What to implement, why, constraints |
| `tasks[].files_to_modify` | string[] | Expected file paths to create or modify |
| `tasks[].summary` | string\|null | Written post-build, null until then |
| `tasks[].commits` | string[] | Commit SHAs from task agent |
| `tasks[].quality_gates` | object\|null | Gate results: `{formatting, linting, bdd_tests, code_review, completeness}` |
| `tasks[].error` | string\|null | Last error message if failed |

## Worktree Naming

Each task gets its own worktree:

- **Path:** `.molcajete/worktrees/{FEAT-XXXX}-{T-NNN}`
- **Branch:** `dispatch/{FEAT-XXXX}-{T-NNN}`

Examples:
- `.molcajete/worktrees/FEAT-0F3y-T-001` on branch `dispatch/FEAT-0F3y-T-001`
- `.molcajete/worktrees/FEAT-0G2a-T-003` on branch `dispatch/FEAT-0G2a-T-003`

The feature ID prefix provides scope context. The task ID suffix provides uniqueness.

## Session Naming

- **Task agent (via skill):** No named session needed — runs in the current interactive session
- **Task agent (via molcajete.mjs):** `{FEAT-XXXX}-{T-NNN}` (forked from context session)
- **Context session (molcajete.mjs):** `ctx-{timestamp}` (shared across tasks in one plan)

## Summary Writing

After a task completes successfully, the summary is written into the task's `summary` field in the plan JSON file.

The summary contains:
- What was implemented (1-2 sentences)
- Key decisions made during implementation
- Watch-outs for dependent tasks

The `summary` field starts as `null` in the generated plan. After completion, it is set to a string:

```json
"summary": "Implemented user registration endpoint with bcrypt password hashing. Key decisions: Used argon2id over bcrypt for future-proofing. Watch-outs: Registration handler is async — callers must await."
```
