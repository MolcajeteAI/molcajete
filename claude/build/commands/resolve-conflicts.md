---
description: Resolve git conflicts — read conflict markers, resolve each file, stage results
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

# Resolve Conflicts

**Non-interactive session** — invoked headlessly via `claude -p` by the orchestrator. No user is present. Never ask questions, request confirmation, or use AskUserQuestion. All decisions must be autonomous.

You resolve git merge or rebase conflicts. You read conflict markers, understand both sides using project context, resolve each file, and stage the results.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `conflicted_files` | string[] | File paths with conflict markers |
| `operation` | string | `merge` or `rebase` |
| `base_ref` | string | The base ref (branch being merged into or rebased onto) |
| `incoming_ref` | string | The incoming ref (branch being merged or rebased) |

## Step 1: Load Skill

Read the git conflict resolution skill for reference:

1. `${CLAUDE_PLUGIN_ROOT}/shared/skills/git-conflict-resolution/SKILL.md`

## Step 2: Gather Context

1. Read `CLAUDE.md` and `.claude/rules/*.md` for project conventions
2. Run `git log --oneline -10 {base_ref}` and `git log --oneline -10 {incoming_ref}` to understand what each side changed
3. For each conflicted file, read the file to see the conflict markers

## Step 3: Resolve Each File

For each file in `conflicted_files`:

1. Read the file — identify all `<<<<<<<` / `=======` / `>>>>>>>` conflict blocks
2. Understand the intent of both sides using the git log context
3. **Lock files** (package-lock.json, pnpm-lock.yaml, yarn.lock): delete the file and run the appropriate package manager install command
4. **Generated files**: regenerate rather than merge
5. **Code files**: understand both sides' intent and merge the logic correctly
6. **Config files**: prefer the more complete version
7. Write the resolved file with no conflict markers remaining
8. Run `git add {file}` to stage it

## Step 4: Verify

1. Run `git diff --check` to confirm no conflict markers remain in staged files
2. If any markers remain, go back and fix those files

## Step 5: Output

Respond with a structured JSON block:

```json
{
  "status": "resolved | failed",
  "files_resolved": ["path/to/file"],
  "decisions": ["kept incoming auth middleware, dropped base's deprecated version"],
  "error": null
}
```

- `status`: `"resolved"` when all conflicts are resolved and staged. `"failed"` if any conflict could not be resolved.
- `files_resolved`: all files that were resolved and staged.
- `decisions`: brief description of each non-trivial resolution decision.
- `error`: null on success, error description on failure.

## Rules

- Never leave conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in resolved files.
- Resolve ALL conflicts in one pass — do not leave any for later.
- Stage each file immediately after resolving it.
- For lock files: delete and regenerate, do not try to merge.
- If a conflict is truly ambiguous (both sides make valid contradictory changes), fail rather than guess.
- Do NOT commit — the caller handles committing or continuing the rebase.
