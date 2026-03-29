---
description: Create or update features, use cases, and scenarios from free-form natural language
model: claude-opus-4-6
argument-hint: <freeform spec description>
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

# Spec Command

You are the broadest spec-authoring command. Unlike the granular commands (`feature`, `usecase`, `scenario`) which operate on a single entity, you take free-form natural language and orchestrate creation or update of features, use cases, and Gherkin scenarios — potentially spanning multiple entities in a single invocation.

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response. This keeps you in control of the conversation flow.

## Step 1: Load Skills

Read all four authoring skills since this command can touch any layer:

1. `${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/SKILL.md` — EARS syntax, Fit Criteria, feature interview
2. `${CLAUDE_PLUGIN_ROOT}/plan/skills/usecase-authoring/SKILL.md` — flat scenario structure, UC interview
3. `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` — Gherkin generation, tagging, scaffold, indexes
4. `${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/SKILL.md` — ID generation rules

Follow these skills' rules for all subsequent steps.

## Step 2: Verify Prerequisites

Check that `prd/PROJECT.md` and `prd/FEATURES.md` both exist.

If either is missing, tell the user:

"Project foundation not found. Run `/m:setup` first to create PROJECT.md and FEATURES.md."

Then stop. Do not proceed.

## Step 3: Load Full Project Context

Read all project-level files and every existing feature's specs. This is the key difference from granular commands — spec needs the full PRD picture.

**Project-level files:**
- `prd/PROJECT.md` — project description (required)
- `prd/TECH-STACK.md` — technology choices (if exists)
- `prd/ACTORS.md` — system actors (if exists)
- `prd/FEATURES.md` — existing features (required)

**Per-feature files:** For every feature listed in FEATURES.md, read:
- `prd/features/FEAT-XXXX/REQUIREMENTS.md`
- `prd/features/FEAT-XXXX/USE-CASES.md`

For large projects with many features, use Agent sub-agents to parallelize reading.

## Step 4: Collect Input

If `$ARGUMENTS` is not empty, use it as the free-form input.

If `$ARGUMENTS` is empty, use AskUserQuestion:
- Question: "Describe what you want to spec out. You can mention new features, new use cases for existing features, changes to existing features, or any combination.\n\n**Examples:**\n- \"Add user authentication with email/password login and OAuth support\"\n- \"Add a password reset flow to FEAT-0S9A and create a new audit logging feature\"\n- \"Update the checkout feature to support gift cards and add a returns workflow\""
- Header: "Spec Input"

## Step 5: Analyze and Classify

Parse the free-form text against the loaded PRD context. Classify each entity the user described into one of these categories:

| Category | Trigger | Action |
|----------|---------|--------|
| **New Feature** | Describes capability not covered by any existing feature | Create feature dir + REQUIREMENTS.md + USE-CASES.md + ARCHITECTURE.md, add FEATURES.md row |
| **New Use Case** | Describes a workflow belonging to an existing feature | Create UC file in existing feature, add row to USE-CASES.md |
| **Modified Feature** | Adds or changes requirements of an existing feature | Update REQUIREMENTS.md (new FRs, NFRs, acceptance criteria) |
| **Modified Use Case** | Adds or changes scenarios in an existing UC | Update UC file (new/changed scenarios), increment version, set status to dirty |

For each entity, extract as much structured content as possible:

**New Features:** name, non-goals, actors, functional requirements (EARS syntax), non-functional requirements, acceptance criteria, potential use cases.

**New Use Cases:** name, objective, primary actor, preconditions, trigger, scenarios (Given/Steps/Outcomes/Side Effects).

**Modified Features:** which FEAT-XXXX, what changes to REQUIREMENTS.md.

**Modified Use Cases:** which UC-XXXX, new or changed scenarios.

## Step 6: Present Spec Plan

Use a single AskUserQuestion to show the full picture before any changes:

- Question: Format as a structured plan showing:
  - **New Features** — list with name and one-line description each
  - **New Use Cases** — list with parent feature, name, and one-line description each
  - **Modified Features** — list with FEAT-XXXX and summary of changes
  - **Modified Use Cases** — list with UC-XXXX and summary of changes
  - **Gherkin Generation** — which UCs will get .feature files generated

  Only include sections that have entries.

- Header: "Spec Plan"
- Options: "Yes, proceed" / "Edit plan" / "Cancel"

