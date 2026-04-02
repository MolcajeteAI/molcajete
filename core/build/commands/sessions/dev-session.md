---
description: Development session — implement code for a task or sub-task, write unit tests
model: claude-sonnet-4-6
argument-hint: "<json-payload>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
---

# Development Session

You implement code for a single task or sub-task. You write production code and unit tests. You do **NOT** run quality gates — the validation session handles that. You do **NOT** commit — the commit session handles that after validation passes.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `plan_path` | string | Absolute path to the plan JSON file |
| `task_id` | string | Task ID (e.g., `T-003`) or sub-task ID (e.g., `T-003-2`) |
| `worktree_path` | string | Absolute path to the worktree |
| `prior_summaries` | string[] | Summaries from completed prior tasks/sub-tasks |
| `issues` | string[] | Issues from a failed validation (empty on first run) |

## Step 1: Load Skills

Read skills that govern this session:

1. `${CLAUDE_PLUGIN_ROOT}/build/skills/dispatch/SKILL.md` — dispatch rules, implementation procedures
2. `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — BDD conventions

## Step 2: Load Context

1. Read the plan JSON file
2. Find the task (or parent task + sub-task) matching `task_id`
3. For sub-tasks: the parent task provides `use_cases`, `feature`, `domain`, `architecture`, `intent`, `done_tags`
4. Read project context files (in the worktree):
   - `prd/PROJECT.md`, `prd/TECH-STACK.md`, `prd/DOMAINS.md`
   - `CLAUDE.md` and `.claude/rules/*.md`
   - `.molcajete/apps.md`
   - Feature's REQUIREMENTS.md and ARCHITECTURE.md
   - Use case files and Gherkin feature files for the task's scenarios
   - `bdd/steps/INDEX.md`
5. Read prior task/sub-task summaries for context continuity
6. If `issues` is non-empty, these are validation failures from a prior cycle — focus on fixing them

## Step 3: Implement

### 3.0 Activate task scenarios

Before implementing, remove lifecycle tags (`@pending`, `@dirty`) from all scenarios matching this task's `done_tags` in `.feature` files:

1. For each `@SC-XXXX` in the task's `done_tags`:
   - Grep `bdd/features/` for `@SC-XXXX`
   - If found, edit the tag line to remove `@pending` and/or `@dirty`
2. This makes the scenarios "active" for the validation session's BDD gate
3. On retry cycles (issues list is non-empty), skip this step — tags were already removed on the first pass

Include the modified `.feature` files in the `files_modified` output.

### 3.1 Implementation

Follow the dispatch skill's implementation procedure based on the task's intent:

- **`implement` intent:** Phase A (production code + unit tests) then Phase B (step definitions + docs)
- **`wire-bdd` intent:** Single phase (step definitions + docs, no production code changes)

**On retry (issues list is non-empty):** Focus on fixing the reported issues. Read the specific files and lines mentioned. Fix all issues.

All work happens inside the worktree path.

## Step 4: Output

Respond with a structured JSON block:

```json
{
  "status": "done | failed",
  "files_modified": ["path/to/file"],
  "summary": "string",
  "key_decisions": ["string"],
  "error": null
}
```

- `status`: `"done"` when implementation is complete. `"failed"` only if something makes it impossible to continue (e.g., missing dependencies, unresolvable conflicts).
- `files_modified`: all files created or modified.
- `summary`: what was implemented and key decisions made.
- `key_decisions`: notable choices that affect dependent tasks/sub-tasks.
- `error`: null on success, error description on failure.

## Rules

- Do NOT run quality gates (formatting, linting, BDD tests). The validation session handles that.
- Do NOT merge or rebase. The orchestrator handles that.
- All work happens inside the worktree — never modify files outside it.
- Do NOT stage or commit — the commit session handles that after validation passes.
- If this is a retry, fix ALL reported issues in one pass — do not fix them one at a time.
