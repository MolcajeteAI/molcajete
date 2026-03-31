---
description: Update an existing scenario within a use case and propagate changes to Gherkin
model: claude-opus-4-6
argument-hint: <SC-XXXX> <change description>
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

# Update Scenario

You are updating an existing scenario within a use case based on a change description. You will locate the scenario, propose specific changes, apply after confirmation, bump the UC version, and propagate changes to any existing Gherkin files.

**Input:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Load Skills

Read both skills that govern this command:

1. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/usecase-authoring/SKILL.md` -- flat scenario structure, Side Effects conventions, update mode rules
2. Read `${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md` -- generation rules, tagging, step writing

## Step 2: Parse Arguments

Parse `$ARGUMENTS` into two parts:

1. **Scenario ID** -- the first token, expected format `SC-XXXX`
2. **Change description** -- everything after the scenario ID

If `$ARGUMENTS` is empty or does not start with an `SC-` token, tell the user:

"Usage: `/m:update-scenario SC-XXXX <change description>`. Provide a valid scenario ID and describe what to change."

Then stop.

If the change description is empty (only an SC ID was provided), use AskUserQuestion:
- Question: "What changes do you want to make to {SC-XXXX}? Describe what should be added, removed, or modified in the scenario."
- Header: "Change Description"

## Step 3: Locate Scenario

1. Grep `prd/domains/*/features/*/use-cases/*.md` for the heading pattern `### SC-XXXX:` (substituting the actual ID). If not found, tell the user:

   "Scenario {SC-XXXX} not found in any use case file. Check the ID and try again."

   Then stop.

2. Extract the UC file path from the grep result.

3. Extract the parent `UC-XXXX` from the filename (e.g., `UC-0S9A.md` -> `UC-0S9A`).

4. Extract the parent `FEAT-XXXX` from the directory path (under `features/`) and the domain from the path (under `prd/domains/`).

5. Verify `prd/FEATURES.md` exists and FEAT-XXXX is listed. If either check fails, tell the user and stop.

## Step 4: Load Context

Read these files to understand the current state:

- `prd/PROJECT.md` -- project description
- `prd/TECH-STACK.md` -- technology choices (if exists)
- `prd/ACTORS.md` -- known actors (if exists)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md` -- feature requirements
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` -- architecture context (if exists)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/UC-XXXX-{slug}.md` -- the use case containing this scenario

## Step 5: Analyze and Propose Changes

Read the full UC file and locate the `### SC-XXXX:` block. Extract the current scenario content:
- Given
- Steps
- Outcomes
- Side Effects

Compare the change description against the current scenario content.

Use AskUserQuestion to present the proposed changes:
- Question: "Here's what I'd change in **SC-XXXX** (within {UC-XXXX}):\n\n{describe each change -- what's added, modified, or removed in the scenario, showing before/after for modifications}\n\nDoes this look correct?"
- Header: "Proposed Changes"
- Options: "Yes, apply these changes" / "Edit" (user corrects via Other)

If the user wants edits, revise the proposal and present again via AskUserQuestion.

## Step 6: Apply Spec Changes

Apply the confirmed changes to the scenario within the UC file:

1. Edit `prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases/UC-XXXX-{slug}.md` -- modify only the `### SC-XXXX:` block with confirmed changes.

2. Set the scenario heading annotation to `dirty`:
   ```
   ### SC-XXXX: {Scenario Name} `dirty`
   ```

3. Increment the `version` field in the UC file's YAML frontmatter.

4. Set `status` to `dirty` in the UC file's YAML frontmatter.

5. Update the status column in `prd/domains/{domain}/features/FEAT-XXXX-{slug}/USE-CASES.md` to `dirty` for this UC row.

6. Do NOT change the SC-XXXX ID, UC-XXXX ID, or any tags.

## Step 7: Gherkin Propagation

Grep `bdd/features/` for `@SC-XXXX`. If no `.feature` file contains this tag, skip to Step 8.

If a `.feature` file exists with `@SC-XXXX`:

### 7.1 Determine Gherkin Changes

Based on the spec changes applied in Step 6, determine what Gherkin changes are needed for the matching scenario block:

- **Given changed** -- update `Given`/`And` clauses
- **Steps changed** -- update `When`/`And` clauses
- **Outcomes changed** -- update `Then`/`And` clauses
- **Side Effects changed** -- update trailing `And`/`And no` clauses
- **Step text changed** -- find and update matching step definitions (check `bdd/steps/INDEX.md` or grep step definition files)

### 7.2 Preview Gherkin Changes

Use AskUserQuestion to preview the Gherkin changes:
- Question: "The following Gherkin changes are needed to match the updated scenario:\n\n**{feature-file-path}:**\n\n```gherkin\n# Before:\n{current scenario block}\n\n# After:\n{updated scenario block}\n```\n\n{if step definitions changed}\n**Step definitions:**\n{list step text changes}\n{/if}\n\nDoes this look correct?"
- Header: "Gherkin Changes"
- Options: "Yes, apply these changes" / "Edit" (user corrects via Other)

If the user wants edits, revise and present again.

### 7.3 Apply Gherkin Changes

1. Edit the `.feature` file -- update only the `@SC-XXXX` scenario block with the confirmed changes.
2. If step definitions changed, edit the corresponding step definition files.
3. If new step definitions are needed, append them to the appropriate step file following the gherkin skill's step file placement rules.
4. Update `bdd/steps/INDEX.md` if new steps were added.

## Step 8: Report

Tell the user what changed:

- Summarize the scenario changes applied to the UC file
- Note the UC version bump (e.g., "version: 1 -> 2") and status change to `dirty`
- If Gherkin was updated, list the Gherkin files modified and summarize changes
- If Gherkin was NOT updated (no existing feature file), note: "No existing Gherkin for this scenario. Run `/m:scenario UC-XXXX` to generate Gherkin when ready."
