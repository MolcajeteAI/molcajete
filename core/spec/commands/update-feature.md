---
description: Update an existing feature's requirements or architecture
model: claude-opus-4-6
argument-hint: <FEAT-XXXX> <change description>
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

# Update Feature

You are updating an existing feature's requirements or architecture based on a change description. You will load the current spec, propose specific changes, and apply after confirmation.

**Input:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Load Skill

Read the feature-authoring skill for EARS syntax rules, Fit Criteria format, and update mode rules:

```
Read: ${CLAUDE_PLUGIN_ROOT}/spec/skills/feature-authoring/SKILL.md
```

Follow the skill's Update Mode rules: propose specific changes, do NOT run the creation interview, do NOT change lifecycle status.

## Step 2: Parse Arguments

Parse `$ARGUMENTS` into two parts:

1. **Feature ID** — the first token, expected format `FEAT-XXXX`
2. **Change description** — everything after the feature ID

If `$ARGUMENTS` is empty or does not start with a `FEAT-` token, tell the user:

"Usage: `/m:update-feature FEAT-XXXX <change description>`. Provide a valid feature ID and describe what to change."

Then stop.

If the change description is empty (only a FEAT ID was provided), use AskUserQuestion:
- Question: "What changes do you want to make to {FEAT-XXXX}? Describe what should be added, removed, or modified in the feature's requirements or architecture."
- Header: "Change Description"

## Step 3: Verify Feature Exists

1. Check that `prd/DOMAINS.md` exists. If missing, tell the user:

   "Run `/m:setup` first -- DOMAINS.md is required."

   Then stop.

2. Glob `prd/domains/*/features/FEAT-XXXX-*/` to find the feature directory and extract the domain from the path. If not found, tell the user:

   "Feature {FEAT-XXXX} not found. Check the ID and try again."

   Then stop.

3. Verify that `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md` exists. If missing, tell the user:

   "REQUIREMENTS.md not found for {FEAT-XXXX}. The feature directory may be incomplete."

   Then stop.

## Step 4: Detect Global Scope

After resolving the feature's domain:

### If the target feature is global (domain is `global`)

This change may affect every real domain. Read `prd/FEATURES.md` and collect all domain features whose `Refs` column includes this FEAT-XXXX. These are the **dependent domain features**.

Use AskUserQuestion:
- Question: "**{FEAT-XXXX}** is a global feature. Changes here affect all domains that reference it.\n\n**Dependent domain features:**\n{list each dependent feature: FEAT-YYYY ({domain}) — {name}}\n\nHow should this change be scoped?"
- Header: "Global Scope"
- Options:
  - "Apply globally — update the global feature and dirty-cascade all dependent domain features"
  - "Apply globally but let me review domain impact first"
  - "Cancel — I meant to update a domain feature instead"

If "Cancel", stop.

Record the dependent domain features for use in Step 8 (Dirty Cascade).

### If the target feature is a domain feature with refs

Read the feature's REQUIREMENTS.md frontmatter. If `refs` is non-empty, load each referenced global feature's REQUIREMENTS.md for context — the domain feature's requirements may build on or override global requirements.

## Step 5: Load Context

Read these files to understand the current state:

- `prd/PROJECT.md` -- project description
- `prd/TECH-STACK.md` -- technology choices (if exists)
- `prd/ACTORS.md` -- system actors (if exists)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md` -- current feature requirements
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` -- current architecture (if exists)

If the target is a global feature, also load each dependent domain feature's REQUIREMENTS.md to understand how domains currently consume the global baseline.

If the target is a domain feature with refs, also load the referenced global feature's REQUIREMENTS.md for baseline context.

## Step 6: Analyze and Propose Changes

Compare the change description against the current REQUIREMENTS.md (and ARCHITECTURE.md if relevant).

Determine what sections need to change:
- Functional requirements (additions, modifications, removals)
- Non-functional requirements
- Non-goals
- Actors
- Acceptance criteria
- Architecture changes (if the change affects system design)

Use AskUserQuestion to present the proposed changes:
- Question: "Here's what I'd change in **{FEAT-XXXX}**:\n\n**REQUIREMENTS.md:**\n{describe each change — what's added, modified, or removed, showing before/after for modifications}\n\n{if architecture changes}**ARCHITECTURE.md:**\n{describe architecture changes}{/if}\n\nDoes this look correct?"
- Header: "Proposed Changes"
- Options: "Yes, apply these changes" / "Edit" (user corrects via Other)

If the user wants edits, revise the proposal and present again via AskUserQuestion.

## Step 7: Apply Changes

Apply the confirmed changes:

1. Edit `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md` with the confirmed requirement changes. Follow EARS syntax and Fit Criteria format from the skill.

2. If architecture changes were confirmed, edit `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md`.

3. Do NOT change the FEAT ID or tag.

## Step 8: Dirty Cascade

### Standard cascade (domain features)

If the feature's current status in FEATURES.md is `implemented`, cascade `dirty` status:

1. Set the feature's status to `dirty` in `prd/FEATURES.md`.

2. Read `prd/domains/{domain}/features/FEAT-XXXX-{slug}/USE-CASES.md`. For each UC with status `implemented`:
   - Set the UC's status to `dirty` in USE-CASES.md.
   - Edit the UC file's YAML frontmatter: set `status` to `dirty`.
   - Set all scenario heading annotations in the UC file to `dirty`:
     ```
     ### SC-XXXX: {Scenario Name} `dirty`
     ```
   - Propagate `@dirty` to Gherkin files: For each scenario heading set to `dirty`, grep `bdd/features/` for `@SC-XXXX`. If found, add `@dirty` to the scenario's tag line in the `.feature` file. Remove `@pending` if present.

If the feature's current status is `pending`, do not cascade — the feature hasn't been implemented yet so there's nothing to mark dirty.

### Cross-domain cascade (global features)

If the target feature is global and dependent domain features were identified in Step 4:

For each dependent domain feature (FEAT-YYYY in domain {D}):

1. If FEAT-YYYY's status in `prd/FEATURES.md` is `implemented`, set it to `dirty`.
2. Read `prd/domains/{D}/features/FEAT-YYYY-{slug}/USE-CASES.md`. For each UC with status `implemented`:
   - Set the UC's status to `dirty` in USE-CASES.md.
   - Edit the UC file's YAML frontmatter: set `status` to `dirty`.
   - Set all scenario heading annotations in the UC file to `dirty`.
   - Propagate `@dirty` to Gherkin files: For each scenario heading set to `dirty`, grep `bdd/features/` for `@SC-XXXX`. If found, add `@dirty` to the scenario's tag line in the `.feature` file. Remove `@pending` if present.

This ensures that a change to a global feature propagates dirty status to every domain that consumes it via refs.

## Step 9: Report

Tell the user what changed:

- List each file that was modified
- Summarize the changes applied
- If dirty cascade was triggered: list the feature, UCs, and scenarios that were set to `dirty`
- If cross-domain cascade was triggered: list each affected domain feature and its dirty UCs/scenarios
- Note: "Use `/m:update-usecase UC-XXXX <description>` to refine individual use cases if needed."
