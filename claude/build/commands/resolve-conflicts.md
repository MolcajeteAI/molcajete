---
description: Worktree fix session — diagnose and fix worktree creation failures
model: claude-sonnet-4-6
argument-hint: "<json-payload>"
allowed-tools:
  - Read
  - Bash
  - Glob
---

# Worktree Fix Session

**Non-interactive session** — invoked headlessly via `claude -p` by the orchestrator. No user is present. Never ask questions, request confirmation, or use AskUserQuestion. All decisions must be autonomous.

You diagnose and fix worktree preparation failures. The Node.js orchestrator tried to create a worktree and failed — you figure out why and fix it.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `worktree_path` | string | Intended worktree path that failed to create |
| `branch_name` | string | Intended branch name (e.g., `dispatch/FEAT-0F3y-T-001`) |
| `base_branch` | string | Branch to create the worktree from |
| `error_output` | string | Error output from the failed git worktree command |

## Step 1: Diagnose

Read the error output and check for common issues:

1. **Stale worktree:** The path already exists from a previous failed run
   - Check: `git worktree list --porcelain`
   - Fix: `git worktree remove --force "{worktree_path}"` then `git branch -D "{branch_name}"`

2. **Locked branch:** The branch already exists (possibly from a stale worktree)
   - Check: `git branch --list "{branch_name}"`
   - Fix: Delete the branch if no worktree references it, then retry

3. **Dirty state:** Unexpected files or locks in `.molcajete/worktrees/`
   - Check: `ls -la .molcajete/worktrees/`
   - Fix: Clean up orphaned directories

4. **Other issues:** Read the error message carefully and apply appropriate fix

## Step 2: Retry Creation

After fixing the issue, create the worktree:

```bash
mkdir -p .molcajete/worktrees
git worktree add -b "{branch_name}" "{worktree_path}" "{base_branch}"
```

Verify the worktree was created:

```bash
git worktree list --porcelain | grep "{worktree_path}"
```

## Step 3: Output

Respond with a structured JSON block:

```json
{
  "status": "resolved | failed",
  "worktree_path": "string",
  "action_taken": "cleaned stale worktree and recreated",
  "error": null
}
```

- `status`: `"resolved"` if the worktree is now ready. `"failed"` if the issue could not be fixed.
- `worktree_path`: the final worktree path (should match the intended path).
- `action_taken`: what was done to fix the issue.
- `error`: null on success, error description on failure.

## Rules

- Only modify git state (worktrees, branches) — do not touch code files.
- Be conservative — only delete worktrees/branches that are clearly stale or orphaned.
- If the issue looks like active work in progress (uncommitted changes in a worktree), report it as failed rather than destroying it.
