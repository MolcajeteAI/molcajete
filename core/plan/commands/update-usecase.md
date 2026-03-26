---
description: Update an existing use case and propagate changes to Gherkin
model: claude-opus-4-6
argument-hint: <UC-XXXX> <change description>
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

# Update Use Case

You are updating an existing use case based on a change description. You will load the current spec, propose specific changes, apply after confirmation, bump the version, and propagate changes to any existing Gherkin files.

**Input:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Load Skills

Read both skills that govern this command:

1. Read `${CLAUDE_PLUGIN_ROOT}/plan/skills/usecase-authoring/SKILL.md` -- update mode rules, flat scenario structure, Side Effects conventions
2. Read `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` -- generation rules, tagging, step writing

Follow the usecase-authoring skill's Update Mode rules: propose specific changes, do NOT run the creation interview, do NOT change the UC ID or tag.

## Step 2: Parse Arguments

Parse `$ARGUMENTS` into two parts:

1. **Use case ID** -- the first token, expected format `UC-XXXX`
2. **Change description** -- everything after the use case ID

If `$ARGUMENTS` is empty or does not start with a `UC-` token, tell the user:

"Usage: `/m:update-usecase UC-XXXX <change description>`. Provide a valid use case ID and describe what to change."

Then stop.

If the change description is empty (only a UC ID was provided), use AskUserQuestion:
- Question: "What changes do you want to make to {UC-XXXX}? Describe what should be added, removed, or modified in the use case."
- Header: "Change Description"

## Step 3: Verify Use Case Exists

1. Glob `prd/features/*/use-cases/UC-XXXX.md` (substituting the actual ID) to find the UC file. If not found, tell the user:

   "Use case {UC-XXXX} not found. Check the ID and try again."

   Then stop.

2. Extract the parent `FEAT-XXXX` from the path (the directory name under `prd/features/`).

3. Verify `prd/FEATURES.md` exists. If missing, tell the user:

   "Run `/m:setup` first -- FEATURES.md is required."

   Then stop.

4. Verify FEAT-XXXX exists in `prd/FEATURES.md`. If not found, tell the user:

   "Feature {FEAT-XXXX} not found in FEATURES.md. Check the ID and try again."

   Then stop.

## Step 4: Load Context

Read these files to understand the current state:

- `prd/PROJECT.md` -- project description
- `prd/TECH-STACK.md` -- technology choices (if exists)
- `prd/ACTORS.md` -- known actors (if exists)
- `prd/features/FEAT-XXXX/REQUIREMENTS.md` -- feature requirements
- `prd/features/FEAT-XXXX/ARCHITECTURE.md` -- architecture context (if exists)
- `prd/features/FEAT-XXXX/use-cases/UC-XXXX.md` -- the target use case
- `prd/features/FEAT-XXXX/USE-CASES.md` -- use case index

## Step 5: Analyze and Propose Changes

Compare the change description against the current UC file content.

Determine what sections need to change:
- Objective
- Preconditions
- Trigger
- Existing scenarios (Given, Steps, Outcomes, Side Effects)
- New scenarios to add

Use AskUserQuestion to present the proposed changes:
- Question: "Here's what I'd change in **{UC-XXXX}**:\n\n{describe each change -- what's added, modified, or removed, showing before/after for modifications}\n\nDoes this look correct?"
- Header: "Proposed Changes"
- Options: "Yes, apply these changes" / "Edit" (user corrects via Other)

If the user wants edits, revise the proposal and present again via AskUserQuestion.

## Step 6: Apply Spec Changes

Apply the confirmed changes to the UC file:

1. Edit `prd/features/FEAT-XXXX/use-cases/UC-XXXX.md` with the confirmed changes.

2. Increment the `version` field in the YAML frontmatter.

3. Set `status` to `dirty` in the YAML frontmatter.

4. Update the status column in `prd/features/FEAT-XXXX/USE-CASES.md` to `dirty` for this UC row.

5. Do NOT change the UC-XXXX ID or tag.

6. If new scenarios were added, generate SC IDs for them:

```bash
node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js N
```

Prepend `SC-` to each output line.

## Step 7: Gherkin Propagation

Grep `bdd/features/` for `@UC-XXXX`. If no `.feature` file contains this tag, skip to Step 8.

If a `.feature` file exists with `@UC-XXXX`:

### 7.1 Determine Gherkin Changes

Based on the spec changes applied in Step 6, determine what Gherkin changes are needed:

- **Preconditions changed** -- update the `Background:` block (Given/And clauses)
- **Scenario Given changed** -- update `Given`/`And` clauses in the matching `@SC-XXXX` scenario
- **Scenario Steps changed** -- update `When`/`And` clauses in the matching `@SC-XXXX` scenario
- **Scenario Outcomes changed** -- update `Then`/`And` clauses in the matching `@SC-XXXX` scenario
- **Scenario Side Effects changed** -- update trailing `And`/`And no` clauses in the matching `@SC-XXXX` scenario
- **New scenarios added** -- append new scenario blocks with the new `@SC-XXXX` tags
- **Step text changed** -- find and update matching step definitions (check `bdd/steps/INDEX.md` or grep step definition files)

### 7.2 Preview Gherkin Changes

Use AskUserQuestion to preview the Gherkin changes:
- Question: "The following Gherkin changes are needed to match the updated spec:\n\n**{feature-file-path}:**\n{describe each change -- before/after for modified blocks, full content for new scenarios}\n\n{if step definitions changed}**Step definitions:**\n{list step text changes}{/if}\n\nDoes this look correct?"
- Header: "Gherkin Changes"
- Options: "Yes, apply these changes" / "Edit" (user corrects via Other)

If the user wants edits, revise and present again.

### 7.3 Apply Gherkin Changes

1. Edit the `.feature` file with the confirmed changes.
2. If step definitions changed, edit the corresponding step definition files.
3. If new step definitions are needed, append them to the appropriate step file following the gherkin skill's step file placement rules.
4. Update `bdd/features/INDEX.md` and `bdd/steps/INDEX.md` if new scenarios or steps were added.

## Step 8: Report

Tell the user what changed:

- List each spec file that was modified and summarize the changes
- Note the version bump (e.g., "version: 1 -> 2") and status change to `dirty`
- If Gherkin was updated, list the Gherkin files modified and summarize changes
- If Gherkin was NOT updated (no existing feature file), note: "No existing Gherkin files found for this UC. Run `/m:scenario UC-XXXX` to generate Gherkin when ready."
