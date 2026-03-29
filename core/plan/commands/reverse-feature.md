---
description: Reverse-engineer a single feature from existing code (cascades to UCs + scenarios)
model: claude-opus-4-6
argument-hint: <freeform description of feature to extract>
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

# Reverse-Engineer Feature from Code

You are extracting a single feature spec from existing code, including all its use cases and scenarios. Instead of interviewing the user for requirements, you scan the codebase to discover what's already built, extract structured specs, enrich ARCHITECTURE.md with implementation research, and generate Gherkin artifacts.

This command runs as a two-task dispatcher to protect the 200K context limit. T1 researches the code and extracts PRD specs. T2 generates Gherkin artifacts. A user review checkpoint separates them.

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Load Skills

Read all skills that govern this command:

1. `${CLAUDE_PLUGIN_ROOT}/plan/skills/reverse-engineering/SKILL.md` — research methodology, extraction patterns, ARCHITECTURE.md enrichment, dispatcher integration
2. `${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/SKILL.md` — EARS syntax, Fit Criteria, feature structure, templates
3. `${CLAUDE_PLUGIN_ROOT}/plan/skills/usecase-authoring/SKILL.md` — flat scenario structure, Side Effects conventions, UC template
4. `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — Gherkin generation, tagging, scaffold, step stubs

Follow these skills' rules for all subsequent steps.

## Step 2: Verify Prerequisites

Check that `prd/PROJECT.md` and `prd/FEATURES.md` both exist.

If either is missing, tell the user:

"Project foundation not found. Run `/m:setup` first to create PROJECT.md and FEATURES.md."

Then stop. Do not proceed.

## Step 3: Load Project Context

Read the following files to understand the project and avoid duplicate features:

1. `prd/PROJECT.md` — project description (required)
2. `prd/TECH-STACK.md` — technology choices (if exists)
3. `prd/ACTORS.md` — system actors (if exists)
4. `prd/FEATURES.md` — existing features (required, check for duplicates)

Use the project context to inform your code analysis and extraction.

## Step 4: Collect Description

If `$ARGUMENTS` is not empty, use it as the description of the existing code capability to extract.

If `$ARGUMENTS` is empty, use AskUserQuestion:
- Question: "Describe the existing code capability you want to extract into a feature spec. Include any relevant module names, directories, or functionality areas.\n\n**Examples:**\n- \"The authentication system in src/auth/ — handles login, registration, and token refresh\"\n- \"The payment processing pipeline that handles Stripe webhooks and order fulfillment\"\n- \"The notification service that sends emails and push notifications\""
- Header: "Describe Existing Capability"

## Step 5: Discovery Scan

Use Glob, Grep, and Read to find files matching the described capability.

### 5.1 Discovery

Search for relevant files:
- Glob for directory structures, module files, and configuration related to the capability
- Grep for key terms, class names, function names, route definitions, and exports
- Read key files to understand the implementation

### 5.2 Scope Confirmation

Present the discovered files via AskUserQuestion before deep analysis:

- Question: "I found these files related to the described capability:\n\n{list of files grouped by directory, with one-line description of each}\n\nShould I analyze all of these, or would you like to narrow or expand the scope?"
- Header: "Relevant Files"
- Options: "Analyze all" / "Narrow scope" (user specifies via Other) / "Add more files" (user specifies via Other)

If the user narrows or expands, adjust the file list accordingly.

## Step 6: Launch T1 — Research + Spec Extraction

Use the Agent tool to launch a general-purpose subagent for deep analysis and spec extraction.

The subagent prompt must include:

1. **Skills to load:**
   - `${CLAUDE_PLUGIN_ROOT}/plan/skills/reverse-engineering/SKILL.md`
   - `${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/SKILL.md`
   - `${CLAUDE_PLUGIN_ROOT}/plan/skills/usecase-authoring/SKILL.md`

2. **Project context files to read:**
   - `prd/PROJECT.md`, `prd/TECH-STACK.md` (if exists), `prd/ACTORS.md` (if exists), `prd/FEATURES.md`

3. **The confirmed file list** from Step 5.2

4. **The specific task:**
   - Read and analyze all confirmed files following the reverse-engineering skill's research methodology
   - Extract the feature: name, non-goals, actors, EARS functional requirements with Fit Criteria, non-functional requirements, acceptance criteria
   - Extract all use cases: name, objective, actor, preconditions, trigger, scenarios (Given/Steps/Outcomes/Side Effects per the usecase-authoring skill)
   - Populate ARCHITECTURE.md with all enrichment sections: Component Inventory, Data Model (with real entities), API Surface, Integration Points, Event Topology, Code Map (linking every UC and SC to implementation files)
   - Compare discovered actors against `prd/ACTORS.md` and add any new ones. Compare discovered technologies against `prd/TECH-STACK.md` and add any new ones. Follow the project-level discovery rules from the reverse-engineering skill.
   - Generate IDs: run `node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js {count}` for all needed IDs (1 FEAT + N UCs + M SCs)

5. **Files to write:**
   - Create directory: `prd/features/FEAT-XXXX/use-cases/`
   - `prd/features/FEAT-XXXX/REQUIREMENTS.md` using template at `${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/templates/REQUIREMENTS-template.md`
   - `prd/features/FEAT-XXXX/USE-CASES.md` using template at `${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/templates/USE-CASES-template.md` (with rows for all extracted UCs)
   - `prd/features/FEAT-XXXX/ARCHITECTURE.md` using template at `${CLAUDE_PLUGIN_ROOT}/plan/skills/architecture/templates/ARCHITECTURE-template.md`
   - `prd/features/FEAT-XXXX/use-cases/UC-XXXX.md` for each use case, using template at `${CLAUDE_PLUGIN_ROOT}/plan/skills/usecase-authoring/templates/UC-template.md` — set YAML frontmatter `status` to `pending`, and annotate each scenario heading with `pending`: `### SC-XXXX: {Scenario Name} \`pending\``
   - In USE-CASES.md rows, set status column to `pending`
   - Append a row to `prd/FEATURES.md`: `| FEAT-XXXX | {name} | {description} | pending | @FEAT-XXXX | [features/FEAT-XXXX/](features/FEAT-XXXX/) |`
   - Edit `prd/ACTORS.md` — append rows for newly discovered actors (if any)
   - Edit `prd/TECH-STACK.md` — add newly discovered tech stack entries (if any)

6. **Report format:** The subagent must end with a structured report listing:
   - Feature ID, name, and file path
   - Use case IDs, names, scenario counts, and file paths
   - ARCHITECTURE.md enrichment summary (which sections populated, file counts in Component Inventory, entity counts in Data Model, route counts in API Surface, Code Map entry counts)
   - Project-level updates: {count} new actors added to ACTORS.md, {count} new tech stack entries added to TECH-STACK.md (list names)

## Step 7: Report T1 Results

After the subagent returns, present the results via AskUserQuestion:

- Question: "**Research + Spec Extraction Complete**\n\n**{FEAT-XXXX}: {name}**\n- REQUIREMENTS.md: {FR count} functional, {NFR count} non-functional requirements\n- ARCHITECTURE.md: enriched with {sections list}\n- Use Cases:\n  {for each UC: UC-XXXX: {name} ({scenario count} scenarios)}\n\nPlease review the generated specs in `prd/features/FEAT-XXXX/`. Edit any specs that need adjustment, then continue to generate Gherkin.\n\nReady to proceed with Gherkin generation?"
- Header: "Specs Ready for Review"
- Options: "Proceed with Gherkin generation" / "I need to review and edit first — I'll re-run when ready"

If the user chooses to review first, stop. They will re-run or continue manually.

## Step 8: Launch T2 — Gherkin Generation

Use the Agent tool to launch a general-purpose subagent for Gherkin generation.

The subagent prompt must include:

1. **Skills to load:**
   - `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md`
   - `${CLAUDE_PLUGIN_ROOT}/plan/skills/usecase-authoring/SKILL.md` (Gherkin Mapping table)
   - `${CLAUDE_PLUGIN_ROOT}/plan/skills/reverse-engineering/SKILL.md` (step stub convention)

2. **Files to read:**
   - `prd/features/FEAT-XXXX/REQUIREMENTS.md`
   - `prd/features/FEAT-XXXX/ARCHITECTURE.md`
   - All UC files in `prd/features/FEAT-XXXX/use-cases/`
   - `prd/TECH-STACK.md` (if exists) for language/framework detection

3. **The specific task:**
   - Run scaffold setup from `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/scaffold.md`
   - Infer domain from feature subject area, check existing domains under `bdd/features/`
   - For each UC in this feature:
     - Generate `.feature` file with scenarios using the Gherkin Mapping table
     - Step stubs must throw pending/not-implemented errors (per reverse-engineering skill convention)
     - Follow dedup procedure for existing feature files
   - Update `bdd/features/INDEX.md` and `bdd/steps/INDEX.md`
   - Verify UC statuses are `pending` in both UC files and USE-CASES.md
   - Add `pending` annotation to each scenario heading in UC files: `### SC-XXXX: {Scenario Name} \`pending\``
   - Run splitting check for any feature file exceeding 15 scenarios

4. **Report format:** The subagent must end with a structured report listing:
   - Feature files created (paths, scenario counts)
   - Step definition files created/updated
   - UC status changes
   - Any splitting performed

## Step 9: Report

Tell the user what was created:

**Specs Created:**
- `prd/features/FEAT-XXXX/REQUIREMENTS.md` — feature requirements (EARS syntax, extracted from code)
- `prd/features/FEAT-XXXX/USE-CASES.md` — use case index
- `prd/features/FEAT-XXXX/ARCHITECTURE.md` — enriched with implementation research
- UC files with scenario counts
- Updated `prd/FEATURES.md` with new row

**Gherkin Created:**
- Feature file paths with scenario counts
- Step definition stubs (pending/not-implemented)
- Updated BDD indexes

**Status Changes:**
- Feature set to `pending`
- UCs set to `pending`
- Scenario headings annotated with `pending`

Suggest next step: "Review the specs and Gherkin, then run `/m:plan FEAT-XXXX` to plan step implementation."
