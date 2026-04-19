---
description: Development session — implement code for a task or sub-task, write unit tests, commit changes
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

**Non-interactive session** — invoked headlessly via `claude -p` by the orchestrator. No user is present. Never ask questions, request confirmation, or use AskUserQuestion. All decisions must be autonomous based on the plan, skills, and project context.

You implement code for a single task or sub-task. You write production code and unit tests. You commit all changes. The orchestrator runs a test hook and AI review after this session.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `task` | object | Full task JSON object from plan.json |
| `plan_section` | string | Extracted `### T-NNN` section from plan.md (implementation narrative) |
| `gherkin` | string | Content of the UC's `.feature` file |
| `steps_index` | string | Content of `bdd/steps/INDEX.md` |
| `feature_file_path` | string | Resolved path to the `.feature` file |
| `uc_file_path` | string | Resolved path to the UC markdown file |
| `architecture_path` | string | Resolved path to the feature's ARCHITECTURE.md |
| `prior_summaries` | string[] | Summaries from completed prior tasks/sub-tasks |
| `issues` | string[] | Issues from a failed validation (empty on first run) |
| `context_preloaded` | boolean | If true, project context was pre-loaded via seed session — skip project-level reads |

## Step 1: Read Supplementary Files

Issue all reads in a single parallel batch (one assistant turn, multiple tool_use blocks).

**Always read:**
- `{architecture_path}` — for Code Map and architecture context (skip if empty string)
- `{uc_file_path}` — for UC requirements (skip if empty string)

**Only when `context_preloaded` is false or missing**, also read:
- `prd/PROJECT.md`, `prd/TECH-STACK.md`, `prd/MODULES.md`
- `CLAUDE.md` and `.claude/rules/*.md`
- `bdd/steps/INDEX.md` (already in payload as `steps_index`, but if empty, try reading from disk)

The task object, plan section, gherkin content, and steps index are already in the payload — do not re-read them.

### Plan Authority

- `plan_section` is narrative / implementation-intent authority. It contains: What changes, Important snippets, Files to create/modify, Non-requirements, Verification. It may reflect human edits made after plan generation — trust it for narrative.
- `task` (the JSON object) is flow-control authority: status, intent, dependencies, scenario tag, module, `files_to_modify` ordering.
- If `plan_section` is empty and `task.intent` is `implement`, stop and return: `{"status": "failed", "files_modified": [], "summary": "", "key_decisions": [], "error": "Companion plan.md missing or task section not found. Regenerate the plan with /m:plan or restore the file before re-running build."}`

## Step 2: Activate Task Scenarios

Before implementing, remove lifecycle tags (`@pending`, `@dirty`) from this task's scenario in the UC's `.feature` file:

1. If `task.scenario` is non-null, derive the tag `@SC-XXXX` by prepending `@`
2. Use `feature_file_path` from the payload to locate the file
3. Edit the file to remove `@pending` and/or `@dirty` from the `@SC-XXXX` line
4. On retry cycles (`issues` is non-empty), skip this step — tags were already removed on the first pass

Include the modified `.feature` file in the `files_modified` output.

## Step 3: Implement

Follow the implementation procedure based on `task.intent`:

### `implement` intent — Phase A: Production Code

1. Read the gherkin content (from `gherkin` in payload) to understand what scenarios assert
2. Read the plan section's "What changes" and "Files to create/modify" for implementation guidance
3. Implement production code following project conventions, guided by Gherkin assertions
4. Write unit tests for the implemented code
5. Run unit tests and fix failures. **If tests fail due to setup errors** (connection refused, services not running, database unreachable, runner not installed), stop immediately — return `{"status": "failed", ...}` with the setup error
6. Self-review: `git diff` — check for debug statements, commented-out code, hardcoded secrets, TODO placeholders

### `implement` intent — Phase B: Step Definitions