If the user selects "Edit plan", use AskUserQuestion to collect corrections and re-present the plan.

If the user selects "Cancel", stop.

## Step 7: Streamlined Interviews

For each entity in the spec plan, present a consolidated review. Unlike the granular commands which go section-by-section, spec presents all sections at once since the user already provided substantial context.

### 7.1 New Features

For each new feature, present all sections in one view via AskUserQuestion:

- Question: "**New Feature: {name}**\n\n**Non-Goals:**\n{non_goals or 'None identified'}\n\n**Actors:**\n{actors}\n\n**Functional Requirements (EARS):**\n{requirements}\n\n**Non-Functional Requirements:**\n{nfrs or 'None identified'}\n\n**Acceptance Criteria:**\n{acceptance}\n\nDoes this look correct?"
- Header: "Feature: {name}"
- Options: "Looks good" / "Edit" (user specifies which section to change via Other)

If the user selects "Edit", ask which section to change, collect the correction, and re-present the full view.

### 7.2 New Use Cases

For each new use case, present all sections in one view via AskUserQuestion:

- Question: "**New Use Case: {name}**\nParent feature: {FEAT-XXXX}\n\n**Objective:** {objective}\n\n**Actor:** {actor}\n\n**Preconditions:**\n{preconditions}\n\n**Trigger:** {trigger}\n\n**Scenarios:**\n{for each scenario:\n  **Scenario: {name}**\n  Given: {given}\n  Steps: {steps}\n  Outcomes: {outcomes}\n  Side Effects: {side_effects}\n}\n\nDoes this look correct?"
- Header: "Use Case: {name}"
- Options: "Looks good" / "Edit" (user specifies what to change via Other)

If the user selects "Edit", collect the correction and re-present. After confirmation, ask:

- Question: "Would you like to add another scenario to this use case?"
- Header: "More Scenarios?"
- Options: "Yes, I'll describe one" (user provides via Other) / "No, that's all"

### 7.3 Modified Features

For each modified feature, present a diff-style view via AskUserQuestion:

- Question: "**Updating: {FEAT-XXXX} — {feature name}**\n\n**Changes to REQUIREMENTS.md:**\n{diff-style showing additions/changes}\n\nDoes this look correct?"
- Header: "Update: {FEAT-XXXX}"
- Options: "Looks good" / "Edit" (user specifies what to change via Other)

### 7.4 Modified Use Cases

For each modified use case, present a diff-style view via AskUserQuestion:

- Question: "**Updating: {UC-XXXX} — {use case name}**\n\n**Changes:**\n{new/changed scenarios shown diff-style}\n\nVersion will increment from {N} to {N+1}. Status will be set to dirty.\n\nDoes this look correct?"
- Header: "Update: {UC-XXXX}"
- Options: "Looks good" / "Edit" (user specifies what to change via Other)

## Step 8: Generate IDs

After all interviews are confirmed, count the total number of new IDs needed (features + use cases + scenarios) and batch-generate them:

```bash
node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js {total_count}
```

Assign prefixes from the output lines in order:
- `FEAT-` for new features
- `UC-` for new use cases
- `SC-` for new scenarios

## Step 9: Write PRD Documents

Write in dependency order so that parent structures exist before children.

### 9.1 New Features

For each new feature:

1. Create the directory structure:
   ```bash
   mkdir -p prd/features/FEAT-XXXX/use-cases
   ```

2. Read `${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/templates/REQUIREMENTS-template.md`
   Write `prd/features/FEAT-XXXX/REQUIREMENTS.md` filled with confirmed content. Follow section order from the skill: name + objective, Non-Goals, Actors, UI (only if provided), Functional Requirements (EARS + Fit Criteria), Non-Functional Requirements, Acceptance.

3. Read `${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/templates/USE-CASES-template.md`
   Write `prd/features/FEAT-XXXX/USE-CASES.md` with an empty use case table.

4. Read `${CLAUDE_PLUGIN_ROOT}/plan/skills/architecture/templates/ARCHITECTURE-template.md`
   Write `prd/features/FEAT-XXXX/ARCHITECTURE.md` scaffold.

5. Edit `prd/FEATURES.md` — add a new row:
   ```
   | FEAT-XXXX | {Feature Name} | {One-sentence description} | pending | @FEAT-XXXX | [features/FEAT-XXXX/](features/FEAT-XXXX/) |
   ```

