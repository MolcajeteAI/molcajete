---
description: Development session — implement code for a task or sub-task, write unit tests, commit changes
model: claude-opus-4-6
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

**Non-interactive session** — invoked headlessly via `claude -p` by the orchestrator. No user is present. Never ask questions, request confirmation, or use AskUserQuestion. All decisions must be autonomous based on the plan, skills, and project context.

You implement code for a single task or sub-task. You write production code and unit tests. You write code and commit all changes. The orchestrator runs a test hook and AI review after this session.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `plan_path` | string | Absolute path to the plan JSON file |
| `task_id` | string | Task ID (e.g., `T-003`) or sub-task ID (e.g., `T-003-2`) |
| `prior_summaries` | string[] | Summaries from completed prior tasks/sub-tasks |
| `issues` | string[] | Issues from a failed validation (empty on first run) |

## Step 1: Load Skills

Read skills that govern this session:

1. `${CLAUDE_PLUGIN_ROOT}/build/skills/SKILL.md` — dispatch rules, implementation procedures
2. `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — BDD conventions
3. `${CLAUDE_PLUGIN_ROOT}/shared/skills/git-committing/SKILL.md` — commit message format and rules

## Step 2: Load Context

1. Read the plan JSON file
2. Find the task (or parent task + sub-task) matching `task_id`
3. For sub-tasks: the parent task provides `use_case`, `feature`, `module`, `architecture`, `intent`, `scenario`
4. Read the companion `plan.md`. Every plan lives in a directory named `.molcajete/plans/{YYYYMMDDHHmm}-{slug}/`, and that directory is expected to contain both `plan.json` and `plan.md` side by side.
   - **If the task's `intent` is `implement` (spec-first / greenfield):** `plan.md` **must** be present. If it is missing, stop this session and return `{"status": "failed", "files_modified": [], "summary": "", "key_decisions": [], "error": "Companion plan.md missing from the plan directory. Regenerate the plan with /m:plan or restore the file before re-running build."}`. Do not proceed from the JSON alone — the human may have edited implementation intent into `plan.md` that the JSON does not carry.
   - **If the task's `intent` is `wire-bdd` (reverse):** `plan.md` is optional. If present, read it. If absent, proceed from `plan.json` alone — the reverse plan had no blocking testability prerequisites.
   - When `plan.md` is loaded, locate the `### T-NNN — {title}` section matching `task_id`. For sub-tasks, use the parent `T-NNN` section and look for the sub-task as a nested bullet under "Files to create/modify". Treat the section's "What changes", "Important snippets", "Files to create/modify", "Non-requirements (task-level)", and "Verification" subsections as authoritative implementation intent — they may reflect human edits made after plan generation. If the MD and JSON disagree on narrative or snippets, trust the MD; if they disagree on flow-control fields (status, intent, dependencies, `files_to_modify` ordering, scenario tag, module), trust the JSON.
5. Read project context files:
   - `prd/PROJECT.md`, `prd/TECH-STACK.md`, `prd/MODULES.md`
   - `CLAUDE.md` and `.claude/rules/*.md`
   - Feature's REQUIREMENTS.md and ARCHITECTURE.md
   - The UC file for the task's `use_case`. Locate it with `Glob prd/modules/*/features/*/use-cases/{UC-XXXX}-*.md` — filenames are always `UC-XXXX-{slug}.md`.
   - The UC's Gherkin feature file. Locate it with `Glob bdd/features/**/{UC-XXXX}-*.feature` (or `*.feature.md` for MDG) — one UC, one feature file, UC-ID-prefixed and slug-tolerant.
   - `bdd/steps/INDEX.md`
6. Read prior task/sub-task summaries for context continuity
7. If `issues` is non-empty, these are validation failures from a prior cycle — focus on fixing them

## Step 3: Implement

### 3.0 Activate task scenarios

Before implementing, remove lifecycle tags (`@pending`, `@dirty`) from this task's scenario in the UC's `.feature` file:

1. If the task's `scenario` is non-null, derive the tag `@SC-XXXX` by prepending `@`:
   - Locate the UC's single feature file with `Glob bdd/features/**/{UC-XXXX}-*.feature` (or `*.feature.md`) using the task's `use_case`. The file sits at `bdd/features/{module}/{domain}/{UC-XXXX}-{slug}.feature`.
   - Within that file, find the `@SC-XXXX` line and edit it to remove `@pending` and/or `@dirty`. Do not touch `@SC-` tags in other UC files — one-UC-per-file means the scope is always the single located file.
2. This makes the scenario "active" for the validation session's BDD gate
3. On retry cycles (issues list is non-empty), skip this step — tags were already removed on the first pass

Include the modified `.feature` files in the `files_modified` output.

### 3.1 Implementation

Follow the dispatch skill's implementation procedure based on the task's intent:

- **`implement` intent:** Phase A (production code + unit tests) then Phase B (step definitions)
- **`wire-bdd` intent:** Single phase (step definitions, no production code changes)

**On retry (issues list is non-empty):** Focus on fixing the reported issues. Read the specific files and lines mentioned. Fix all issues.

## Step 4: Commit

Stage and commit all changes following the git-committing skill:

1. Stage all modified/created files
2. Create a commit with a message that describes the implementation
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

- `status`: `"done"` when implementation is complete. `"failed"` only if something makes it impossible to continue (e.g., missing dependencies, unresolvable conflicts).
- `files_modified`: all files created or modified.
- `summary`: what was implemented and key decisions made.
- `key_decisions`: notable choices that affect dependent tasks/sub-tasks.
- `error`: null on success, error description on failure.

## Rules

- Do NOT run quality gates (formatting, linting, BDD tests). The orchestrator's test hook handles that.
- If this is a retry, fix ALL reported issues in one pass — do not fix them one at a time.
- Commit all changes before outputting results.
- `plan.json` is flow-control authority; `plan.md` is narrative / implementation-intent authority and may contain human edits made after plan generation. Never silently proceed past a missing `plan.md` on an `implement`-intent task — return the structured failure described in Step 2.
