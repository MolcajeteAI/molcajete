---
description: Create a new use case with flat scenario structure via creation interview
model: claude-opus-4-6
argument-hint: <FEAT-XXXX> <freeform use case description>
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

# Create Use Case

You are creating a new use case for an existing feature. You will extract structured content from the user's freeform input, present shared context and scenarios for review, and generate the UC file with flat scenario structure.

**Use case input:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Load Skill

Read the usecase-authoring skill for flat scenario structure rules, Side Effects conventions, creation interview pattern, and template reference:

```
Read: ${CLAUDE_PLUGIN_ROOT}/plan/skills/usecase-authoring/SKILL.md
```

Follow the skill's rules for all subsequent steps.

## Step 2: Verify Prerequisites

1. Check that `prd/FEATURES.md` exists. If missing, tell the user:

   "Run `/m:setup` first -- FEATURES.md is required before creating use cases."

   Then stop.

2. Parse the first token from `$ARGUMENTS` as the feature ID (expected format: `FEAT-XXXX`).

   If `$ARGUMENTS` is empty or does not start with a `FEAT-` token, tell the user:

   "Usage: `/m:usecase FEAT-XXXX <description>`. Provide a valid feature ID."

   Then stop.

3. Look up the FEAT token in `prd/FEATURES.md`. Match any row whose ID column starts with the provided `FEAT-XXXX`. If not found, tell the user:

   "Feature {FEAT-XXXX} not found in FEATURES.md. Check the ID and try again."

   Then stop.

4. Extract the feature directory path from the matched FEATURES.md row (the link in the last column resolves to `prd/features/FEAT-XXXX/`).

5. Check that the feature's `USE-CASES.md` exists at `prd/features/FEAT-XXXX/USE-CASES.md`. If missing, tell the user:

   "USE-CASES.md is missing for {FEAT-XXXX}. Run `/m:feature` to create the feature structure first."

   Then stop.

## Step 3: Load Project Context

Read these files to understand the project and feature:
- `prd/PROJECT.md` -- what this project is
- `prd/TECH-STACK.md` -- technology context (if exists)
- `prd/ACTORS.md` -- known actors (if exists)
- `prd/features/FEAT-XXXX/REQUIREMENTS.md` -- feature requirements for context
- `prd/features/FEAT-XXXX/USE-CASES.md` -- existing UCs

## Step 4: Extract from Input

The remainder of `$ARGUMENTS` after the FEAT-XXXX token is the freeform description.

If the freeform part is non-empty, analyze the text and extract as much as possible:
- **Use case name** -- a verb-noun goal phrase (e.g., "Create Feature", "Authenticate User")
- **Objective** -- one sentence describing what the actor achieves
- **Primary actor** -- who performs this use case (cross-reference with prd/ACTORS.md)
- **Preconditions** -- shared state that must exist before any scenario
- **Trigger** -- what the actor does or what event kicks this off
- **Scenarios** -- each with Given, Steps, Outcomes, Side Effects

If the freeform part is empty, use AskUserQuestion to prompt the user:

- Question: "Describe the use case you want to create. Use a natural narrative that covers who does what, starting from where, and what happens.\n\n**Pattern:**\n> The {actor} wants to {goal}. They start from {preconditions}. When they {trigger}, the system {steps and outcomes}. This causes {side effects}. No {thing} is sent. If {edge condition}, instead {alternative scenario}.\n\n**Example:**\n> The Customer wants to reset their password. They have a verified email on file. When they click 'Forgot password', the system sends a reset link to their email. The customer opens the link and enters a new password. The system validates the password, updates the credential record, and confirms the change. A `auth.password.reset` event is published. No SMS notification is sent. If the link is expired, the system shows an error and asks them to request a new link."
- Header: "Describe"
- Options: "I'll describe the use case" (user provides via Other)

## Step 5: Creation Interview

Present each section for review via AskUserQuestion, following the usecase-authoring skill's Creation Interview rules. Process sections in this order:

### 5.1 Use Case Name

**If extracted from input:**
Use AskUserQuestion:
- Question: "Use case name: **{extracted name}**\n\nDoes this look correct? The name should be a verb-noun goal phrase (e.g., 'Create Feature', 'Authenticate User')."
- Header: "Name"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

