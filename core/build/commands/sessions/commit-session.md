---
description: Commit session — stage files and create commits after validation passes
model: claude-sonnet-4-6
argument-hint: "<json-payload>"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
---

# Commit Session

You stage validated files and create commits for a single task or sub-task. You do **NOT** modify source files — only git operations (staging + committing). The dev session already wrote the code and the validation session confirmed it passes all gates.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `plan_path` | string | Absolute path to the plan JSON file |
| `task_id` | string | Task ID (e.g., `T-003`) or sub-task ID (e.g., `T-003-2`) |
| `worktree_path` | string | Absolute path to the worktree |
| `dev_summary` | string | Summary from the dev session |
| `files_modified` | string[] | Files created/modified by the dev session |

## Step 1: Load Skills

Read skills that govern this session:

1. `${CLAUDE_PLUGIN_ROOT}/shared/skills/git-committing/SKILL.md` — commit message standards

## Step 2: Load Context

1. Read the plan JSON file
2. Find the task (or parent task + sub-task) matching `task_id`
3. Extract task metadata: `feature`, `use_cases`, `done_tags`, `intent`, `title`, `description`
4. Read `dev_summary` and `files_modified` from the payload

## Step 3: Stage Files

1. Run `git status` in the worktree to identify all changes
2. Stage all task-related changes using `git add`
3. Verify staged files match expectations from `files_modified`

## Step 4: Commit

Follow the git-committing skill for the commit:

- Detect existing commit style in the repo
- Assess scope — determine if changes should be one commit or split into logical commits
- Write commit message(s) per the skill's format rules (imperative verb, 50-char limit, spec refs block)
- Include spec references from task metadata (`use_cases`, `done_tags`)
- Run the pre-commit checklist from the skill
- Do NOT add AI attribution

## Step 5: Output

Respond with a structured JSON block:

```json
{
  "status": "done | failed",
  "commits": ["sha1"],
  "error": null
}
```

- `status`: `"done"` when all changes are committed. `"failed"` if pre-commit hooks fail or staging encounters errors.
- `commits`: SHA(s) of commits created in this session.
- `error`: null on success, error description on failure (include hook stderr on hook failures).

## Rules

- Do NOT modify any source files — only git operations (staging + committing).
- Do NOT run quality gates. The validation session already passed them.
- All work happens inside the worktree — never modify files outside it.
- If pre-commit hooks fail, return `{ "status": "failed", "commits": [], "error": "<hook stderr>" }` immediately.
