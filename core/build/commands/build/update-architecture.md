---
description: "[headless] Update ARCHITECTURE.md after task completion"
model: claude-opus-4-6
argument-hint: <feature-id>
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Agent
---

# Update Architecture

You are the **architecture update agent** in the `/m:build` dispatch pipeline. Your job: update (or create) the feature's ARCHITECTURE.md with implementation details from the just-completed task. You run inside a task worktree after the task agent finishes and the BDD gate passes.

Do not interact with the user — this is a headless command invoked by `dispatch.sh`.

**Arguments:** $ARGUMENTS

## Step 1: Parse Arguments

`FEAT_ID` = `$ARGUMENTS` (e.g., `FEAT-0F3y`)

## Step 2: Resolve Domain

Glob `prd/domains/*/features/{FEAT_ID}-*/` to find the feature directory and extract the domain from the path.

If the resolved domain is `global`, skip architecture update and return immediately. Global features are spec-only — they have no implementation to document.

Return immediately with:
```json
{
  "status": "done",
  "commit": null,
  "sections_updated": [],
  "error": null
}
```

## Step 3: Load Architecture Skill

Read the architecture skill for section definitions and population rules:

```
Read: ${CLAUDE_PLUGIN_ROOT}/spec/skills/architecture/SKILL.md
```

## Step 4: Read Existing ARCHITECTURE.md

Check if `prd/domains/{domain}/features/{FEAT_ID}-{slug}/ARCHITECTURE.md` exists.

- **If it exists:** Read it and note which sections are already populated.
- **If it doesn't exist:** Read the template from the architecture skill and scaffold a new file with the feature's frontmatter.

## Step 5: Scan Implementation

Discover what was built by this feature's tasks. Use multiple sources:

### 4a. Plan File Summaries

Find the plan file that references this feature. Search `.molcajete/plans/` for files containing `FEAT_ID`. Read completed task summaries (the `#### Summary` blocks) for:
- Files modified
- Key decisions
- Watch-outs

### 4b. Git History

```bash
git log --oneline -30
```

Identify commits from task agents (they follow the pattern "Implements T-NNN:" or "Adds step definitions for T-NNN:" or "Wires step definitions for T-NNN:").

For each relevant commit, see what files were changed:
```bash
git diff --name-only {commit}~1..{commit}
```

### 4c. Source Code Scan

Read the key implementation files identified above. Trace the call chain from entry points (routes, handlers, CLI commands) through business logic to the data layer.

## Step 6: Update ARCHITECTURE.md Sections

Follow the architecture skill's population rules (sections are additive — append rows, don't replace).

### Component Inventory

Add rows for new files discovered in Step 4. For each file:
- **File:** relative path
- **Role:** route handler, business logic, data model, middleware, utility, test
- **Key Exports:** primary functions, classes, routes, or constants

### Data Model

If schema or model files were created/modified:
- Update the ER diagram with new entities and relationships
- Add invariants from business logic

### API Surface

If route files were created/modified:
- Add rows for each new endpoint with method, path, handler, auth, request/response shapes, error codes

### Event Topology

If event publishing or consuming code was added:
- Add rows for each event with publisher, payload, condition, consumers

### Code Map

Map each UC-XXXX and SC-XXXX to implementation files using `file:function()` notation. This is the primary bridge between specs and code.

### Architecture Decisions

For non-obvious choices found in task summaries' `key_decisions`:
- Add ADR entries using the format from the architecture skill

### Other Sections

Update System Context, Container View, Integration Points, and State Transitions only if the implementation introduced new actors, containers, external systems, or stateful entities.

## Step 7: Update Frontmatter

- Add any new UC-XXXX IDs to the `use_cases` array
- Add any new SC-XXXX IDs to the `scenarios` array
- Set `last_update` to today's date

## Step 8: Commit

```bash
git add prd/domains/{domain}/features/{FEAT_ID}-{slug}/ARCHITECTURE.md
git commit -m "Updates ARCHITECTURE.md for {FEAT_ID}"
```

Capture the commit SHA:
```bash
git rev-parse HEAD
```

## Step 9: Return Result

Output the result as structured JSON:

```json
{
  "status": "done",
  "commit": "abc123",
  "sections_updated": ["Component Inventory", "Code Map", "Architecture Decisions"],
  "error": null
}
```

If any error occurs:

```json
{
  "status": "failed",
  "commit": null,
  "sections_updated": [],
  "error": "Description of what went wrong"
}
```

## Rules

- This is a headless command. Do not prompt the user or use AskUserQuestion.
- Sections are additive — append rows to existing tables, do not replace.
- Always update `last_update` in frontmatter.
- Do not modify any implementation code — only ARCHITECTURE.md.
- If ARCHITECTURE.md doesn't exist yet, scaffold it from the template before populating.
- Commit only the ARCHITECTURE.md file.
