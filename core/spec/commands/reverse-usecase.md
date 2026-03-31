---
description: Reverse-engineer a use case from existing code (cascades to scenarios)
model: claude-opus-4-6
argument-hint: "[FEAT-XXXX] <freeform description of interaction>"
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

# Reverse-Engineer Use Case from Code

You are extracting a use case spec from existing code, including all its scenarios. Instead of interviewing the user for scenarios, you scan the codebase within a feature's scope to discover interaction flows, extract the structured use case, update ARCHITECTURE.md's Code Map, and generate Gherkin artifacts.

This command runs as a two-task dispatcher. T1 researches the code and extracts the UC spec. T2 generates Gherkin. A user review checkpoint separates them.

**Use case input:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Load Skills

Read all skills that govern this command:

1. `${CLAUDE_PLUGIN_ROOT}/spec/skills/reverse-engineering/SKILL.md` — research methodology, extraction patterns, ARCHITECTURE.md enrichment, ID resolution
2. `${CLAUDE_PLUGIN_ROOT}/spec/skills/usecase-authoring/SKILL.md` — flat scenario structure, Side Effects conventions, UC template
3. `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — Gherkin generation, tagging, scaffold, step stubs

Follow these skills' rules for all subsequent steps.

## Step 2: Verify Prerequisites

1. Check that `prd/DOMAINS.md` exists. If missing, tell the user:

   "Run `/m:setup` first — DOMAINS.md is required before creating use cases."

   Then stop.

2. Parse `$ARGUMENTS` for a `FEAT-XXXX` token (first token matching `FEAT-` followed by an alphanumeric code).

### 2a: FEAT-XXXX Provided

If a `FEAT-XXXX` token is found:

1. Glob `prd/domains/*/features/FEAT-XXXX-*/` to find the feature directory and extract the domain. If not found:

   "Feature {FEAT-XXXX} not found in FEATURES.md. Check the ID and try again."

   Then stop.

2. Extract the feature directory path from the matched row.

3. Check that `prd/domains/{domain}/features/FEAT-XXXX-{slug}/USE-CASES.md` exists. If missing:

   "USE-CASES.md is missing for {FEAT-XXXX}. Run `/m:feature` or `/m:reverse-feature` to create the feature structure first."

   Then stop.

### 2b: FEAT-XXXX Not Provided

If no `FEAT-XXXX` token is found in `$ARGUMENTS`, resolve the feature using the ID resolution rules from the reverse-engineering skill:

1. Read `prd/FEATURES.md` to build a combined feature list
2. Match features by keyword similarity to the freeform description in `$ARGUMENTS`
3. If 1 match → confirm via AskUserQuestion: "This appears to belong to **{FEAT-XXXX}: {name}**. Is that correct?"
   - Options: "Yes" / "No, it belongs to another feature" (user specifies via Other) / "No matching feature — I need to create one first"
4. If N matches → disambiguate via AskUserQuestion: "Which feature does this interaction belong to?\n\n{for each match: **{FEAT-XXXX}:** {name} — {description}}"
5. If 0 matches → "No matching feature found. Use `/m:reverse-feature` to create one first." Then stop.

After resolution, verify the feature directory and USE-CASES.md exist (same checks as 2a).

## Step 3: Load Project Context

Read these files to understand the project and feature:
- `prd/PROJECT.md` — what this project is
- `prd/TECH-STACK.md` — technology context (if exists)
- `prd/ACTORS.md` — known actors (if exists)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md` — feature requirements for context
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` — existing architecture research (if exists)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/USE-CASES.md` — existing UCs

## Step 4: Collect Description

The remainder of `$ARGUMENTS` after the optional FEAT-XXXX token is the freeform description.

If the freeform part is non-empty, use it as the description of the interaction to extract.

If the freeform part is empty, use AskUserQuestion:
- Question: "Describe the interaction or workflow you want to extract from the code. Include any relevant entry points, endpoints, or function names.\n\n**Examples:**\n- \"The user login flow starting from POST /auth/login\"\n- \"The order checkout process from cart to payment confirmation\"\n- \"The file upload and processing pipeline in the media service\""
- Header: "Describe Interaction"

## Step 5: Discovery Scan

Use the feature context (REQUIREMENTS.md, ARCHITECTURE.md if exists) to scope the search.

### 5.1 Discovery

Search for files implementing the described interaction:
- Grep for route handlers, controller methods, service functions related to the interaction
- Glob for related test files, middleware, model definitions
- Read key files to trace the execution flow

Focus on:
- **Route handlers / API endpoints** — entry points and request handling
- **Service methods** — business logic and orchestration
- **Model definitions** — data structures and validation rules
- **Event emissions** — side effects and async operations
- **Validation / error handling** — guard clauses, middleware, try/catch blocks

### 5.2 Scope Confirmation

Present the discovered files via AskUserQuestion:

- Question: "I found these files related to the described interaction:\n\n{list of files grouped by role (handlers, services, models, middleware, tests), with one-line description of each}\n\nShould I analyze all of these, or would you like to narrow or expand the scope?"
- Header: "Relevant Files"
- Options: "Analyze all" / "Narrow scope" (user specifies via Other) / "Add more files" (user specifies via Other)