### 9.2 Modified Features

For each modified feature:
- Edit `prd/features/FEAT-XXXX/REQUIREMENTS.md` with the confirmed changes (new FRs, NFRs, acceptance criteria).

**Dirty Cascade:** If the feature's current status in FEATURES.md is `implemented`, cascade `dirty` status:

1. Set the feature's status to `dirty` in `prd/FEATURES.md`.
2. Read `prd/features/FEAT-XXXX/USE-CASES.md`. For each UC with status `implemented`:
   - Set the UC's status to `dirty` in USE-CASES.md.
   - Edit the UC file's YAML frontmatter: set `status` to `dirty`.
   - Set all scenario heading annotations in the UC file to `dirty`:
     ```
     ### SC-XXXX: {Scenario Name} `dirty`
     ```

If the feature's current status is `pending`, do not cascade — the feature hasn't been implemented yet so there's nothing to mark dirty.

### 9.3 New Use Cases

For each new use case:

1. Read `${CLAUDE_PLUGIN_ROOT}/plan/skills/usecase-authoring/templates/UC-template.md`

2. Write `prd/features/FEAT-XXXX/use-cases/UC-XXXX.md` with:
   - YAML frontmatter: id (UC-XXXX), name, feature (FEAT-XXXX), status (pending), version (1), actor, tag (@UC-XXXX)
   - Title: `# UC-XXXX: {Use Case Name}`
   - Objective blockquote
   - Preconditions section
   - Trigger section
   - Gherkin Tags: `@FEAT-XXXX @UC-XXXX`
   - All confirmed scenarios in flat structure — each scenario preceded and followed by a `---` horizontal rule (including after the last scenario), each with SC-XXXX ID, Given/Steps/Outcomes/Side Effects. Each scenario heading must include a `pending` status annotation: `### SC-XXXX: {Scenario Name} \`pending\``

3. Add a new row to `prd/features/FEAT-XXXX/USE-CASES.md`:
   ```
   | UC-XXXX | {Use Case Name} | {One-sentence description} | pending | [UC-XXXX.md](use-cases/UC-XXXX.md) |
   ```

### 9.4 Modified Use Cases

For each modified use case:
- Edit the UC file with new/changed scenarios.
- Increment `version` in YAML frontmatter.
- Set `status` to `dirty` in YAML frontmatter.
- Update the corresponding row in `prd/features/FEAT-XXXX/USE-CASES.md` (status column to `dirty`).

## Step 10: Gherkin Generation

For each **new** use case that has scenarios, generate Gherkin files (Steps 10.1–10.7).

For each **modified** use case, propagate Gherkin changes instead (Step 10.8).

### 10.1 Scaffold Setup (once)

Run the scaffold procedure from `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/scaffold.md` (steps 2a–2h):
- Check for existing scaffold, create if missing
- Detect domains, language, format
- Create INDEX.md files and world module
- Persist BDD settings to `.molcajete/settings.json`
- Validate existing indexes, rebuild if drift detected

### 10.2 Domain Selection

Infer domains from each feature's subject area. Check existing domain folders under `bdd/features/`.

Use a single AskUserQuestion for all features at once:
- Question: "Which domain folder should each feature's Gherkin go in?\n\n{for each feature: **{FEAT-XXXX}: {name}** → Inferred: {inferred domain}}\n\nExisting domains: {list of existing domain folders}"
- Header: "Domains"
- Options: "Looks good" / "Edit" (user corrects via Other)

### 10.3 Generate Feature Files

For each UC with scenarios, follow `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/generation.md`:

1. **Dedup** — Grep `bdd/features/` for `@FEAT-XXXX` tag. Skip exact duplicate scenarios, warn on near-duplicates.
2. **Construct** — Build .feature file content using the Gherkin Mapping table from the usecase-authoring skill.
3. **Write** — Write to `bdd/features/{domain}/{feature-name}.feature` (kebab-case). If appending to an existing file, use Edit to append new scenarios.

### 10.4 Generate Step Stubs

For each step in the generated feature files:
1. Read `bdd/steps/INDEX.md` for existing reusable patterns.
2. Check for existing match → reuse. Otherwise create new stub with:
   - Docstring describing what the step does
   - Parameter descriptions with types
   - `TODO: implement step` placeholder body
