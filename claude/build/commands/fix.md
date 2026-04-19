---
description: Fix session — fix validation failures from a prior dev cycle without reloading full context
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

# Fix Session

**Non-interactive session** — invoked headlessly via `claude -p` by the orchestrator. No user is present. Never ask questions, request confirmation, or use AskUserQuestion. All decisions must be autonomous.

You fix validation failures from a prior development cycle. The full project context is already loaded (seed session) or was loaded in the prior dev session. You receive only the task context and the issues to fix.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `task` | object | Full task JSON object from plan.json |
| `plan_section` | string | The task's `### T-NNN` section from plan.md (trimmed to What changes + Verification) |
| `issues` | string[] | Validation failures to fix (from test hook or review session) |
| `files_modified` | string[] | Files modified by the prior dev session |

## Step 1: Read Issue Context

Read ONLY the files and lines mentioned in the `issues` list. Do not reload project context, skills, or plan files.

- Parse each issue string for file paths and line numbers
- Read the relevant sections of those files in a single parallel batch
- If an issue references a file not in `files_modified`, read it too — it may be a test file or config

## Step 2: Fix All Issues

Fix ALL reported issues in one pass. Do not fix them one at a time.

For each issue:
1. Locate the file and line referenced
2. Understand the context — read surrounding code if needed
3. Apply the fix
4. Verify the fix is consistent with the plan intent (`plan_section`) and project conventions

Use the `task` object for context (intent, scenario, use_case) and `plan_section` for implementation guidance (What changes, Verification).

Be thorough but surgical — fix the reported issues without refactoring unrelated code.

## Step 3: Commit

Stage and commit all changes:

1. Run `git log --oneline -5` to detect commit style
2. Stage all modified files (specific files, not `git add .`)
3. Create a commit describing the fixes applied
4. Include spec references (FEAT-XXXX, UC-XXXX, SC-XXXX) when PRD context exists
5. No AI attribution

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

- `status`: `"done"` when all issues are fixed. `"failed"` only if something makes it impossible to continue.
- `files_modified`: all files created or modified in this fix session.
- `summary`: what was fixed and how.
- `key_decisions`: notable choices made during fixes.
- `error`: null on success, error description on failure.

## Rules

- Parallelize independent tool calls — multiple reads in a single turn.
- Do NOT run quality gates. The orchestrator handles that after this session.
- Fix ALL issues in one pass — do not fix them one at a time.
- Commit all changes before outputting results.
- Do not modify files unrelated to the reported issues.
- Do not reload project-level context (PROJECT.md, TECH-STACK.md, MODULES.md, CLAUDE.md, rules). It was already loaded.
