---
description: Reverse-engineer a single scenario from a code path (atomic, with Gherkin generation)
model: claude-opus-4-6
argument-hint: "[UC-XXXX] <freeform description of code path>"
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

# Reverse-Engineer Scenario from Code

You are extracting scenarios from existing code and generating Gherkin feature files with step definition stubs. This is the atomic reverse command — it scans a specific code path within a use case's scope, extracts scenario details, then generates BDD artifacts. It does not cascade to sub-entities.

**Input:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Load Skills

Read all skills that govern this command:

1. `${CLAUDE_PLUGIN_ROOT}/spec/skills/reverse-engineering/SKILL.md` — research methodology, extraction patterns, ARCHITECTURE.md enrichment, ID resolution, step stub convention
2. `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — generation rules, tagging, step writing, scaffold, detection, index maintenance
3. `${CLAUDE_PLUGIN_ROOT}/spec/skills/usecase-authoring/SKILL.md` — flat scenario structure, Gherkin Mapping table, Side Effects conventions

Follow these skills' rules for all subsequent steps.

## Step 2: Verify Prerequisites and Resolve UC

### 2a: UC-XXXX Provided

Parse `$ARGUMENTS` for a `UC-XXXX` token. If found:

1. Glob `prd/domains/*/features/*/use-cases/UC-XXXX.md` (substituting the actual ID) to find the UC file. If not found:

   "Use case {UC-XXXX} not found. Check the ID and try again."

   Then stop.

2. Extract the parent `FEAT-XXXX` from the path (the directory name under `features/`) and the domain from the path (under `prd/domains/`).

3. Verify `prd/DOMAINS.md` exists. If missing:

   "Run `/m:setup` first — DOMAINS.md is required."

   Then stop.

4. Verify FEAT-XXXX exists in `prd/domains/{domain}/FEATURES.md`. If not found:

   "Feature {FEAT-XXXX} not found in FEATURES.md. Check the ID and try again."

   Then stop.

### 2b: UC-XXXX Not Provided

If no `UC-XXXX` token is found in `$ARGUMENTS`, resolve the use case using the ID resolution rules from the reverse-engineering skill:

1. Glob `prd/domains/*/features/*/use-cases/*.md` to find all UC files
2. Read YAML frontmatter of each to get `id`, `name`, and `feature`
3. Match by keyword similarity to the freeform description in `$ARGUMENTS`
4. If 1 match → confirm via AskUserQuestion: "This appears to belong to **{UC-XXXX}: {name}** (under {FEAT-XXXX}). Is that correct?"
   - Options: "Yes" / "No, it belongs to another use case" (user specifies via Other) / "No matching use case — I need to create one first"
5. If N matches → disambiguate via AskUserQuestion: "Which use case does this code path belong to?\n\n{for each match: **{UC-XXXX}:** {name} (under {FEAT-XXXX})}"
6. If 0 matches → "No matching use case found. Use `/m:reverse-usecase` to create one first." Then stop.

After resolution, extract the parent FEAT-XXXX from the UC file path.

## Step 3: Load Project Context

Read these files to understand the project, feature, and use case:

- `prd/PROJECT.md` — what this project is
- `prd/TECH-STACK.md` — technology context (if exists)
- `prd/ACTORS.md` — known actors (if exists)
- `prd/domains/{domain}/features/FEAT-XXXX/REQUIREMENTS.md` — feature requirements
- `prd/domains/{domain}/features/FEAT-XXXX/ARCHITECTURE.md` — architecture context (if exists)
- `prd/domains/{domain}/features/FEAT-XXXX/use-cases/UC-XXXX.md` — the target use case

## Step 4: Collect Description

The remainder of `$ARGUMENTS` after the optional UC-XXXX token is the freeform description.

If the freeform part is non-empty, use it as the description of the code path to extract.

If the freeform part is empty, use AskUserQuestion:
- Question: "Describe the code path you want to extract as a scenario. Include any relevant function names, endpoints, error conditions, or edge cases.\n\n**Examples:**\n- \"The error handling when payment fails due to insufficient funds\"\n- \"The optimistic locking conflict resolution in the update endpoint\"\n- \"The happy path for file upload with image resizing\""
- Header: "Describe Code Path"

## Step 5: Scan Codebase

Use the UC context (objective, preconditions, trigger, existing scenarios) to narrow the search to the specific code path.

### 5.1 Discovery

Search for files implementing the described code path:
- Grep for specific error codes, exception types, conditional branches related to the description
- Read functions, methods, and handlers that implement the path
- Trace the execution from entry point through to response/outcome

Focus on extracting a single scenario:
- **Given** — specific preconditions for this code path (state setup, feature flags, data conditions)
- **Steps** — actor and system actions through the code path
- **Outcomes** — what the user sees / receives at the end
- **Side Effects** — look for event emissions, DB writes, external API calls, logging. Also note non-side-effects (things deliberately NOT done in this path) for `And no ...` assertions

### 5.2 Present Extracted Scenario

Use AskUserQuestion to present the extracted scenario:

- Question: "Here's the scenario extracted from the codebase:\n\n**Scenario: {name}**\n\n**Given:**\n{given}\n\n**Steps:**\n{steps}\n\n**Outcomes:**\n{outcomes}\n\n**Side Effects:**\n{side_effects}\n\nDoes this look correct?\n\n_Reminder: Side effects should include both things that happen (events, DB writes) AND explicit non-side-effects (things that do NOT happen)._"
- Header: "Extracted Scenario"
- Options: "Looks good" / "Edit" (user corrects via Other)

If the user selects "Edit", collect the correction and re-present via AskUserQuestion.

### 5.3 Scenario Loop

After each scenario is confirmed, ask:

- Question: "Would you like to extract another scenario from this use case's code? (e.g., another error path, edge case, or alternative flow)"
- Header: "Extract Another?"
- Options: "Yes, I'll describe the code path" (user provides via Other) / "No, that's all"

If the user wants another, repeat Steps 5.1–5.3 for the new code path. Continue until the user says no.

## Step 6: Assign IDs

Generate scenario IDs for all confirmed scenarios. If there are N scenarios:

```bash
node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js N
```

Prepend `SC-` to each output line (e.g., `SC-1T4B`, `SC-1T4C`).

## Step 7: Append to UC File

Edit the UC file (`prd/domains/{domain}/features/FEAT-XXXX/use-cases/UC-XXXX.md`):

1. Append each confirmed scenario in flat structure — each preceded and followed by a `---` horizontal rule, with SC-XXXX ID, Given/Steps/Outcomes/Side Effects.
2. Increment the `version` number in the YAML frontmatter.

## Step 8: Update ARCHITECTURE.md

If `prd/domains/{domain}/features/FEAT-XXXX/ARCHITECTURE.md` exists:

1. Add Code Map entries for each new SC-XXXX linking to the implementation files discovered during scanning.
2. Add the new SC-XXXX IDs to the frontmatter `scenarios` array.
3. Update `last_update` date in frontmatter to today.
4. If the ARCHITECTURE.md doesn't have a Code Map section yet, add one using the structure from the reverse-engineering skill.

## Step 9: Scaffold Setup

Run the scaffold procedure from `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/scaffold.md` (steps 2a–2h):

- Check for existing scaffold, create if missing
- Detect domains, language, format
- Create INDEX.md files and world module
- Persist BDD settings to `.molcajete/settings.json`
- Validate existing indexes, rebuild if drift detected

## Step 10: Domain and Tag Selection

### 10.1 Domain Selection

Infer the domain from the feature's subject area. Check existing domain folders under `bdd/features/`.

Use AskUserQuestion:
- Question: "Which domain folder should this feature file go in?\n\nInferred domain: **{inferred}**\n\nExisting domains: {list of existing domain folders}"
- Header: "Domain"
- Options: "{inferred domain}" / list existing domains / "Other" (user provides via Other)

### 10.2 Classification Tags

Propose tags for each scenario based on its nature:
- First scenario / happy-path → `@smoke`
- Error / edge case → `@regression`
- Security / data integrity → `@critical`

Also propose a feature-level priority tag.

Use AskUserQuestion:
- Question: "Proposed tags:\n\n**Feature-level:** `@FEAT-XXXX @{domain} @{priority-tag}`\n\n{for each scenario: `@UC-XXXX @SC-XXXX @{classification-tag}` — {scenario name}}\n\nDo these look correct?"
- Header: "Tags"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

## Step 11: Generate Gherkin

### 11.1 Construct Feature File Content

Using the Gherkin Mapping table from the usecase-authoring skill:

- **Feature-level tags:** `@FEAT-XXXX @{domain} @{priority-tag}`
- **Feature line:** `Feature: {UC Name}` with description from UC objective
- **Background:** from UC Preconditions (each precondition becomes a `Given` / `And` clause)
- **Each scenario:**
  - Tags: `@UC-XXXX @SC-XXXX @{classification-tag}`
  - `Scenario: {Scenario Name}`
  - `Given` / `And` from scenario Given field
  - `When` / `And` from scenario Steps field (one action per clause)
  - `Then` from scenario Outcomes field (exact assertion values)
  - `And` from positive Side Effects
  - `And no ...` from "No ..." Side Effects

Follow the step writing rules from the gherkin skill (declarative Given, exact Then, parameterized patterns). Use `Scenario Outline` + `Examples` when multiple scenarios test the same flow with different inputs.

### 11.2 Preview

Use AskUserQuestion to show the full generated Gherkin for review:
- Question: "Here's the generated Gherkin:\n\n```gherkin\n{full feature file content}\n```\n\nDoes this look correct?"
- Header: "Preview"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

### 11.3 Check for Existing Feature

Grep `bdd/features/` for `@FEAT-XXXX` tag. If found, follow the dedup procedure from `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/generation.md` step 3-pre:
- Skip exact duplicate scenarios
- Warn on near-duplicates
- Append only new scenarios to the existing feature file

### 11.4 Write Feature File

Write the `.feature` file to `bdd/features/{domain}/{feature-name}.feature` (kebab-case, describes the feature not a scenario). If appending to an existing file, use the Edit tool to append new scenarios at the end.

## Step 12: Generate Step Definitions

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/generation.md` step 3c:

1. Read `bdd/steps/INDEX.md` for existing reusable patterns.
2. For each step in the generated feature file: check for existing match → reuse, or create new stub.
3. New stubs must throw pending/not-implemented errors (per the reverse-engineering skill's step stub convention):
   - Docstring (or doc comment) describing what the step does
   - Parameter descriptions with types
   - Pending-error stub body per the gherkin skill's Step Definition Rules (e.g. `raise NotImplementedError("TODO: implement step")` for Python)
4. Place in correct file: `common_steps`, `api_steps`, `db_steps`, or `{domain}_steps` — follow the step file placement table from the gherkin skill.
5. If the target step file exists → append. If not → create from language-appropriate template in `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/templates/`.
6. Never mix languages.

## Step 13: Update Indexes

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/generation.md` step 3d — update both `bdd/features/INDEX.md` and `bdd/steps/INDEX.md` together. Never leave partial index state.

## Step 14: Splitting Check

Read `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/splitting.md`. If the scenario count in the target feature file exceeds 15, run the splitting procedure.

## Step 15: Update Scenario Headings and UC Status

1. For each new scenario appended to the UC file, add a `pending` annotation to the heading:
   ```
   ### SC-XXXX: {Scenario Name} `pending`
   ```
2. Do not change the UC's YAML frontmatter `status` — it transitions to `implemented` only after build completes and BDD tests pass.
3. Only increment the `version` (already done in Step 7).

## Step 16: Report

Tell the user what was created:

- Scenarios appended to `prd/domains/{domain}/features/FEAT-XXXX/use-cases/UC-XXXX.md` (list SC-XXXX IDs and names)
- ARCHITECTURE.md Code Map entries added
- Feature file path + scenario count
- Step definition file(s) + new/reused step counts
- Updated INDEX.md files
- UC status change (if any)

Suggest next steps:
- "Use `/m:reverse-scenario UC-XXXX <description>` to extract more scenarios from code."
- "Use `/m:scenario UC-XXXX` to generate Gherkin from manually authored scenarios."
- "Use `/m:plan UC-XXXX` to generate an implementation plan."