**If NOT found in input:**
Use AskUserQuestion:
- Question: "What should this use case be called? Use a verb-noun goal phrase (e.g., 'Create Feature', 'Authenticate User')."
- Header: "Name"

### 5.2 Objective

**If an objective can be derived from the input** (what the actor achieves):
Use AskUserQuestion:
- Question: "Objective: **{derived objective}**\n\nDoes this one-sentence objective correctly describe what the actor achieves by completing this use case?"
- Header: "Objective"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

**If NOT derivable from input:**
Use AskUserQuestion:
- Question: "What does the actor achieve by completing this use case? Provide a single sentence describing the actor's goal (e.g., 'The developer creates a new feature with structured requirements.')."
- Header: "Objective"

### 5.3 Actor

**If extracted and found in ACTORS.md:**
Use AskUserQuestion:
- Question: "Primary actor: **{extracted actor}**\n\nDoes this look correct?"
- Header: "Actor"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

**If extracted but NOT in ACTORS.md:**
Use AskUserQuestion:
- Question: "The actor '{extracted actor}' is not in ACTORS.md. Known actors:\n\n{actor list from ACTORS.md}\n\nUse '{extracted actor}' anyway, or pick from the list?"
- Header: "Actor"
- Options: "Use '{extracted actor}'" / "Pick from list" (user selects via Other)

**If NOT found in input:**
Use AskUserQuestion:
- Question: "Who is the primary actor for this use case? Known actors from ACTORS.md:\n\n{actor list}\n\nWhich actor performs this use case?"
- Header: "Actor"
- Options: list up to 4 actors from ACTORS.md

### 5.4 Preconditions

**If extracted from input:**
Use AskUserQuestion:
- Question: "Preconditions (shared across all scenarios):\n\n{extracted preconditions as bullet list}\n\nDo these look correct? These map to a Gherkin Background block."
- Header: "Preconditions"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

**If NOT found in input:**
Use AskUserQuestion:
- Question: "What preconditions must be true before any scenario can start? These are shared state requirements (e.g., 'User is authenticated', 'Feature exists in FEATURES.md')."
- Header: "Preconditions"
- Options: "I'll list them" (user provides via Other) / "No preconditions"

### 5.5 Trigger

**If extracted from input:**
Use AskUserQuestion:
- Question: "Trigger: **{extracted trigger}**\n\nDoes this look correct? The trigger is the single action or event that starts the use case."
- Header: "Trigger"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

**If NOT found in input:**
Use AskUserQuestion:
- Question: "What triggers this use case? Describe the single action the actor performs or the event that occurs (e.g., 'User clicks Submit', 'Cron job fires at midnight')."
- Header: "Trigger"

### 5.6 Scenario Review

For each scenario extracted from the input, present the full scenario block via AskUserQuestion:

- Question: "**Scenario {N}: {Name}**\n\n**Given:**\n{given}\n\n**Steps:**\n{steps}\n\n**Outcomes:**\n{outcomes}\n\n**Side Effects:**\n{side_effects}\n\nDoes this look correct?\n\n_Reminder: Include both side effects (events published, DB writes) AND explicit non-side-effects (things that do NOT happen). Non-side-effects become `And no ...` assertions in Gherkin tests._"
- Header: "Scenario"
- Options: "Yes, looks good" / "Edit" (user corrects via Other)

If NO scenarios were extracted from the input, use AskUserQuestion to ask the user to describe the first scenario:
- Question: "Describe the first scenario for this use case. Include what conditions are specific to this scenario (Given), the steps the actor and system take, the expected outcomes, and any side effects.\n\n_Reminder: Include both side effects (events published, DB writes) AND explicit non-side-effects (things that do NOT happen). Non-side-effects become `And no ...` assertions in Gherkin tests._"
- Header: "Scenario"

After reviewing the user's description, structure it into Given/Steps/Outcomes/Side Effects and present for confirmation using AskUserQuestion with the same format as the extracted-scenario case (Header: "Scenario", Options: "Yes, looks good" / "Edit").