1. Read the gherkin content (from `gherkin`) and extract Given/When/Then step patterns for `task.scenario`
2. Check `steps_index` (from payload) for existing reusable step definitions
3. For each step pattern without an existing match:
   - Determine placement: `common_steps`, `api_steps`, `db_steps`, or `{module}_steps` (see Step Rules below)
   - Create or append to step definition file
4. Read the production code just written to understand actual selectors, API paths, function signatures
5. Implement each step definition with real assertion logic referencing real code
6. Update `bdd/steps/INDEX.md`

### `wire-bdd` intent — Single Phase: Step Definitions

1. Read the gherkin content (from `gherkin`) and extract step patterns for `task.scenario`
2. Check `steps_index` (from payload) for existing reusable step definitions
3. For each step pattern without an existing match:
   - Determine placement per step file rules
   - Create or append to step definition file
4. Read existing application code (from ARCHITECTURE.md Code Map or task description)
5. Implement each step definition to call real app code and assert behavior
6. **Do NOT modify production code** — only step definitions
7. Update `bdd/steps/INDEX.md`

**On retry (`issues` is non-empty):** Focus on fixing the reported issues. Read the specific files and lines mentioned. Fix all issues in one pass.

## Step 4: Commit

Stage and commit all changes:

1. Run `git log --oneline -5` to detect commit style (prefixes, verb tense, casing)
2. Stage all modified/created files (specific files, not `git add .`)
3. Create a commit with:
   - Subject: `<prefix>: <what changed>` (max 50 chars)
   - Body: bullet points for non-trivial changes
   - Spec references block at the end (FEAT-XXXX, UC-XXXX, SC-XXXX)
4. No AI attribution — never add "Co-Authored-By: Claude" or similar

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

- `status`: `"done"` when implementation is complete. `"failed"` only if something makes it impossible to continue.
- `files_modified`: all files created or modified.
- `summary`: what was implemented and key decisions made.
- `key_decisions`: notable choices that affect dependent tasks/sub-tasks.
- `error`: null on success, error description on failure.

## Rules

### Session Rules
- Parallelize independent tool calls. Issue multiple reads/greps/globs in a single assistant turn with multiple tool_use blocks. Sequential reads burn the turn budget.
- Do NOT run quality gates (formatting, linting, BDD tests). The orchestrator's test hook handles that.
- If this is a retry, fix ALL reported issues in one pass — do not fix them one at a time.
- Commit all changes before outputting results.
- Prefer `Write` for new files over sequential `Edit` calls.

### Step Definition Rules
- All steps assume end-to-end execution — real state, real actions, real assertions. Never reference mocks, stubs, fakes, or spies in step text.
- Given steps describe state declaratively (`Given user alice is logged in`), not procedures.
- When/Then steps narrate the actor's experience, not internal system behavior.
- Every `Then` step asserts a specific, deterministic value. Never use "more than", "approximately", "non-zero", "some", "any".
- New step definitions must include a docstring/doc comment and pending-error stub body: `raise NotImplementedError("TODO: implement step")` (Python), `throw new Error("TODO: implement step")` (TypeScript), `return fmt.Errorf("TODO: implement step")` (Go).
- Before creating any step, check `steps_index` for existing reusable patterns — reuse over recreate.

### Step File Placement
| Category | File | When to use |
|----------|------|-------------|
| Common | `common_steps.[ext]` | Generic steps: login, navigation, time, basic CRUD |
| API | `api_steps.[ext]` | HTTP request/response steps |
| Database | `db_steps.[ext]` | Database assertion steps |
| Module-specific | `{module}_steps.[ext]` | Steps unique to a business module |

### Commit Rules
- Detect project commit style from `git log --oneline -5` (prefixes, verb tense, casing). Match it.
- Start subject with a verb (Adds, Fixes, Updates, Removes, Refactors, Implements, etc.)
- Max 50 characters for subject line — move details to body.
- Include spec references (FEAT-XXXX, UC-XXXX, SC-XXXX) at end of body when PRD context exists.
- Never add AI attribution (Co-Authored-By, "Generated with Claude", etc.)
- Stage specific files, not `git add .`. Check diff for debug code, commented-out code, secrets.
