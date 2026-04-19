---
description: Review fix session — fix code review or completeness issues across the plan scope
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

# Review Fix Session

**Non-interactive session** — invoked headlessly via `claude -p` by the orchestrator. No user is present. Never ask questions, request confirmation, or use AskUserQuestion. All decisions must be autonomous.

You fix issues found by the end-of-build code review or completeness check. You receive a list of issues and the full plan scope. You fix all issues and commit changes.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `plan_path` | string | Absolute path to the plan JSON file |
| `task_ids` | string[] | All task IDs in scope (the tasks whose code is being reviewed) |
| `issues` | string[] | Issues to fix — from code review, completeness check, or test failures |
| `context_preloaded` | boolean (optional) | If true, project context was pre-loaded via seed session — skip project-level reads |

## Step 1: Load Skills

Load all three skill files in a single parallel batch of Read calls (one assistant turn with three tool_use blocks). Do not issue them sequentially — that wastes turns.

**Skip this step when `context_preloaded` is true** — skills were loaded in the seed session.

1. `${CLAUDE_PLUGIN_ROOT}/build/skills/SKILL.md` — dispatch rules, implementation procedures
2. `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — BDD conventions
3. `${CLAUDE_PLUGIN_ROOT}/shared/skills/git-committing/SKILL.md` — commit message format and rules

## Step 2: Load Context

Issue every Read and Glob in this step as part of a parallel batch: group all independent tool calls into a single assistant turn with multiple tool_use blocks. Do not load files one at a time. Split into a new batch only at a true dependency boundary (e.g. you must read `plan.json` first to learn which files to load). Within each batch, parallelize everything.

1. Read the plan JSON file
2. Find all tasks matching `task_ids` — extract their `intent`, `module`, `scenario`, `use_case`, and `files_to_modify`
3. Read the companion `plan.md` when present. Every plan lives in a directory named `.molcajete/plans/{YYYYMMDDHHmm}-{slug}/` that contains both `plan.json` and `plan.md` side by side. Locate the `### T-NNN` sections for all task IDs in scope. These sections provide implementation intent context.
4. Read project context files (**skip project-level reads when `context_preloaded` is true** — only read task-specific files):
   - `prd/PROJECT.md`, `prd/TECH-STACK.md`, `prd/MODULES.md` (**skip when `context_preloaded`**)
   - `CLAUDE.md` and `.claude/rules/*.md` (**skip when `context_preloaded`**)
   - Feature REQUIREMENTS.md and ARCHITECTURE.md for each unique feature in scope
   - UC files for each unique use case in scope (`Glob prd/modules/*/features/*/use-cases/{UC-XXXX}-*.md`)
   - Gherkin feature files for each unique UC (`Glob bdd/features/**/{UC-XXXX}-*.feature` or `*.feature.md`)
5. Read the specific files and lines mentioned in the `issues` list

## Step 3: Fix Issues

Fix ALL reported issues in one pass. Do not fix them one at a time.

For each issue:
1. Locate the file and line referenced in the issue
2. Understand the context — read surrounding code if needed
3. Apply the fix
4. Verify the fix is consistent with the plan intent and project conventions

Be thorough but surgical — fix the reported issues without refactoring unrelated code.

## Step 4: Commit

Stage and commit all changes following the git-committing skill:

1. Stage all modified/created files
2. Create a commit with a message that describes the fixes applied
3. Follow the project's commit style conventions

## Step 5: Output

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
- `files_modified`: all files created or modified.
- `summary`: what was fixed and how.
- `key_decisions`: notable choices made during fixes.
- `error`: null on success, error description on failure.

## Rules

- Parallelize independent tool calls. Whenever you need to read, grep, or glob multiple files without inter-dependencies, issue them all in a single assistant turn with multiple tool_use blocks. Sequential reads burn the turn budget.
- Do NOT run quality gates (formatting, linting, BDD tests). The orchestrator handles that after this session.
- Fix ALL reported issues in one pass — do not fix them one at a time.
- Commit all changes before outputting results.
- Do not modify files unrelated to the reported issues.
