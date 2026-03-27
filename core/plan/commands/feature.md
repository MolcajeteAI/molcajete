---
description: Create a new feature with EARS requirements via creation interview
model: claude-opus-4-6
argument-hint: <freeform feature description>
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

# Create a New Feature

You are creating a new feature spec from a freeform description. This command runs the creation interview defined in the feature-authoring skill, generates structured documents, and registers the feature in FEATURES.md.

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response. This keeps you in control of the conversation flow.

## Step 1: Load Skill

Read the feature-authoring skill for EARS syntax rules, Fit Criteria format, Non-Goals positioning, interview pattern, and template references:

```
Read: ${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/SKILL.md
```

Follow the skill's rules for all subsequent steps.

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

Use the project context to inform your extraction and suggestions in the interview.

## Step 4: Extract from Input

If `$ARGUMENTS` is not empty, extract as much as possible from the freeform description:

- Feature name (3-5 words)
- Non-goals (what this feature does NOT do)
- Actors (who uses this feature — reference actors from ACTORS.md where applicable)
- UI (any mockups, layout descriptions, or image file paths)
- Functional requirements (convert to EARS syntax and add Fit Criteria)
- Non-functional requirements (performance, security, reliability)
- Acceptance criteria (how we know it's done)

If `$ARGUMENTS` is empty, use AskUserQuestion to ask:
- Question: "Describe the feature you want to create. Include what it does, who uses it, and any constraints or requirements you already know."
- Header: "Feature Description"

Then extract from the response.

## Step 5: Creation Interview

Present each section for review via AskUserQuestion, following the interview pattern from the skill exactly:

1. **Feature name** — confirm or edit
2. **Non-goals** — confirm, edit, or skip
3. **Actors** — confirm or edit (suggest from ACTORS.md)
4. **UI** — confirm, edit, describe, or skip (follow UI Section rules from skill)
5. **Functional requirements** — shown in EARS syntax with Fit Criteria; confirm or edit
6. **Non-functional requirements** — confirm, edit, or skip
7. **Acceptance criteria** — confirm or edit

For each section, follow the skill's interview rules:
- If extracted from input: present and ask "Does this look correct?" with "Yes, looks good" / "Edit" options
- If not found in input: ask if the user has any, with option to skip where appropriate

## Step 6: Assign Feature ID

After all sections are confirmed, generate the feature ID:

```bash
node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js
```

Prepend `FEAT-` to the output (e.g., `FEAT-0S9A`).

## Step 7: Generate Documents

Create the feature directory structure:

```bash
mkdir -p prd/features/FEAT-XXXX/use-cases
```

If the user provided image file paths during the interview, also create `prd/features/FEAT-XXXX/assets/` and copy the images there.

Then read each template and generate the documents:

1. Read `${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/templates/REQUIREMENTS-template.md`
   Write `prd/features/FEAT-XXXX/REQUIREMENTS.md` filled with confirmed content. Follow the section order from the skill: name + objective, Non-Goals, Actors, UI (only if provided), Functional Requirements (EARS + Fit Criteria), Non-Functional Requirements, Acceptance.

2. Read `${CLAUDE_PLUGIN_ROOT}/plan/skills/feature-authoring/templates/USE-CASES-template.md`
   Write `prd/features/FEAT-XXXX/USE-CASES.md` with an empty use case table.

3. Read `${CLAUDE_PLUGIN_ROOT}/plan/skills/architecture/templates/ARCHITECTURE-template.md`
   Write `prd/features/FEAT-XXXX/ARCHITECTURE.md` scaffold.

4. Edit `prd/FEATURES.md` — add a new row:
   ```
   | FEAT-XXXX | {Feature Name} | {One-sentence description} | pending | @FEAT-XXXX | [features/FEAT-XXXX/](features/FEAT-XXXX/) |
   ```

## Step 8: Report

Tell the user what was created:

- `prd/features/FEAT-XXXX/REQUIREMENTS.md` — feature requirements (EARS syntax)
- `prd/features/FEAT-XXXX/USE-CASES.md` — use case index (empty, ready for /m:usecase)
- `prd/features/FEAT-XXXX/ARCHITECTURE.md` — architecture scaffold
- Updated `prd/FEATURES.md` with new row

Suggest next step: "Use `/m:usecase FEAT-XXXX {description}` to add use cases to this feature."
