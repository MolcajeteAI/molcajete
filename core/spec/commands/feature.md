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
  - WebSearch
  - WebFetch
---

# Create a New Feature

You are creating a new feature spec from a freeform description. This command runs the creation interview defined in the feature-authoring skill, generates structured documents, and registers the feature in FEATURES.md.

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response. This keeps you in control of the conversation flow.

## Step 1: Load Skill

Read the feature-authoring skill for EARS syntax rules, Fit Criteria format, Non-Goals positioning, interview pattern, and template references:

```
Read: ${CLAUDE_PLUGIN_ROOT}/spec/skills/feature-authoring/SKILL.md
```

Follow the skill's rules for all subsequent steps.

## Step 2: Verify Prerequisites

Check that `prd/PROJECT.md` and `prd/DOMAINS.md` both exist.

If either is missing, tell the user:

"Project foundation not found. Run `/m:setup` first to create PROJECT.md and DOMAINS.md."

Then stop. Do not proceed.

## Step 3: Load Project Context

Read the following files to understand the project and avoid duplicate features:

1. `prd/PROJECT.md` — project description (required)
2. `prd/TECH-STACK.md` — technology choices (if exists)
3. `prd/ACTORS.md` — system actors (if exists)
4. `prd/DOMAINS.md` — domain registry (required)
5. `prd/FEATURES.md` — check for duplicates across all domains

Use the project context to inform your extraction and suggestions in the interview.

## Step 4: Domain Selection

Read `prd/DOMAINS.md` and resolve the target domain following the feature-authoring skill's full Domain Resolution rules — do not skip any steps:

- If only one domain exists, use it automatically
- If multiple domains exist, first ask via AskUserQuestion: "Is this a cross-cutting concern that applies to every domain in the project?" (Yes = `global` domain, No = ask which domain, excluding `global` from the list)
- Follow the skill's Cross-Cutting Detection Signals to inform the question when applicable

Record the selected domain for all subsequent path operations.

**If domain is `global`:**
1. Inform the user: "Global features contain only baseline requirements and architecture. Use cases will be created in domain features."
2. After global feature creation (Step 9), ask via AskUserQuestion: "Which domains need this feature? Each selected domain will get its own `features/FEAT-XXXX-{slug}/` directory with domain-specific requirements, use cases, and architecture."
   - Header: "Domain Features"
   - Present the domain list from DOMAINS.md (excluding `global`), multi-select
3. For each selected domain, create `prd/domains/{domain}/features/FEAT-XXXX-{slug}/` with:
   - `REQUIREMENTS.md` with `refs: [FEAT-XXXX]` in frontmatter, domain-specific scaffold
   - `USE-CASES.md` (empty table)
   - `ARCHITECTURE.md` scaffold
   - A FEATURES.md row under that domain's section

**If domain is NOT `global`:** Run the Refs Declaration flow from the feature-authoring skill to check for global feature dependencies.

## Step 5: Research Context

Read the headless-research skill:

```
Read: ${CLAUDE_PLUGIN_ROOT}/research/skills/headless-research/SKILL.md
```

Check if `$ARGUMENTS` references a research document (a path matching `research/*.md`).
If so, pass it to the headless-research skill as a user-provided reference.

Otherwise, use the freeform description from `$ARGUMENTS` as the research query.

Follow the skill's workflow (check user reference → scan existing → run agents if needed).

Use the resulting context brief to inform subsequent extraction and interview steps (better requirement suggestions, awareness of existing patterns, up-to-date approaches).

## Step 6: Extract from Input

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

## Step 7: Creation Interview

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

## Step 8: Assign Feature ID

After all sections are confirmed, generate the feature ID:

```bash
node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js
```

Prepend `FEAT-` to the output (e.g., `FEAT-0S9A`).

## Step 9: Generate Documents

Create the feature directory structure using the selected domain:

**If domain is `global`:**
```bash
mkdir -p prd/domains/global/features/FEAT-XXXX-{slug}
```
No `use-cases/` directory — global features have no use cases.

**If domain is NOT `global`:**
```bash
mkdir -p prd/domains/{domain}/features/FEAT-XXXX-{slug}/use-cases
```

If the user provided image file paths during the interview, also create `prd/domains/{domain}/features/FEAT-XXXX-{slug}/assets/` and copy the images there.

Then read each template and generate the documents:

1. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/feature-authoring/templates/REQUIREMENTS-template.md`
   Write `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md` filled with confirmed content. Add `domain: {domain}` to the frontmatter. Follow the section order from the skill: name + objective, Non-Goals, Actors, UI (only if provided), Functional Requirements (EARS + Fit Criteria), Non-Functional Requirements, Acceptance.

2. **If domain is NOT `global`:** Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/feature-authoring/templates/USE-CASES-template.md`
   Write `prd/domains/{domain}/features/FEAT-XXXX-{slug}/USE-CASES.md` with an empty use case table.
   **Skip for global** — global features have no use cases.

3. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/architecture/templates/ARCHITECTURE-template.md`
   Write `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` scaffold.

4. Edit `prd/FEATURES.md` — add a new row under the appropriate section:
   ```
   | FEAT-XXXX | {Feature Name} | {One-sentence description} | pending | @FEAT-XXXX | [features/FEAT-XXXX-{slug}/](features/FEAT-XXXX-{slug}/) |
   ```

5. **If domain is `global` and domain features were requested (Step 4):** For each selected domain, create the domain feature with the same FEAT-XXXX ID — see Step 4 for details.

## Step 10: Report

Tell the user what was created:

- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/REQUIREMENTS.md` — feature requirements (EARS syntax)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/USE-CASES.md` — use case index (empty, ready for /m:usecase)
- `prd/domains/{domain}/features/FEAT-XXXX-{slug}/ARCHITECTURE.md` — architecture scaffold
- Updated `prd/FEATURES.md` with new row

Suggest next step: "Use `/m:usecase FEAT-XXXX {description}` to add use cases to this feature."
