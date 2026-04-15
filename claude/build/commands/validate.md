---
description: Validation coordinator — spawn parallel sub-agents for code review and completeness gates
model: claude-sonnet-4-6
argument-hint: "<json-payload>"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# Validation Coordinator Session

**Non-interactive session** — invoked headlessly via `claude -p` by the orchestrator. No user is present. Never ask questions, request confirmation, or use AskUserQuestion. All decisions must be autonomous.

You coordinate the Claude-judgment quality gates for a task or sub-task. You spawn sub-agents in parallel to check code review and completeness. You report issues — you do **NOT** fix them.

**Mechanical gates (formatting, linting, BDD tests) are handled by hooks in the orchestrator before this session runs.** This session only handles gates that require Claude judgment.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `plan_path` | string | Absolute path to the plan JSON file |
| `task_id` | string | Task ID (e.g., `T-003`) or sub-task ID (e.g., `T-003-2`) |

## Step 1: Load Context

1. Read the plan JSON file
2. Find the task (or parent task + sub-task) matching `task_id`
3. Extract the task's `intent`, `module`, `scenario`, and `use_case` from the plan
4. Pass the UC's source files to the sub-agents: the UC markdown at `prd/modules/*/features/*/use-cases/{UC-XXXX}-*.md` (find via `Glob`) and its single `.feature` file at `bdd/features/**/{UC-XXXX}-*.feature` (or `.feature.md`). Both are UC-ID-prefixed and slug-tolerant — never grep by `@UC-XXXX` tag.
5. Read the companion `plan.md` when present. Every plan lives in a directory named `.molcajete/plans/{YYYYMMDDHHmm}-{slug}/` that contains both `plan.json` and (when applicable) `plan.md`. Locate the `### T-NNN` section matching `task_id` and pass its "What changes", "Non-requirements (task-level)", and "Verification" subsections to the Code Review and Completeness sub-agents as extra context, so they can check conformance against the narrative plan — which may include human edits made after plan generation — not just the JSON `description`. If `plan.md` is absent on a `wire-bdd`-intent task, proceed without it. If `plan.md` is absent on an `implement`-intent task, note this in the review output as a warning and continue; the dev session is the enforcement point for the required MD, not validate.

## Step 2: Spawn Sub-Agents (All in Parallel)

Both gates are **read-only** — they report issues but do not fix them. Spawn both as parallel sub-agents using the Agent tool.

### Code Review Gate

Review the changes for intent conformance:

- **`implement`:** Check step def fidelity (assertions match Gherkin specs), production code conformance (requirements addressed), unit test coverage
- **`wire-bdd`:** Check step def accuracy (calls correct functions/endpoints), no production code changes, scenario coverage
- Report any issues found

### Completeness Gate

Trace requirements to code:

- Check that all requirements from the task's use cases are addressed in code
- Search for TODO, FIXME, stub, placeholder markers in modified files
- Check `CLAUDE.md` and `.claude/rules/*.md` compliance
- Report any gaps or stubs found

## Step 3: Collect and Output

Wait for all sub-agents to complete. Collect results into a single structured JSON block:

```json
{
  "code_review": [],
  "completeness": []
}
```

- Each field is an array of issue strings.
- Empty array = gate passed.
- Non-empty array = list of issues for that gate.

## Rules

- This is **read-only**. Do not modify any files, do not fix issues, do not commit.
- All sub-agents run in the project root.
- Spawn both gates in parallel — they are independent and read-only.
- Report every issue with enough detail for the dev session to locate and fix it (file path, line number, description).
