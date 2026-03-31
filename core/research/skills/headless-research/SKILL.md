---
name: headless-research
description: >-
  Lightweight, silent research that runs before spec-writing. Checks for existing
  research (user-provided or cached), runs 2 parallel agents if needed, and saves
  a machine-oriented context brief to .molcajete/research/. No user interaction.
---

# Headless Research

Lightweight, silent research that runs automatically inside spec-authoring commands. No user interaction. Target: 15-30 seconds.

## When to Use

- Before spec-writing in `/m:feature`, `/m:usecase`, `/m:spec`
- When a command needs up-to-date context about a topic before generating specs
- Called from spec-authoring commands before the creation interview

## Naming Convention

Files use full timestamps for natural sort order:

```
.molcajete/research/20260329-1415-postgres-sharding-strategies.md
.molcajete/research/20260329-1430-user-authentication-oauth.md
```

Format: `{YYYYMMDD-HHmm}-{slug}.md`

No entity IDs in filenames — IDs may not exist yet when research runs. Association is handled through frontmatter and relevance scanning.

## Workflow

### Step 1: Check if the User Referenced Research

If the calling command passed a research document path in `$ARGUMENTS` (e.g., a path matching `research/*.md`):

1. Read the referenced document
2. Evaluate: does it cover the topic sufficiently for the current task?
3. **If yes** — create a **pointer brief** in `.molcajete/research/{YYYYMMDD-HHmm}-{slug}.md` that:
   - Has full frontmatter (`description`, `query`, `stack`) so downstream tasks find it
   - Body contains a short summary + a `source:` field pointing to the user's research file
   - Does NOT duplicate the content — just references it
4. Skip agents entirely. The user already did the work.
5. **If close but incomplete** — run only the agents needed to fill the gap, then create the brief with both the user's research reference and the supplemental findings.

### Step 2: Scan for Existing Research (No User Reference)

If no user reference was provided:

1. Ensure `.molcajete/research/` directory exists (create with `mkdir -p` if needed)
2. List files in `.molcajete/research/` sorted newest-first (by filename timestamp)
3. For each file, read only the YAML frontmatter (first `---` to second `---`)
4. Check if `description` or `query` is relevant to the current topic
5. Stop at the first relevant match — read the full document and use it as context
6. Also scan `research/*.md` at project root (user's explicit research) the same way
7. If relevant research is found and recent (< 30 days by `date` field), use it and skip to Step 4

### Step 3: Launch 2 Parallel Agents

If no reusable research was found, launch both agents in a single message:

#### Local Context Agent

- **Type:** `subagent_type: Explore`
- **Task:** Find existing codebase patterns relevant to the topic
- **Instructions:**
  - Use Glob to find files related to the topic
  - Use Grep to search for relevant imports, function names, patterns
  - Use Read to examine relevant code sections
  - Return: existing dependencies, patterns, conventions, architecture decisions
  - Keep findings concise — this feeds a 200-500 word brief

#### Web Context Agent

- **Type:** `subagent_type: general-purpose`
- **Task:** 1-2 targeted web searches for current best practices
- **Instructions:**
  - Use WebSearch for current best practices, API patterns, library docs for the topic + detected stack
  - Use WebFetch to read the most relevant result (limit to 1-2 pages)
  - Return: 3-5 bullet points of current best practices, key libraries/APIs, gotchas
  - Keep findings concise — this feeds a 200-500 word brief

### Step 4: Save Context Brief

Save to `.molcajete/research/{YYYYMMDD-HHmm}-{slug}.md` using the template at:

```
${CLAUDE_PLUGIN_ROOT}/research/skills/headless-research/templates/context-brief.md
```

This step runs regardless of the path taken (user reference, cached research, or fresh agents). The brief always exists after headless research completes.

Generate the slug from the research topic in kebab-case. Use the current timestamp.

## Discovery Pattern

Other commands find research briefs using this pattern:

1. List `.molcajete/research/*.md` — filenames sort naturally by timestamp (newest first)
2. Read only YAML frontmatter of each file (not the body)
3. Compare `description` and `query` against the current task's topic
4. If relevant, read the full document and include it as context
5. Stop after the first relevant match to protect context window
6. If nothing relevant, proceed without research context

This same pattern works for both headless briefs and pointer briefs referencing user research in `research/`.

## Templates

| Template | Purpose |
|----------|---------|
| [context-brief.md](./templates/context-brief.md) | Machine-oriented brief (200-500 words) |
