---
name: dispatch
description: >-
  Rules and conventions for the build dispatch pipeline. Defines task status
  lifecycle, done signals, intent handling, retry policy, tasks.json schema,
  worktree naming, session naming, and summary writing. Referenced by build.md,
  task.md, and dispatch.sh.
---

# Dispatch

Rules for the `/m:build` dispatch pipeline. All build components — the entry point (`build.md`), the orchestration loop (`dispatch.sh`), and the task agent (`task.md`) — follow these conventions.

## When to Use

- Understanding how `/m:build` dispatches and gates tasks
- Writing or modifying dispatch pipeline components
- Referencing tasks.json schema or status lifecycle

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

Status updates happen in two places:
- **tasks.json** — machine-readable state, updated by dispatch.sh via jq
- **Plan file** — human-readable status field, updated by dispatch.sh via sed

Both must stay in sync. dispatch.sh is the only writer for both.

## Quality Gate (Adversarial Review)

Phase 2 of the pipeline — between the task agent and merge. Replaces the old standalone BDD gate. The review agent runs ALL quality checks in one pass.

### Adversarial by Construction

The review agent is designed to find problems, not confirm success:

- **Fresh session** — never shares context with the task agent that wrote the code
- **Different model** — Sonnet vs. the Opus task agent, providing a different perspective
- **Read-only** — has Read, Glob, Grep, Bash tools only. No Write or Edit. Cannot fix problems, only find them.
- **Independent context loading** — reads specs, code, and project rules from scratch

### 5 Gates (Run in Order)

| Gate | What it checks | Tool |
|------|---------------|------|
| **Formatting** | Changed files pass the project formatter in check mode | Bash (e.g., `prettier --check`) |
| **Linting** | Changed files pass the project linter | Bash (e.g., `eslint`, `ruff check`) |
| **BDD Tests** | Task's tagged scenarios pass | Bash (`$BDD_COMMAND --tags="..."`) |
| **Code Review** | Step definitions match specs; production code meets requirements | Read + adversarial analysis |
| **Completeness** | All requirements traced to code; no stubs/TODOs; project rules followed | Read + Grep |

All 5 gates must pass. If any gate fails, all issues go back to the task agent for fixing.

### Intent Awareness

The code review gate checks different things depending on intent:

- **`implement`** (forward path): step definition fidelity, production code conformance, unit test coverage
- **`wire-bdd`** (backward path): step definition accuracy, no production code changes, scenario coverage

### Rule Compliance

The review agent reads `CLAUDE.md` and `.claude/rules/*.md` in the project root and enforces project-specific conventions. Violations of mandatory rules are blocking; advisory rules produce warnings.

### Retry Flow

```
review fails → issues sent to task agent (resumed session) → task agent fixes → review agent runs again (fresh session)
```

Each review runs in a fresh session (`--name "review-{FEAT}-{TASK}"`). The fix goes to the task agent's existing session (`--resume "{FEAT}-{TASK}"`). Max retries apply (default 2).

### Severity Model

- **blocking** — fails the gate, stops the pipeline until fixed
- **warning** — logged in the plan summary but does not fail the gate

Verdict is `fail` if any gate fails or any issue is blocking. Warnings alone = `pass`.

### Validator Gate (Fallback)

For infrastructure tasks with no mapped scenarios (`done_signal: "validator"`), the BDD tests gate is skipped. All other gates still run.

## Intent Handling

Each task carries an `intent` field that controls task agent behavior:

| Intent | Set by | Task agent behavior |
|--------|--------|---------------------|
| `implement` | `/m:plan` | **Phase A:** Replace `NotImplementedError` stubs with real BDD assertion code. Commit step definitions. **Phase B:** Implement production code to make assertions pass. Write unit tests. Quality gates. Commit production code. |
| `wire-bdd` | `/m:reverse-plan` | **Single phase:** Write step definitions that exercise existing application code. No production code changes. Commit step definitions only. |

dispatch.sh passes the intent to the task agent. The agent adjusts its workflow accordingly.

## Retry Policy

