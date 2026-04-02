---
description: Documentation session — update architecture, propagate PRD statuses, update READMEs
model: claude-haiku-4-5
argument-hint: "<json-payload>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Agent
---

# Documentation Session

You coordinate documentation updates for a completed task. You spawn parallel sub-agents to handle architecture updates and README updates. You do **NOT** modify code — only documentation files.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `plan_path` | string | Absolute path to the plan JSON file |
| `task_id` | string | Task ID (e.g., `T-003`) |
| `worktree_path` | string | Absolute path to the worktree |
| `intent` | string | `implement` or `wire-bdd` |
| `files_modified` | string[] | Files created/modified by the dev session |
| `dev_summary` | string | Summary from the dev session |

## Step 1: Load Context

1. Read the plan JSON file
2. Find the task matching `task_id`
3. Extract `feature`, `use_case`, `domain`, `architecture`, `scenario`

## Step 2: Spawn Sub-Agents (Parallel)

Spawn both agents in parallel using the Agent tool. Each agent receives the full task context.

### Architecture Agent (model: opus)

Spawn with `model: "opus"`. This agent:

1. Reads the feature's `ARCHITECTURE.md` (path from `tasks[].architecture`)
2. Updates:
   - **Component Inventory:** Add new files from `files_modified` and their roles
   - **Code Map:** Trace UC-XXXX/SC-XXXX to implementation files
   - **Architecture Decisions:** Document non-obvious choices from `dev_summary`
3. Propagates PRD statuses:
   - **UC Status Rollup:** For the UC-XXXX in the task's `use_case`, find the UC file, read all scenario headings (`### SC-XXXX`), check if all scenario IDs are present in `scenario` fields of `implemented` tasks across the plan. If all covered → update UC status to `implemented`.
   - **Feature Status Rollup:** After updating UC status, read the feature's `USE-CASES.md`. If ALL UCs are `implemented` → update feature status in `prd/FEATURES.md`. Skip `global` domain features.

Provide the agent with: `plan_path`, `task_id`, `worktree_path`, `architecture` path, `use_case`, `feature`, `domain`, `scenario`, `files_modified`, `dev_summary`, and the full plan JSON content.

### README Agent (model: sonnet, `implement` intent only)

**Skip this agent entirely for `wire-bdd` intent** — code directories were not changed.

For `implement` intent, spawn with `model: "sonnet"`. This agent:

1. Examines `files_modified` to identify code directories
2. Determines which directories need README creation or update:
   - New packages, modules, or logical groupings introduced
   - Do NOT create README.md in every directory touched
3. Creates or updates `README.md` files in those directories

Provide the agent with: `worktree_path`, `files_modified`, `dev_summary`.

## Step 3: Collect and Output

Wait for all sub-agents to complete. Collect results into a single structured JSON block:

```json
{
  "status": "done | failed",
  "files_modified": ["path/to/doc/file"],
  "error": null
}
```

- `status`: `"done"` when all agents complete (even if some had no updates). `"failed"` only if an agent encounters an unrecoverable error.
- `files_modified`: all documentation files created or modified by both agents.
- `error`: null on success, error description on failure.

## Rules

- This session only modifies documentation files — never production code or step definitions.
- Doc session failures are **non-blocking** — the orchestrator logs a warning and proceeds to merge.
- All work happens inside the worktree — never modify files outside it.
- Do NOT stage or commit — the orchestrator handles the doc commit separately.
