---
description: Initialize project with PROJECT.md, TECH-STACK.md, ACTORS.md, GLOSSARY.md, FEATURES.md
model: claude-opus-4-6
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

# Set Up Project Foundation

You are initializing a project's foundational documents. These documents are required by all other Molcajete commands (/m:plan, /m:build).

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response. This keeps you in control of the conversation flow.

## Step 1: Load Skill

Read the setup skill for interview rules, codebase detection patterns, confirmation rules, and template references:

```
Read: ${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/SKILL.md
```

Follow the skill's rules for all subsequent steps.

## Step 2: Check for Existing Documents

Check if `prd/PROJECT.md` already exists.

If it exists, use AskUserQuestion:
- Question: "Foundational documents already exist (PROJECT.md found). Do you want to regenerate them?"
- Header: "Regenerate"
- Options:
  - "Yes, regenerate all" -- proceed with the full interview
  - "No, keep existing" -- stop without changes

If it does not exist, proceed to Step 3.

## Step 3: Interview -- Project Description

Use AskUserQuestion to ask the user to describe their project. Ask:
- "What does this project do, who uses it, and what problem does it solve?"

If the user's answer is too brief (doesn't cover what/who/why), follow up with qualifying questions via AskUserQuestion until you have enough for a 1-2 paragraph description.

After gathering the description, use AskUserQuestion to present it back:
- Question: "Here's the project description I'll use for PROJECT.md:\n\n{extracted description}\n\nDoes this look correct?"
- Header: "Project"
- Options:
  - "Yes, looks good" -- proceed
  - "Edit" -- user provides corrections via Other

## Step 4: Interview -- Tech Stack

### If a codebase exists

Launch an `Explore` sub-agent to scan for tech stack indicators. The agent should:
- Check for package.json, tsconfig.json, go.mod, Cargo.toml, Gemfile, requirements.txt, pyproject.toml, docker-compose.yml, prisma/schema.prisma, drizzle.config.ts, .github/workflows/*.yml, vercel.json, netlify.toml, tailwind.config.*, biome.json
- Read package.json dependencies if it exists (detect frameworks, state management, etc.)
- Return a structured summary of the inferred tech stack

After the agent returns, use AskUserQuestion to present the inferred stack:
- Question: "I found the following tech stack in your codebase:\n\n{inferred stack formatted as the TECH-STACK.md sections}\n\nIs this correct? Add or correct anything that's missing."
- Header: "Tech Stack"
- Options:
  - "Yes, that's correct" -- proceed
  - "Mostly correct, with changes" -- user provides corrections via Other

### If no codebase exists

Use AskUserQuestion to ask each tech stack question. You may batch related questions into a single AskUserQuestion with multiple questions (up to 4):

Batch 1:
- "What primary language and frameworks are you using?" (e.g., TypeScript + Next.js)
- "What database, ORM, cache, or queue systems?" (e.g., PostgreSQL + Prisma + Redis)

Batch 2:
- "How is the project hosted and what CI/CD do you use?" (e.g., Vercel + GitHub Actions)
- "Is this a monorepo or multi-repo? What package manager?" (e.g., monorepo with pnpm)

After gathering answers, use AskUserQuestion to present the composed tech stack for confirmation.

## Step 5: Interview -- Actors

### If actors can be inferred

Launch an `Explore` sub-agent to scan for actor evidence in the codebase. The agent should check for:
- Auth middleware with role checks (suggests role-based actors)
- Admin panel routes or components (suggests admin actor)
- API key validation (suggests external system actor)
- Public vs. authenticated routes (suggests guest vs. authenticated actors)
- Webhook handlers (suggests external system actor)
- Multi-tenant patterns (suggests tenant/organization actor)

Also extract potential actors from the project description gathered in Step 3 (user types mentioned, roles described).

After inference, use AskUserQuestion to present suggested actors:
- Question: "Based on your project, I identified these actors:\n\n{actor table with Role, Description, Constraints}\n\nDo these look correct? Are there others?"
- Header: "Actors"
- Options:
  - "Yes, that's correct" -- proceed
  - "Needs changes" -- user provides corrections via Other

### If no actors can be inferred

Use AskUserQuestion:
- Question: "Who interacts with this system? List the roles (human or system) along with any permissions or constraints. For example: 'Admin (human) -- full access; API Consumer (system) -- read-only.'"
- Header: "Actors"

After gathering the answer, use AskUserQuestion to present the structured actor table for confirmation.

## Step 6: Generate Documents

**All 5 project files go directly in `prd/`, NOT in `prd/features/`.** The `prd/features/` subdirectory is only for feature-specific specs added later by /m:plan.

First, create the prd directory:

```bash
mkdir -p prd
```

Then read all 5 templates from the setup skill and generate the documents:

1. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/PROJECT-template.md`
   Write `prd/PROJECT.md` filled with the confirmed project description.

2. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/TECH-STACK-template.md`
   Write `prd/TECH-STACK.md` filled with the confirmed tech stack.

3. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/ACTORS-template.md`
   Write `prd/ACTORS.md` filled with the confirmed actors.

4. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/GLOSSARY-template.md`
   Write `prd/GLOSSARY.md` with starter terms:
   - 4 standard terms: Feature, Use Case, Actor, Side Effect (adapted to this project's domain)
   - 3-5 additional terms extracted from the project description and tech stack (e.g., the database name, the primary framework, domain-specific terms)

5. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/FEATURES-template.md`
   Write `prd/FEATURES.md` with the status key and an empty features table.

## Step 7: Create Features Directory

This is a separate, empty directory for feature specs added later by /m:plan. Do NOT place any project files (PROJECT.md, TECH-STACK.md, ACTORS.md, GLOSSARY.md, FEATURES.md) here — those belong directly in `prd/`.

```bash
mkdir -p prd/features
```

## Step 8: Report

Tell the user what was created:

- `prd/PROJECT.md` -- project description
- `prd/TECH-STACK.md` -- technology choices
- `prd/ACTORS.md` -- system actors
- `prd/GLOSSARY.md` -- domain vocabulary with starter terms
- `prd/FEATURES.md` -- empty feature inventory
- `prd/features/` -- directory for feature specs

Suggest next steps: "Use `/m:plan` to start planning your first feature."
