---
description: Generate Gherkin feature files from a use case
model: claude-opus-4-6
argument-hint: <UC-XXXX>
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

# Generate Gherkin Scenarios

You are generating Gherkin feature files from an existing use case. You will read the UC file and construct `.feature` content using the Gherkin Mapping table.

**Use case argument:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Load Skills

Read both skills that govern this command:

1. Read `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — generation rules, tagging, step writing, scaffold, detection, index maintenance
2. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/usecase-authoring/SKILL.md` — Gherkin Mapping table only (the table that maps UC elements to Gherkin output)

Follow these skills' rules for all subsequent steps.

## Step 2: Verify Prerequisites

1. Parse `$ARGUMENTS` for a `UC-XXXX` token. If missing or does not match the pattern `UC-` followed by an alphanumeric code, tell the user:

   "Usage: `/m:scenario UC-XXXX`. Provide a valid use case ID."

   Then stop.

2. Glob `prd/domains/*/features/*/use-cases/UC-XXXX-*.md` (substituting the actual ID) to find the UC file. If not found, tell the user:

   "Use case {UC-XXXX} not found. Check the ID and try again."

   Then stop.

3. Extract the parent `FEAT-XXXX` from the path (the directory name under `features/`) and the domain from the path (the directory name under `prd/domains/`).

4. Verify `prd/FEATURES.md` exists. If missing, tell the user:

   "Run `/m:setup` first — DOMAINS.md and FEATURES.md are required."

   Then stop.

5. Verify FEAT-XXXX exists in `prd/FEATURES.md`. If not found, tell the user:

   "Feature {FEAT-XXXX} not found in FEATURES.md. Check the ID and try again."

   Then stop.

## Step 3: Load Project Context

Read these files to understand the project, feature, and use case:

- `prd/PROJECT.md` — what this project is
- `prd/TECH-STACK.md` — technology context (if exists)
- `prd/ACTORS.md` — known actors (if exists)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md` — feature requirements
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` — architecture context (if exists)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/UC-XXXX-{slug}.md` — the target use case

## Step 4: Parse Use Case

Extract from the UC file:

**YAML frontmatter:**
- `id` — the UC-XXXX ID
- `name` — the use case name
- `feature` — parent FEAT-XXXX
- `actor` — primary actor
- `tag` — the @UC-XXXX tag

**Gherkin Tags line:** `@FEAT-XXXX @UC-XXXX`

**Preconditions:** These become Gherkin `Background: Given` clauses.

**Trigger:** Context for constructing `When` clauses.

**Scenarios:** Each `### SC-XXXX:` block:
- **Given** → `Given`/`And` clauses (after Background)
- **Steps** → `When`/`And` clauses (decompose compound steps into one action per clause)
- **Outcomes** → `Then` clauses (must use exact assertion values)
- **Side Effects** (positive) → `And` clauses
- **Side Effects** ("No ...") → `And no ...` clauses

If no scenarios are found in the UC file, tell the user:

"{UC-XXXX} has no scenarios. Run `/m:usecase` to add scenarios first."

Then stop.

## Step 5: Scaffold Setup

Run the scaffold procedure from `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/scaffold.md` (steps 2a–2h):

- Check for existing scaffold, create if missing
- Detect domains, language, format
- Create INDEX.md files and world module
- Persist BDD settings to `.molcajete/settings.json`
- Validate existing indexes, rebuild if drift detected

## Step 6: Domain and Tag Selection

### 6.1 Domain Selection

Infer the domain from the feature's subject area. Check existing domain folders under `bdd/features/`.

Use AskUserQuestion:
- Question: "Which domain folder should this feature file go in?\n\nInferred domain: **{inferred}**\n\nExisting domains: {list of existing domain folders}"
- Header: "Domain"
- Options: "{inferred domain}" / list existing domains / "Other" (user provides via Other)

### 6.2 Classification Tags

Propose tags for each scenario based on its nature:
- First scenario / happy-path → `@smoke`
- Error / edge case → `@regression`
- Security / data integrity → `@critical`

Also propose a feature-level priority tag.

Use AskUserQuestion:
- Question: "Proposed tags:\n\n**Feature-level:** `@FEAT-XXXX @{domain} @{priority-tag}`\n\n{for each scenario: `@UC-XXXX @SC-XXXX @pending @{classification-tag}` — {scenario name}}\n\n(`@pending` is automatic for new scenarios and cannot be removed here.)\n\nDo these look correct?"
- Header: "Tags"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

## Step 7: Generate Gherkin

### 7.1 Construct Feature File Content

Using the Gherkin Mapping table from the usecase-authoring skill:

- **Feature-level tags:** `@FEAT-XXXX @{domain} @{priority-tag}` (where `{domain}` comes from the resolved domain path)
- **Feature line:** `Feature: {UC Name}` with description from UC objective
- **Background:** from UC Preconditions (each precondition becomes a `Given` / `And` clause)
- **Each scenario:**
  - Tags: `@UC-XXXX @SC-XXXX @pending @{classification-tag}`
  - `Scenario: {Scenario Name}`
  - `Given` / `And` from scenario Given field
  - `When` / `And` from scenario Steps field (one action per clause)
  - `Then` from scenario Outcomes field (exact assertion values)
  - `And` from positive Side Effects
  - `And no ...` from "No ..." Side Effects

Follow the step writing rules from the gherkin skill (declarative Given, exact Then, parameterized patterns). Use `Scenario Outline` + `Examples` when multiple scenarios test the same flow with different inputs.

### 7.2 Preview

Use AskUserQuestion to show the full generated Gherkin for review:
- Question: "Here's the generated Gherkin:\n\n```gherkin\n{full feature file content}\n```\n\nDoes this look correct?"
- Header: "Preview"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

### 7.3 Check for Existing Feature

Grep `bdd/features/` for `@FEAT-XXXX` tag. If found, follow the dedup procedure from `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/generation.md` step 3-pre:
- Skip exact duplicate scenarios
- Warn on near-duplicates
- Append only new scenarios to the existing feature file

### 7.4 Write Feature File

Write the `.feature` file to `bdd/features/{domain}/{feature-name}.feature` (kebab-case, describes the feature not a scenario). If appending to an existing file, use the Edit tool to append new scenarios at the end.

## Step 8: Update Indexes

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/generation.md` step 3d — update `bdd/features/INDEX.md`.

## Step 9: Splitting Check

Read `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/splitting.md`. If the scenario count in the target feature file exceeds 15, run the splitting procedure.

## Step 10: Update UC Status and Scenario Headings

1. For each scenario in the UC file, add a `pending` status annotation to the scenario heading line:
   ```
   ### SC-XXXX: {Scenario Name} `pending`
   ```
   Gherkin files carry `@pending` lifecycle tags — these are added during generation (Step 7.1) and removed by the dev session during build.

2. The UC file's YAML frontmatter `status` stays as-is (already `pending` from creation). Do not change it.

3. Do not change the USE-CASES.md status column.

## Step 11: Report

Tell the user what was created:

- Feature file path + scenario count
- Updated INDEX.md files
- Scenario heading annotations set to `pending`

Suggest next step: "Use `/m:plan UC-XXXX` to generate an implementation plan, or `/m:scenario UC-YYYY` for another use case."
