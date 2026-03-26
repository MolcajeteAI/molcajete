---
description: Generate an implementation plan from specified use cases
model: claude-opus-4-6
argument-hint: "[FEAT-XXXX | UC-XXXX | SC-XXXX ...]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Agent
  - AskUserQuestion
---

# Plan Command

You generate implementation plans from PRD specs. You scan for unimplemented use cases, verify Gherkin and step stubs exist, and produce a plan file in `.molcajete/plans/` with a task breakdown that `/m:build` will execute.

**Scope argument:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response. This keeps you in control of the conversation flow.

## Step 1: Load Skills

Read both skills that govern this command:

1. `${CLAUDE_PLUGIN_ROOT}/plan/skills/planning/SKILL.md` — plan file format, task decomposition, context budgets, done signals, naming
2. `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — BDD scaffold context, tagging rules

Follow these skills' rules for all subsequent steps.

## Step 2: Verify Prerequisites

1. Verify `prd/PROJECT.md` and `prd/FEATURES.md` both exist. If either is missing:

   "Project foundation not found. Run `/m:setup` first to create PROJECT.md and FEATURES.md."

   Then stop.

2. Create `.molcajete/plans/` directory if it doesn't exist:
   ```bash
   mkdir -p .molcajete/plans
   ```

## Step 3: Parse Arguments

Parse `$ARGUMENTS` for entity IDs:

- **No arguments** → full PRD scan mode
- **With arguments** → parse tokens matching `FEAT-XXXX`, `UC-XXXX`, or `SC-XXXX` patterns; scope the plan to those entities

If arguments are provided, validate every ID exists in the PRD:
- `FEAT-XXXX` → must appear in `prd/FEATURES.md`
- `UC-XXXX` → must exist as `prd/features/*/use-cases/UC-XXXX.md`
- `SC-XXXX` → must exist as a scenario heading in some UC file (grep `prd/features/*/use-cases/*.md` for `### SC-XXXX`)

If any ID is not found, report which ones are invalid and stop.

## Step 4: Load Project Context

Read project-level files:
- `prd/PROJECT.md` — project description (required)
- `prd/TECH-STACK.md` — technology choices (if exists)
- `prd/ACTORS.md` — system actors (if exists)
- `prd/FEATURES.md` — feature registry (required)

Per-feature files will be loaded in Step 5 based on scope.

## Step 5: Scan for Plannable Work

### Mode A: With Arguments (explicit scope)

Plan work for exactly the provided IDs — **no status filtering**. The user is explicitly telling you what to work on.

- `FEAT-XXXX` → include all UCs under that feature. Read `prd/features/FEAT-XXXX/USE-CASES.md` and all UC files in `prd/features/FEAT-XXXX/use-cases/`.
- `UC-XXXX` → include that specific UC. Glob `prd/features/*/use-cases/UC-XXXX.md` to find it.
- `SC-XXXX` → include the parent UC. Grep `prd/features/*/use-cases/*.md` for `### SC-XXXX` to find the UC file, then include the whole UC (scenarios aren't planned individually).

For each in-scope feature, also read:
- `prd/features/FEAT-XXXX/REQUIREMENTS.md`
- `prd/features/FEAT-XXXX/ARCHITECTURE.md` (if exists)

### Mode B: No Arguments (full scan)

Find everything that needs implementation:

1. Parse `prd/FEATURES.md` for all features.
2. For each feature, read `prd/features/FEAT-XXXX/USE-CASES.md`.
3. Collect UCs with status `specified` or `dirty` in the USE-CASES.md table.
4. Also include features with status `scoped` that have UCs ready.
5. For each in-scope feature, read `REQUIREMENTS.md` and `ARCHITECTURE.md` (if exists).
6. Build the full picture of all pending work.

If nothing plannable is found: tell the user "No unimplemented specs found. All use cases are either already implemented or still in backlog. Use `/m:feature`, `/m:usecase`, or `/m:spec` to author new specs, then `/m:scenario` to generate Gherkin." Then stop.

## Step 6: Verify Gherkin + Step Stubs

For each plannable UC:

1. Grep `bdd/features/` for `@UC-XXXX` tag to find the `.feature` file.
2. Verify the `.feature` file exists and contains at least one `Scenario:` or `Scenario Outline:`.
3. Read the feature file to count scenarios and extract step patterns.
4. Grep `bdd/steps/` for step definitions matching the UC's steps.

Report gaps:
- If Gherkin missing for a UC: "UC-XXXX ({name}) has no Gherkin. Run `/m:scenario UC-XXXX` first."
- If step stubs missing for a UC: "UC-XXXX ({name}) has Gherkin but is missing step definition stubs."

If **all** UCs are missing Gherkin, stop with the gap report.

If **some** UCs have gaps, report the gaps and ask via AskUserQuestion:
- Question: "{gap report}\n\nWould you like to proceed with a plan covering only the UCs that have Gherkin, or fix the gaps first?"
- Header: "Gherkin Gaps"
- Options: "Proceed with available UCs" / "Cancel — I'll fix the gaps first"

If "Cancel", stop. Otherwise, continue with only the verified UCs.

## Step 7: Present Scope Summary

Use AskUserQuestion to show what will be planned:

- Question: Format as a structured summary:
  - **Features in scope** — list with UC counts
  - **Use cases to plan** — list with scenario counts and status
  - **Total scenarios** — aggregate count
  - **Missing Gherkin** (if any were excluded) — list of excluded UCs

- Header: "Plan Scope"
- Options: "Proceed" / "Narrow scope" / "Cancel"

If "Narrow scope": use AskUserQuestion to ask which IDs to exclude, remove them, and re-present. If "Cancel": stop.

## Step 8: Generate Task Breakdown

Read all in-scope materials:
- UC files with their scenarios
- Feature REQUIREMENTS.md and ARCHITECTURE.md files
- Gherkin .feature files for the in-scope UCs
- `bdd/steps/INDEX.md` (if exists) for existing step definitions

Read the plan template:
```
${CLAUDE_PLUGIN_ROOT}/plan/skills/planning/templates/plan-template.md
```

Decompose into tasks following the planning skill rules:

1. **BDD-aligned tasks** — each task advances at least one Gherkin scenario. Map scenarios to tasks by examining what code needs to exist for those assertions to pass.

2. **Infrastructure tasks** — only when necessary as prerequisites (database setup, test harness, shared middleware). Use validator done signals.

3. **Context budget** — estimate each task at ≤ 200K tokens. Consider: source files to read + spec files + Gherkin + implementation work. Split if over budget.

4. **Task fields** — for each task include:
   - Task ID: `T-001`, `T-002`, etc. (flat sequential)
   - Title: verb-noun describing what gets built
   - Use Cases: which UC-XXXX IDs this task advances
   - Feature: parent feature slug
   - Status: `pending`
   - Estimated context: `~{N}K tokens`
   - Done signal: which `@SC-XXXX` scenarios must pass, or validator check
   - Depends on: `T-NNN` or `none`
   - Description: what to implement, why, constraints
   - Files to create/modify: expected file paths

5. **Order by dependency chain** — infrastructure first, data models before APIs, core logic before edge cases, happy-path before error-handling.

## Step 9: Plan Preview

Use AskUserQuestion to show the full plan file content:

- Question: Show the complete plan markdown content in a code block
- Header: "Plan Preview"
- Options: "Looks good" / "Edit" / "Cancel"

If "Edit": use AskUserQuestion to collect corrections, regenerate affected tasks, and re-preview.
If "Cancel": stop.

## Step 10: Write Plan File

1. Generate the filename:
   - Timestamp: current time as `YYYYMMDDHHmm`
   - Slug: derived from scope per the planning skill rules (feature name kebab-case, UC name kebab-case, `mixed`, or `full-scan`)
   - Full name: `{YYYYMMDDHHmm}-{slug}.md`

2. Ensure directory exists:
   ```bash
   mkdir -p .molcajete/plans
   ```

3. Write the plan file to `.molcajete/plans/{filename}`.

## Step 11: Report

Tell the user:

- Plan file path
- Task count and total estimated context budget
- Features and UCs covered
- Any UCs excluded due to missing Gherkin

Suggest next step: "Review the plan file, then run `/m:build {plan-name}` to start implementation."
