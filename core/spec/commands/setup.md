---
description: Initialize project with PROJECT.md, TECH-STACK.md, ACTORS.md, GLOSSARY.md, DOMAINS.md, and per-domain FEATURES.md
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

Launch an `Explore` sub-agent to scan for tech stack indicators **grouped by module**. The agent should:

1. **Discover modules:** Check for `apps/*/`, `packages/*/`, `services/*/`, `cmd/*/` directory structures. If none found, treat the project root as a single module.
2. **Per module:** Read the module's directory and detect:
   - Directory path (relative to project root)
   - Language and version (from go.mod, package.json engines, tsconfig.json target, etc.)
   - Framework (from dependencies: React, Next.js, Express, gqlgen, etc.)
   - Build tool (Vite, Webpack, esbuild, `go build`, etc.)
   - Key libraries (state management, GraphQL clients, ORMs, validation, i18n, etc.)
   - Styling (Tailwind, CSS modules, styled-components — frontend modules only)
   - Testing tools (Vitest, Jest, Go test, pytest, etc.)
   - Lint/format tools (Biome, ESLint, golangci-lint, etc.)
3. **Shared infrastructure:** Check docker-compose.yml for databases, caches, queues. Check .github/workflows/, vercel.json, netlify.toml for CI/CD and hosting.
4. **External services:** Grep for API keys, SDK imports, or service client instantiations that indicate third-party services (payment processors, LLM providers, notification services, etc.)
5. **Return a structured summary** organized as: one section per module (with directory, language, framework, libraries, tooling), then shared infrastructure, then external services.

After the agent returns, use AskUserQuestion to present the inferred stack:
- Question: "I found the following tech stack in your codebase:\n\n{inferred stack grouped by module, then shared infrastructure, then external services}\n\nIs this correct? Add or correct anything that's missing."
- Header: "Tech Stack"
- Options:
  - "Yes, that's correct" -- proceed
  - "Mostly correct, with changes" -- user provides corrections via Other

### If no codebase exists

Use AskUserQuestion to ask each tech stack question. You may batch related questions into a single AskUserQuestion with multiple questions (up to 4):

Batch 1:
- "What applications or services make up your project? For each one, what language and framework does it use?" (e.g., "Patient app: React + TypeScript in apps/patient/, Backend: Go + gqlgen in server/")
- "What database, cache, or queue systems?" (e.g., PostgreSQL + Redis)

Batch 2:
- "How is the project hosted and what CI/CD do you use?" (e.g., Hetzner VPS + GitHub Actions)
- "Is this a monorepo or multi-repo? What package manager?" (e.g., monorepo with pnpm)

After gathering answers, use AskUserQuestion to present the composed tech stack for confirmation (one module section per application/service).

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

## Step 5.5: Interview -- Domains

Follow the setup skill's Stage 4 (Domains) rules.

### If a codebase exists

Launch an `Explore` sub-agent to infer domains from the project structure:
- Check for `apps/`, `packages/`, `services/` directories -- each subdirectory suggests a domain
- Check for `src/` subdirectories suggesting distinct concern areas
- Check for monorepo workspace configurations (package.json workspaces, pnpm-workspace.yaml)

After inference, use AskUserQuestion to present the inferred domains:
- Question: "I found these logical domains in your project:\n\n{domain table: Name | Type | Description}\n\nDomains are logical boundaries for organizing your specs. They can represent physical apps (patient, doctor) or logical concerns (billing, analytics) within a single app. Molcajete treats them all the same way.\n\nDo these look correct?"
- Header: "Domains"
- Options:
  - "Yes, that's correct" -- proceed
  - "Needs changes" -- user provides corrections via Other

### If no codebase exists

Use AskUserQuestion:
- Question: "What are the logical domains in your project? A domain can be a separate app (patient app, admin console), a service (auth API, billing service), or a concern area within one app (onboarding, analytics).\n\nDomains are logical boundaries for organizing your specs -- not deployment boundaries. Molcajete treats all domain types the same way."
- Header: "Domains"

### For single-app projects

If the project appears to be a single application (one framework, one entry point, no monorepo structure), suggest one domain:
- Question: "This appears to be a single-app project. I'll create one domain: **{project-name-slug}** (type: app). You can add more domains later if your project grows. Does this look correct?"
- Header: "Domains"
- Options:
  - "Yes, one domain is fine" -- proceed
  - "I have multiple domains" -- user provides corrections via Other

After confirmation, record the domain list for document generation.

## Step 6: Generate Documents

**Global project files go directly in `prd/`.** Per-domain files go in `prd/domains/{domain}/`.

First, create the prd directory and domain directories:

```bash
mkdir -p prd
```

Then for each confirmed domain:
```bash
mkdir -p prd/domains/{domain}/features
```

Read all templates from the setup skill and generate the documents:

1. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/PROJECT-template.md`
   Write `prd/PROJECT.md` filled with the confirmed project description.

2. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/TECH-STACK-template.md`
   Write `prd/TECH-STACK.md` filled with the confirmed tech stack.

3. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/ACTORS-template.md`
   Write `prd/ACTORS.md` filled with the confirmed actors.

4. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/GLOSSARY-template.md`
   Write `prd/GLOSSARY.md` with starter terms:
   - 5 standard terms: Domain, Feature, Use Case, Actor, Side Effect (adapted to this project's domain)
   - 3-5 additional terms extracted from the project description and tech stack (e.g., the database name, the primary framework, domain-specific terms)

5. Read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/DOMAINS-template.md`
   Write `prd/DOMAINS.md` filled with the confirmed domains table.

6. For each domain, read `${CLAUDE_PLUGIN_ROOT}/spec/skills/setup/templates/FEATURES-template.md`
   Write `prd/domains/{domain}/FEATURES.md` with the status key and an empty features table.

## Step 7: Report

Tell the user what was created:

- `prd/PROJECT.md` -- project description
- `prd/TECH-STACK.md` -- technology choices
- `prd/ACTORS.md` -- system actors
- `prd/GLOSSARY.md` -- domain vocabulary with starter terms
- `prd/DOMAINS.md` -- domain registry
- For each domain:
  - `prd/domains/{domain}/FEATURES.md` -- empty feature inventory
  - `prd/domains/{domain}/features/` -- directory for feature specs

Explain the structure: "Your specs are organized by domain. Each domain has its own FEATURES.md and features directory. Use `/m:feature` to create your first feature."