- **Max retries per task:** 2 (configurable via `MOLCAJETE_MAX_RETRIES`)
- **Rate limit backoff:** Exponential — base 30s, doubling each attempt (configurable via `MOLCAJETE_BACKOFF_BASE`)
- **Review fix retries:** After review gate failure, dispatch.sh resumes the task agent session with all issues and re-runs the review (fresh session each time). Same max retry count.
- **Dependency failure:** If a task's dependency has status `failed`, the dependent task is immediately marked `failed` without execution.

## tasks.json Schema

Minimal machine-readable state for dispatch.sh to loop, gate, and report.

```json
{
  "plan_file": ".molcajete/plans/202603261430-user-authentication.md",
  "base_branch": "main",
  "bdd_command": "npx cucumber-js",
  "tasks": [
    {
      "id": "T-001",
      "title": "Auth foundation",
      "feature": "FEAT-0F3y",
      "use_cases": ["UC-0F4a", "UC-0F5b"],
      "intent": "implement",
      "status": "pending",
      "done_signal": "bdd",
      "done_tags": ["@SC-0A1b", "@SC-0A2c"],
      "depends_on": [],
      "architecture": "prd/features/FEAT-0F3y/ARCHITECTURE.md",
      "retries": 0,
      "commits": [],
      "review": null,
      "error": null
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `plan_file` | string | Relative path to the plan .md file |
| `base_branch` | string | Branch to merge completed tasks into |
| `bdd_command` | string | BDD runner command (from settings cache or detection) |
| `tasks[].id` | string | Task ID matching the plan file (T-001, T-002, ...) |
| `tasks[].title` | string | Human-readable task title |
| `tasks[].feature` | string | Parent feature ID (FEAT-XXXX) |
| `tasks[].use_cases` | string[] | UC-XXXX IDs this task advances |
| `tasks[].intent` | string | `"implement"` or `"wire-bdd"` |
| `tasks[].status` | string | Current status from lifecycle |
| `tasks[].done_signal` | string | `"bdd"` or `"validator"` |
| `tasks[].done_tags` | string[] | `@SC-XXXX` tags for BDD gate (empty for validator) |
| `tasks[].depends_on` | string[] | Task IDs that must be `implemented` first |
| `tasks[].architecture` | string | Path to feature's ARCHITECTURE.md |
| `tasks[].retries` | number | Current retry count |
| `tasks[].commits` | string[] | Commit SHAs from task agent |
| `tasks[].review` | object\|null | Review gate results: `{verdict, gates}` |
| `tasks[].error` | string\|null | Last error message if failed |

## Worktree Naming

Each task gets its own worktree:

- **Path:** `.worktrees/{FEAT-XXXX}-{T-NNN}`
- **Branch:** `dispatch/{FEAT-XXXX}-{T-NNN}`

Examples:
- `.worktrees/FEAT-0F3y-T-001` on branch `dispatch/FEAT-0F3y-T-001`
- `.worktrees/FEAT-0G2a-T-003` on branch `dispatch/FEAT-0G2a-T-003`

The feature ID prefix provides scope context. The task ID suffix provides uniqueness.

## Session Naming

Each agent runs in its own Claude session:

- **Task agent:** `{FEAT-XXXX}-{T-NNN}` (e.g., `FEAT-0F3y-T-001`)
- **Review agent:** `review-{FEAT-XXXX}-{T-NNN}` (e.g., `review-FEAT-0F3y-T-001`)
- **Architecture agent:** `arch-{FEAT-XXXX}-{T-NNN}` (e.g., `arch-FEAT-0F3y-T-001`)

The review agent always gets a fresh session (never resumed). The task agent session is resumed when the review sends back issues for fixing.

## Summary Writing

After a task completes successfully, dispatch.sh writes the agent's summary into the plan file's `#### Summary` block for that task.

The summary contains:
- What was implemented (1-2 sentences)
- Key decisions made during implementation
- Watch-outs for dependent tasks

dispatch.sh uses awk to find the `#### Summary` line under the task's `### T-NNN` heading and injects the content. The summary block in the plan template starts as:

```
#### Summary
{Written by m::build dispatcher after task completes — empty in generated plan}
```

After dispatch writes it:

```
#### Summary
Implemented user registration endpoint with bcrypt password hashing.
Key decisions: Used argon2id over bcrypt for future-proofing.
Watch-outs: Registration handler is async — callers must await.
```
