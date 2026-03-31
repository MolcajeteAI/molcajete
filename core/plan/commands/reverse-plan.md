---
description: Generate a plan for wiring BDD to existing code (reverse path)
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

# Reverse Plan Command

You generate plans for wiring BDD step definitions to existing code. You scan for use cases that need BDD coverage, verify Gherkin and step stubs exist, and produce a plan file in `.molcajete/plans/` with a task breakdown that `/m:build` will execute. Every task uses `wire-bdd` intent — the application already works, tasks implement step definitions that exercise it.

**Scope argument:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response. This keeps you in control of the conversation flow.

## Step 1: Load Skills

Read both skills that govern this command:

1. `${CLAUDE_PLUGIN_ROOT}/plan/skills/planning/SKILL.md` — plan file format, task decomposition, context budgets, done signals, naming
2. `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — BDD scaffold context, tagging rules

Follow these skills' rules for all subsequent steps.

## Step 2: Verify Prerequisites

1. Verify `prd/PROJECT.md` and `prd/DOMAINS.md` both exist. If either is missing:

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
- `UC-XXXX` → must exist as `prd/domains/*/features/*/use-cases/UC-XXXX.md`
- `SC-XXXX` → must exist as a scenario heading in some UC file (grep `prd/domains/*/features/*/use-cases/*.md` for `### SC-XXXX`)

If any ID is not found, report which ones are invalid and stop.

## Step 4: Load Project Context

Read project-level files:
- `prd/PROJECT.md` — project description (required)
- `prd/TECH-STACK.md` — technology choices (if exists)
- `prd/ACTORS.md` — system actors (if exists)
- `prd/DOMAINS.md` — domain registry (required)
- `prd/FEATURES.md` — master feature registry

Per-feature files will be loaded in Step 5 based on scope.

## Step 5: Scan for Plannable Work

### Mode A: With Arguments (explicit scope)

Plan work for exactly the provided IDs — **no status filtering**. The user is explicitly telling you what to work on.

- `FEAT-XXXX` → include all UCs under that feature. Glob `prd/domains/*/features/FEAT-XXXX/` to find it, then read `USE-CASES.md` and all UC files in `use-cases/`.
- `UC-XXXX` → include that specific UC. Glob `prd/domains/*/features/*/use-cases/UC-XXXX.md` to find it.
- `SC-XXXX` → include the parent UC. Grep `prd/domains/*/features/*/use-cases/*.md` for `### SC-XXXX` to find the UC file, then include the whole UC (scenarios aren't planned individually).

For each in-scope feature, extract the domain from the path and also read:
- `prd/domains/{domain}/features/FEAT-XXXX/REQUIREMENTS.md`
- `prd/domains/{domain}/features/FEAT-XXXX/ARCHITECTURE.md` (if exists)

**Global feature handling:** After resolving the feature's domain from the path:

If the resolved domain is `global`:
1. Read `prd/DOMAINS.md` and collect all domains where Type != `spec-only`
2. This is a cross-domain plan. The planner must generate tasks for each real domain.
3. Load the global feature's REQUIREMENTS.md and ARCHITECTURE.md as baseline.
4. For each real domain, check if it has a feature with refs pointing to this global FEAT-XXXX.
   If found, also load that domain feature's REQUIREMENTS.md and ARCHITECTURE.md.
5. Use AskUserQuestion to confirm: "FEAT-XXXX is a global feature. This will generate a cross-domain plan covering: {list of real domains}. Continue, or specify UC IDs for narrower scope?"

### Mode B: No Arguments (full scan)

Find everything that needs implementation:

1. Read `prd/FEATURES.md` for all features across all domains. Skip features in the `## global` section during full scan (global features are only planned when explicitly targeted by ID).
2. For each feature, read `prd/domains/{domain}/features/FEAT-XXXX/USE-CASES.md`.
3. Collect UCs with status `pending` or `dirty` in the USE-CASES.md table.
4. Also include features with status `implemented` that have UCs ready.
5. For each in-scope feature, read `REQUIREMENTS.md` and `ARCHITECTURE.md` (if exists).
6. Build the full picture of all pending work.

If nothing plannable is found: tell the user "No use cases need BDD wiring. Use `/m:reverse-feature`, `/m:reverse-usecase`, or `/m:reverse-spec` to extract specs from code first." Then stop.

## Step 6: Load Global Refs Context

For each in-scope domain feature, read its REQUIREMENTS.md frontmatter. If `refs` is non-empty, load each referenced global feature's REQUIREMENTS.md and ARCHITECTURE.md. Pass as additional baseline context to task generation.

## Step 7: Verify Gherkin + Step Stubs

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

## Step 8: Present Scope Summary

Use AskUserQuestion to show what will be planned:

- Question: Format as a structured summary:
  - **Features in scope** — list with UC counts
  - **Use cases to plan** — list with scenario counts and status
  - **Total scenarios** — aggregate count
  - **Missing Gherkin** (if any were excluded) — list of excluded UCs

- Header: "Plan Scope"
- Options: "Proceed" / "Narrow scope" / "Cancel"

If "Narrow scope": use AskUserQuestion to ask which IDs to exclude, remove them, and re-present. If "Cancel": stop.

## Step 9: Generate Task Breakdown

Read all in-scope materials:
- UC files with their scenarios
- Feature REQUIREMENTS.md and ARCHITECTURE.md files
- Gherkin .feature files for the in-scope UCs
- `bdd/steps/INDEX.md` (if exists) for existing step definitions

If any ARCHITECTURE.md contains a Code Map section with entries, use it to identify the existing implementation files that step definitions need to exercise. Include the ARCHITECTURE.md path in each task's Architecture field so build tasks can load it for context.

Read the plan template:
```
${CLAUDE_PLUGIN_ROOT}/plan/skills/planning/templates/plan-template.md
```

Decompose into tasks following the planning skill rules:

1. **BDD-aligned tasks** — each task advances at least one Gherkin scenario. Map scenarios to tasks by examining what step definitions need to be written for those assertions to pass.

2. **Infrastructure tasks** — only when necessary as prerequisites (test harness setup, shared step helpers). Use validator done signals.

3. **Context budget** — estimate each task at ≤ 200K tokens. Consider: source files to read + spec files + Gherkin + step definition work. Split if over budget.

4. **Task fields** — for each task include:
   - Task ID: `T-001`, `T-002`, etc. (flat sequential)
   - Title: verb-noun describing what step definitions get written
   - Use Cases: which UC-XXXX IDs this task advances
   - Feature: parent feature ID (FEAT-XXXX)
   - Domain: the domain the feature belongs to
   - Architecture: path to the feature's ARCHITECTURE.md
   - Intent: `wire-bdd` (reverse plan always uses wire-bdd)
   - Status: `pending`
   - Estimated context: `~{N}K tokens`
   - Done signal: which `@SC-XXXX` scenarios must pass, or validator check
   - Depends on: `T-NNN` or `none`
   - Description: what step definitions to implement, which existing implementation files they exercise, constraints
   - Files to create/modify: step definition file paths (not application code)

   When ARCHITECTURE.md has a Code Map, reference the existing implementation files in each task's description so the build agent knows what code the step definitions should exercise.

   When generating tasks for a cross-domain plan (global feature):
   - Each task's Domain field must be a real domain, never `global`
   - Group tasks by domain in the plan output
   - Include in each task description: "Global baseline: prd/domains/global/features/FEAT-XXXX/"

5. **Order by dependency chain** — infrastructure first, shared step helpers before scenario-specific steps, happy-path before error-handling.

## Step 10: Plan Preview

Use AskUserQuestion to show the full plan file content:

- Question: Show the complete plan markdown content in a code block
- Header: "Plan Preview"
- Options: "Looks good" / "Edit" / "Cancel"

If "Edit": use AskUserQuestion to collect corrections, regenerate affected tasks, and re-preview.
If "Cancel": stop.

## Step 11: Write Plan File

1. Generate the filename:
   - Timestamp: current time as `YYYYMMDDHHmm`
   - Slug: derived from scope per the planning skill rules (feature name kebab-case, UC name kebab-case, `mixed`, or `full-scan`)
   - Full name: `{YYYYMMDDHHmm}-{slug}.md`

2. Ensure directory exists:
   ```bash
   mkdir -p .molcajete/plans
   ```

3. Write the plan file to `.molcajete/plans/{filename}`.

## Step 12: Report

Tell the user:

- Plan file path
- Task count and total estimated context budget
- Features and UCs covered
- Any UCs excluded due to missing Gherkin

Suggest next step: "Review the plan file, then run `/m:build {plan-name}` to start implementation."