## Step 6: Launch T1 — Research + Spec Extraction

Use the Agent tool to launch a general-purpose subagent for deep analysis and UC extraction.

The subagent prompt must include:

1. **Skills to load:**
   - `${CLAUDE_PLUGIN_ROOT}/spec/skills/reverse-engineering/SKILL.md`
   - `${CLAUDE_PLUGIN_ROOT}/spec/skills/usecase-authoring/SKILL.md`

2. **Project context files to read:**
   - `prd/PROJECT.md`, `prd/TECH-STACK.md` (if exists), `prd/ACTORS.md` (if exists)
   - `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md`
   - `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` (if exists)

3. **The confirmed file list** from Step 5.2

4. **The specific task:**
   - Read and analyze all confirmed files following the reverse-engineering skill's research methodology
   - Extract the use case: name, objective, actor, preconditions, trigger, scenarios (Given/Steps/Outcomes/Side Effects per the usecase-authoring skill)
   - Update ARCHITECTURE.md: add new entries to Component Inventory, API Surface, and Code Map for this UC and its scenarios. If ARCHITECTURE.md doesn't have enrichment sections yet, add them using the enriched template structure
   - Compare discovered actors against `prd/ACTORS.md` and add any new ones. Compare discovered technologies against `prd/TECH-STACK.md` and add any new ones. Follow the project-level discovery rules from the reverse-engineering skill.
   - Generate IDs: run `node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js {count}` for 1 UC + N SCs

5. **Files to write:**
   - Create directory if needed: `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/`
   - `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/UC-XXXX-{slug}.md` using template at `${CLAUDE_PLUGIN_ROOT}/spec/skills/usecase-authoring/templates/UC-template.md` — set YAML frontmatter `status` to `pending`, and annotate each scenario heading with `pending`: `### SC-XXXX: {Scenario Name} \`pending\``
   - Edit `prd/domains/{domain}/features/FEAT-XXXX-{slug}/USE-CASES.md` — add row: `| UC-XXXX | {name} | {description} | pending | [UC-XXXX-{slug}.md](use-cases/UC-XXXX-{slug}.md) |`
   - Edit `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` — add Code Map entries for UC-XXXX and all SC-XXXX IDs, update frontmatter `use_cases` and `scenarios` arrays, update `last_update` date
   - Edit `prd/ACTORS.md` — append rows for newly discovered actors (if any)
   - Edit `prd/TECH-STACK.md` — add newly discovered tech stack entries (if any)

6. **Report format:** The subagent must end with a structured report listing:
   - UC ID, name, scenario count, and file path
   - Scenario IDs and names
   - ARCHITECTURE.md changes (new Code Map entries, new Component Inventory rows)
   - Project-level updates: {count} new actors added to ACTORS.md, {count} new tech stack entries added to TECH-STACK.md (list names)

## Step 7: Report T1 Results

After the subagent returns, present the results via AskUserQuestion:

- Question: "**Use Case Extracted**\n\n**{UC-XXXX}: {name}** (under {FEAT-XXXX})\n- {scenario count} scenarios extracted\n- Scenarios: {list SC-XXXX: {name}}\n- ARCHITECTURE.md updated with Code Map entries\n\nPlease review the UC file at `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/UC-XXXX-{slug}.md`. Edit if needed, then continue to generate Gherkin.\n\nReady to proceed with Gherkin generation?"
- Header: "UC Ready for Review"
- Options: "Proceed with Gherkin generation" / "I need to review and edit first — I'll re-run when ready"

If the user chooses to review first, stop.

## Step 8: Launch T2 — Gherkin Generation

Use the Agent tool to launch a general-purpose subagent for Gherkin generation.

The subagent prompt must include:

1. **Skills to load:**
   - `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md`
   - `${CLAUDE_PLUGIN_ROOT}/spec/skills/usecase-authoring/SKILL.md` (Gherkin Mapping table)

2. **Files to read:**
   - `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md`
   - `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md`
   - `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/UC-XXXX-{slug}.md`
   - `prd/TECH-STACK.md` (if exists) for language/framework detection

3. **The specific task:**
   - Run scaffold setup from `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/scaffold.md`
   - Infer domain from feature subject area, check existing domains under `bdd/features/`
   - Generate `.feature` file with scenarios using the Gherkin Mapping table
   - Follow dedup procedure for existing feature files
   - Update `bdd/features/INDEX.md`
   - Verify UC status is `pending` in both UC file and USE-CASES.md (should already be set by T1)
   - Run splitting check if feature file exceeds 15 scenarios

4. **Report format:** The subagent must end with a structured report listing:
   - Feature file path and scenario count
   - UC status change

## Step 9: Report

Tell the user what was created:

- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/UC-XXXX-{slug}.md` — UC file with flat scenario structure (extracted from code)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/USE-CASES.md` — updated with new row
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` — updated with Code Map entries
- Feature file path + scenario count
- UC status: `pending`
- Scenario headings annotated with `pending`

Suggest next steps:
- "Use `/m:reverse-usecase FEAT-XXXX <description>` to extract more use cases from this feature's code."
- "Use `/m:reverse-scenario UC-XXXX <description>` to extract additional scenarios."
- "Use `/m:reverse-plan FEAT-XXXX` to plan BDD wiring."