**After each scenario is confirmed**, ask about UI for this scenario:

Use AskUserQuestion:
- Question: "Does this scenario have a user interface? If so, describe the screen state at the key step and I'll generate an ASCII art mockup. You can also provide image file paths."
- Header: "UI"
- Options: "I'll describe the UI" (user provides description via Other) / "No UI for this scenario"

If the user describes UI:
1. Generate an ASCII art mockup from their description showing layout, key elements, and hierarchy
2. Present the mockup via AskUserQuestion for confirmation:
   - Question: "Here's the UI mockup for Scenario {N}:\n\n```\n{mockup}\n```\n\nDoes this look correct? Also, which step number should it appear under (indented below that step)?"
   - Header: "UI mockup"
   - Options: "Yes, looks good" / "Edit" (user corrects via Other)
3. Note the confirmed mockup and step number for file generation

If the user provides image file paths, note them for Step 7 (copy to `use-cases/assets/` with `{UC-ID}-{descriptive-slug}.{ext}` naming).

If the user says "No UI for this scenario", skip and proceed to the next scenario or the scenario loop.

### 5.7 Scenario Loop

After all extracted scenarios are reviewed (or the first manual scenario is confirmed), ask:

Use AskUserQuestion:
- Question: "Would you like to add another scenario? (e.g., error cases, edge cases, alternative flows)"
- Header: "More?"
- Options: "Yes, I'll describe one" (user describes via Other) / "No, that's all"

If the user adds a scenario, structure it into Given/Steps/Outcomes/Side Effects, present for confirmation via AskUserQuestion, then ask the UI question (same as Step 5.6 above). After UI is handled, ask the scenario loop question again. Repeat until the user says no.

## Step 6: Assign IDs

After all sections are confirmed, generate the use case ID:

```bash
node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js
```

Prepend `UC-` to the output (e.g., `UC-0S9A`).

Then generate scenario IDs for all confirmed scenarios. If there are N scenarios:

```bash
node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js N
```

Prepend `SC-` to each output line (e.g., `SC-1T4B`, `SC-1T4C`).

## Step 7: Generate Documents

Create the use case directory if it does not exist:

```bash
mkdir -p prd/features/FEAT-XXXX/use-cases
```

If any scenario has image files, also create `prd/features/FEAT-XXXX/use-cases/assets/` and copy images with `{UC-ID}-{descriptive-slug}.{ext}` naming (lowercase, hyphens).

Then read the template and generate the UC file:

1. Read `${CLAUDE_PLUGIN_ROOT}/plan/skills/usecase-authoring/templates/UC-template.md`

2. Write `prd/features/FEAT-XXXX/use-cases/UC-XXXX.md` with:
   - YAML frontmatter: id (UC-XXXX), name, feature (FEAT-XXXX), status (pending), version (1), actor, tag (@UC-XXXX)
   - Title: `# UC-XXXX: {Use Case Name}`
   - Objective blockquote
   - Preconditions section
   - Trigger section
   - Gherkin Tags: `@FEAT-XXXX @UC-XXXX`
   - All confirmed scenarios in flat structure -- each scenario preceded and followed by a `---` horizontal rule (including after the last scenario), each with SC-XXXX ID, Given/Steps/Outcomes/Side Effects
   - For scenarios with UI: include inline `**UI:**` blocks within Steps, indented under the confirmed step number. Use fenced code blocks for ASCII art or `![description](assets/{filename})` for images. Omit UI blocks for scenarios where the user said no UI.

3. Add a new row to `prd/features/FEAT-XXXX/USE-CASES.md`:
   ```
   | UC-XXXX | {Use Case Name} | {One-sentence description} | pending | [UC-XXXX.md](use-cases/UC-XXXX.md) |
   ```

## Step 8: Report

Tell the user what was created:

- `prd/features/FEAT-XXXX/use-cases/UC-XXXX.md` -- UC file with flat scenario structure
- `prd/features/FEAT-XXXX/USE-CASES.md` -- updated with new row (UC-XXXX, status: pending)

Suggest next step: "Use `/m:scenario UC-XXXX` to generate Gherkin scenarios for this use case."