3. Place in correct file: `common_steps`, `api_steps`, `db_steps`, or `{domain}_steps`.
4. If the target step file exists → append. If not → create from language-appropriate template in `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/templates/`.

### 10.5 Update Indexes

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/references/generation.md` step 3d — update both `bdd/features/INDEX.md` and `bdd/steps/INDEX.md` together. Never leave partial index state.

### 10.6 Gherkin Preview

Use AskUserQuestion to show a summary of generated Gherkin:
- Question: "**Generated Gherkin:**\n\n{for each feature file: file path, scenario count, tag summary}\n\nWould you like to see the full content of any file?"
- Header: "Gherkin Summary"
- Options: "Looks good" / "Show full content" / "Edit" (user corrects via Other)

If the user selects "Show full content", display the full Gherkin via AskUserQuestion and ask for confirmation.

### 10.7 Update Scenario Headings

For each use case that received Gherkin generation:
1. Add a `pending` status annotation to each scenario heading line in the UC file:
   ```
   ### SC-XXXX: {Scenario Name} `pending`
   ```
   Gherkin files stay clean — no status tags in `.feature` files.
2. The UC file's YAML frontmatter `status` stays as-is (`pending`). Do not change it.
3. Do not change the USE-CASES.md status column.

### 10.8 Gherkin Propagation (Modified UCs)

For each modified use case, propagate changes to existing Gherkin files. Skip this step for new use cases (they were handled in 10.3).

Grep `bdd/features/` for `@UC-XXXX`. If no `.feature` file contains this tag, treat as a new UC and follow Steps 10.3–10.7 for it instead.

If a `.feature` file exists with `@UC-XXXX`:

#### 10.8.1 Determine Gherkin Changes

Based on the spec changes applied in Step 9.4, determine what Gherkin changes are needed:

- **Preconditions changed** — update the `Background:` block (Given/And clauses)
- **Scenario Given changed** — update `Given`/`And` clauses in the matching `@SC-XXXX` scenario
- **Scenario Steps changed** — update `When`/`And` clauses in the matching `@SC-XXXX` scenario
- **Scenario Outcomes changed** — update `Then`/`And` clauses in the matching `@SC-XXXX` scenario
- **Scenario Side Effects changed** — update trailing `And`/`And no` clauses in the matching `@SC-XXXX` scenario
- **New scenarios added** — append new scenario blocks with the new `@SC-XXXX` tags
- **Step text changed** — find and update matching step definitions (check `bdd/steps/INDEX.md` or grep step definition files)

#### 10.8.2 Preview Gherkin Changes

Use AskUserQuestion to preview the Gherkin changes:
- Question: "The following Gherkin changes are needed to match the updated spec:\n\n**{feature-file-path}:**\n{describe each change — before/after for modified blocks, full content for new scenarios}\n\n{if step definitions changed}**Step definitions:**\n{list step text changes}{/if}\n\nDoes this look correct?"
- Header: "Gherkin Changes"
- Options: "Yes, apply these changes" / "Edit" (user corrects via Other)

If the user wants edits, revise and present again.

#### 10.8.3 Apply Gherkin Changes

1. Edit the `.feature` file with the confirmed changes.
2. If step definitions changed, edit the corresponding step definition files.
3. If new step definitions are needed, append them to the appropriate step file following the gherkin skill's step file placement rules.
4. Update `bdd/features/INDEX.md` and `bdd/steps/INDEX.md` if new scenarios or steps were added.

## Step 11: Report

Tell the user a structured summary of everything created and updated:

**Created:**
- New features (FEAT-XXXX) with file paths
- New use cases (UC-XXXX) with file paths
- New .feature files with scenario counts
- New step definition stubs with file paths

**Updated:**
- Modified features (FEAT-XXXX) with change summary
- Modified use cases (UC-XXXX) with change summary
- Updated FEATURES.md rows
- Updated USE-CASES.md rows
- Updated INDEX.md files

**Status Changes:**
- Scenario headings annotated with `pending`
- Modified UCs set to `dirty`

Suggest next steps based on what was created:
- If new features without UCs: "Use `/m:usecase FEAT-XXXX` or `/m:spec` to add use cases."
- If new UCs without Gherkin: "Use `/m:scenario UC-XXXX` to generate Gherkin."
- If everything is specified: "Use `/m:plan UC-XXXX` to generate implementation plans."
