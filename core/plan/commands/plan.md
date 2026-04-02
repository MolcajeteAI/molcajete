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

You generate implementation plans from PRD specs. You scan for unimplemented use cases, verify Gherkin exists, and produce a **JSON** plan file in `.molcajete/plans/` with a task breakdown that `/m:build` will execute. The output format is strictly JSON — never markdown.

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
- `UC-XXXX` → must exist as `prd/domains/*/features/*/use-cases/UC-XXXX-*.md`
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

- `FEAT-XXXX` → include all UCs under that feature. Glob `prd/domains/*/features/FEAT-XXXX-*/` to find it, then read `USE-CASES.md` and all UC files in `use-cases/`.
- `UC-XXXX` → include that specific UC. Glob `prd/domains/*/features/*/use-cases/UC-XXXX-*.md` to find it.
- `SC-XXXX` → include the parent UC. Grep `prd/domains/*/features/*/use-cases/*.md` for `### SC-XXXX` to find the UC file, then include the whole UC (scenarios aren't planned individually).

For each in-scope feature, extract the domain from the path and also read:
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md`
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` (if exists)

**Global feature handling:** After resolving the feature's domain from the path:

If the resolved domain is `global`:
1. Glob `prd/domains/*/features/FEAT-XXXX-*/` to find all domains that have this feature (exclude `global` from results). The shared FEAT-XXXX ID makes resolution direct — no need to search by refs.
2. If no domain features found: tell the user "FEAT-XXXX exists only as a global baseline. Create domain features first with `/m:feature` targeting specific domains." Then stop.
3. If domain features found: this is a cross-domain plan. The planner must generate tasks for each domain that has this feature.
4. Load the global feature's REQUIREMENTS.md and ARCHITECTURE.md as baseline context.
5. For each domain feature found, load that domain's REQUIREMENTS.md, ARCHITECTURE.md, and USE-CASES.md + UC files.
6. Use AskUserQuestion to confirm: "FEAT-XXXX is a global feature. Domain features found in: {list of domains}. This will generate a cross-domain plan. Continue, or specify UC IDs for narrower scope?"

### Mode B: No Arguments (full scan)

Find everything that needs implementation:

1. Read `prd/FEATURES.md` for all features across all domains. Skip features in the `## global` section during full scan (global features are only planned when explicitly targeted by ID).
2. For each feature, read `prd/domains/{domain}/features/FEAT-XXXX-{slug}/USE-CASES.md`.
3. Collect UCs with status `pending` or `dirty` in the USE-CASES.md table.
4. Also scan `prd/FEATURES.md` for features with status `dirty`. For each dirty feature, include **all** its UCs from USE-CASES.md — even those with `implemented` status — since a dirty feature means requirements changed and all UCs may need re-planning.
5. Also include features with status `pending` that have UCs ready.
6. For each in-scope feature, read `REQUIREMENTS.md` and `ARCHITECTURE.md` (if exists).
7. Build the full picture of all pending work.

If nothing plannable is found: tell the user "No unimplemented specs found. All use cases are either already implemented or not yet specified. Use `/m:feature`, `/m:usecase`, or `/m:spec` to author new specs, then `/m:scenario` to generate Gherkin." Then stop.

## Step 6: Load Global Refs Context

For each in-scope domain feature, read its REQUIREMENTS.md frontmatter. If `refs` is non-empty, load each referenced global feature's REQUIREMENTS.md and ARCHITECTURE.md. Pass as additional baseline context to task generation.

## Step 7: Verify Gherkin

For each plannable UC:

1. Grep `bdd/features/` for `@UC-XXXX` tag to find the `.feature` file.
2. Verify the `.feature` file exists and contains at least one `Scenario:` or `Scenario Outline:`.
3. Read the feature file to count scenarios and extract step patterns.

Report gaps:
- If Gherkin missing for a UC: "UC-XXXX ({name}) has no Gherkin. Run `/m:scenario UC-XXXX` first."

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

If any ARCHITECTURE.md contains a Code Map section with entries, use it to map scenarios to implementation files. Include the ARCHITECTURE.md path in each task's Architecture field so build tasks can load it for context.

Read the plan schema — it defines the exact JSON structure you must produce:
```
${CLAUDE_PLUGIN_ROOT}/plan/skills/planning/templates/plan-schema.json
```

Build a JSON object matching this schema. The top-level object has `title`, `generated`, `status`, `scope`, `base_branch`, `bdd_command`, and `tasks` (array). Decompose into tasks following the planning skill rules:

1. **BDD-aligned tasks** — each task advances at least one Gherkin scenario. Map scenarios to tasks by examining what code needs to exist for those assertions to pass.

2. **Infrastructure tasks** — only when necessary as prerequisites (database setup, test harness, shared middleware). These tasks have null `scenario` (BDD skipped).

3. **Context budget** — estimate each task at ≤ 200K tokens. Consider: source files to read + spec files + Gherkin + implementation work. Split if over budget.

4. **Task fields** — for each task include all fields from the plan schema:
   - `id`: `T-001`, `T-002`, etc. (flat sequential)
   - `title`: verb-noun describing what gets built
   - `use_case`: the UC-XXXX this task advances
   - `feature`: parent feature ID (FEAT-XXXX)
   - `domain`: the domain the feature belongs to
   - `architecture`: path to the feature's ARCHITECTURE.md (at `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md`)
   - `intent`: `implement` (forward plan always uses implement)
   - `status`: `pending`
   - `estimated_context`: `~{N}K tokens`
   - `scenario`: `"SC-XXXX"` for filtered BDD gate; null for chores (BDD skipped)
   - `depends_on`: `["T-NNN"]` or `[]`
   - `description`: what to implement, why, constraints
   - `files_to_modify`: expected file paths
   - `summary`: `null`
   - `errors`: `[]`

   When generating tasks for a cross-domain plan (global feature):
   - Each task's Domain field must be a real domain, never `global`
   - Group tasks by domain in the plan output
   - Include in each task description: "Global baseline: prd/domains/global/features/FEAT-XXXX-{slug}/"

5. **Plan-level fields** — also populate:
   - `base_branch`: current git branch (run `git branch --show-current`)
   - `bdd_command`: detect per dispatch skill's BDD Command Detection rules, `null` if not detectable yet

6. **Order by dependency chain** — infrastructure first, data models before APIs, core logic before edge cases, happy-path before error-handling.

## Step 10: Plan Preview

Use AskUserQuestion to show the full plan JSON content:

- Question: Show the complete plan JSON in a code block with 2-space indent
- Header: "Plan Preview"
- Options: "Looks good" / "Edit" / "Cancel"

If "Edit": use AskUserQuestion to collect corrections, regenerate affected tasks, and re-preview.
If "Cancel": stop.

## Step 11: Write Plan File

1. Generate the directory name:
   - Timestamp: current time as `YYYYMMDDHHmm`
   - Slug: derived from scope per the planning skill rules (feature name kebab-case, UC name kebab-case, `mixed`, or `full-scan`)
   - Directory: `{YYYYMMDDHHmm}-{slug}`

2. Create the plan directory:
   ```bash
   mkdir -p .molcajete/plans/{YYYYMMDDHHmm}-{slug}
   ```

3. Write the plan file to `.molcajete/plans/{YYYYMMDDHHmm}-{slug}/plan.json`.

## Step 12: Report

Tell the user:

- Plan file path
- Task count and total estimated context budget
- Features and UCs covered
- Any UCs excluded due to missing Gherkin

Suggest next step: "Review the plan file, then run `/m:build {plan-name}` to start implementation."
