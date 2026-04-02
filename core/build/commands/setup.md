---
description: Initialize project with foundational docs and tooling detection, or re-run to update tooling only
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
Read: ${CLAUDE_PLUGIN_ROOT}/build/skills/setup/SKILL.md
```

Follow the skill's rules for all subsequent steps.

## Step 2: Check for Existing Documents and Parse Flags

Check for flags passed after `/m:setup`:
- `--no-overwrite`: Only generate hooks that don't already exist in `.molcajete/hooks/`. Existing hooks are preserved.
- `--all`: Generate all hooks (7 default + 10 optional lifecycle). Default generates only the 7 default hooks.
- Combinable: `/m:setup --all --no-overwrite` generates all hooks but skips existing ones.

Check if `prd/PROJECT.md` already exists.

If it exists, use AskUserQuestion:
- Question: "Foundational documents already exist (PROJECT.md found). What would you like to do?"
- Header: "Setup Mode"
- Options:
  - "Regenerate all" -- full interview: regenerate PRD documents and re-detect tooling
  - "Update hooks only" -- skip PRD interview, re-scan project tooling (Docker, formatters, linters, BDD frameworks) and regenerate `.molcajete/hooks/`. Use this after installing new packages or changing how the project runs.
  - "No changes" -- stop without changes

If "Regenerate all" → proceed to Step 3.
If "Update hooks only" → read `prd/DOMAINS.md` to get the domain list, then jump to Step 8 (Hook Generation).
If "No changes" → stop.

If `prd/PROJECT.md` does not exist, proceed to Step 3.

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

## Step 6: Interview -- Domains

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

### Global Domain Auto-Creation

If more than one domain is confirmed, automatically prepend a `global` domain (ID: 0, Type: spec-only). Do not ask the user — this is automatic for multi-domain projects.

## Step 7: Generate Documents

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

1. Read `${CLAUDE_PLUGIN_ROOT}/build/skills/setup/templates/PROJECT-template.md`
   Write `prd/PROJECT.md` filled with the confirmed project description.

2. Read `${CLAUDE_PLUGIN_ROOT}/build/skills/setup/templates/TECH-STACK-template.md`
   Write `prd/TECH-STACK.md` filled with the confirmed tech stack.

3. Read `${CLAUDE_PLUGIN_ROOT}/build/skills/setup/templates/ACTORS-template.md`
   Write `prd/ACTORS.md` filled with the confirmed actors.

4. Read `${CLAUDE_PLUGIN_ROOT}/build/skills/setup/templates/GLOSSARY-template.md`
   Write `prd/GLOSSARY.md` with starter terms:
   - 5 standard terms: Domain, Feature, Use Case, Actor, Side Effect (adapted to this project's domain)
   - 3-5 additional terms extracted from the project description and tech stack (e.g., the database name, the primary framework, domain-specific terms)

5. Read `${CLAUDE_PLUGIN_ROOT}/build/skills/setup/templates/DOMAINS-template.md`
   Write `prd/DOMAINS.md` filled with the confirmed domains table.

6. Read `${CLAUDE_PLUGIN_ROOT}/build/skills/setup/templates/FEATURES-template.md`
   Write `prd/FEATURES.md` with the status key, a `## global` section first (if global domain exists), then one `## {domain}` section per real domain. All tables start empty.

## Step 8: Generate Hooks

Follow the setup skill's Stage 5 (Hook Generation) rules.

**Default hooks** (always generated):
- `start.mjs` — start the dev environment
- `stop.mjs` — stop the dev environment
- `health-check.mjs` — verify services are running
- `run-tests.mjs` — run BDD tests with tag filtering
- `format.mjs` — run formatter in check mode
- `lint.mjs` — run linter in report mode
- `logs.mjs` — retrieve environment logs

**Optional hooks** (generated only with `--all` flag):
- `restart.mjs`, `create-worktree.mjs`, `cleanup.mjs`, `merge.mjs`
- `before-task.mjs`, `after-task.mjs`, `before-validate.mjs`, `after-validate.mjs`, `before-commit.mjs`, `after-commit.mjs`

Launch an `Explore` sub-agent to **understand the project's technology stack and derive direct tool commands** for each hook. The agent reads project manifests — not wrapper scripts — to determine what tools exist and how they're configured:

1. **Environment** — Read `docker-compose.yml`, `.env.example`, `Dockerfile`, and `Makefile` to understand what services the project depends on (databases, caches, app servers) and how they're composed. From Docker Compose: derive `start` = `docker compose up -d`, `stop` = `docker compose down`, per-service health checks from port mappings (using `process.env` references, not hardcoded values), and `logs` = `docker compose logs`. If no Docker Compose, check `package.json` scripts to discover the underlying dev server command (e.g., `"dev": "next dev -p 3000"` → `npx next dev -p 3000`), and derive log commands from the runtime (e.g., `tail -n` for file-based logs).
2. **BDD framework** — Read dependency manifests (`requirements.txt`, `pyproject.toml`, `package.json`, `go.mod`) to identify the BDD framework, then derive the exact test command with Molcajete-optimal flags and the tag join separator. Example: found `behave` in `bdd/requirements.txt` → command is `behave bdd/`, tags flag: `--tags`, format flags: `--format json --no-capture`, tag join: `' or '`. Also confirm step files and feature file directories exist.
3. **Per-domain tooling** — For each domain (from Step 6 or `prd/DOMAINS.md`), read config files (`biome.json`, `.prettierrc`, `.golangci.yml`, `go.mod`) and dependency manifests to detect formatter and linter tools. Build file-aware entries with `{ service, glob, command, fallback }` format — the `glob` pattern matches changed files to the right tool, `command` uses `{files}` placeholder, and `fallback` runs on the full directory when no files are passed. Read Makefiles and package.json scripts **only to discover which tools are installed**. Construct direct tool commands — never `make`, `npm run`, or `pnpm --filter`.
4. **Warnings** — missing formatter, linter, or no development environment detected

After the agent returns, present the detected hooks to the user via AskUserQuestion using the Stage 5e flat table format — every hook shows its exact command so the user sees precisely what will execute.

After confirmation, for each hook in the list:
1. If `--no-overwrite` is set and `.molcajete/hooks/{hook-name}.*` exists, skip it
2. Otherwise:
   a. Create `.molcajete/hooks/` directory if it doesn't exist
   b. Read the hook template from `${CLAUDE_PLUGIN_ROOT}/build/skills/setup/templates/hooks/`
   c. Replace placeholders with detected values
   d. Write hook to `.molcajete/hooks/` and make it executable (`chmod +x`)
3. Write BDD settings to `.molcajete/settings.json` (framework, language, format) for the gherkin skill cache

## Step 9: Report

Tell the user what was created or updated.

**If full setup (Steps 3-8):**
- `prd/PROJECT.md` -- project description
- `prd/TECH-STACK.md` -- technology choices
- `prd/ACTORS.md` -- system actors
- `prd/GLOSSARY.md` -- domain vocabulary with starter terms
- `prd/DOMAINS.md` -- domain registry
- `prd/FEATURES.md` -- master feature inventory (sectioned by domain)
- `.molcajete/hooks/` -- executable hook scripts (start, stop, health-check, run-tests, format, lint, logs)
- For each domain:
  - `prd/domains/{domain}/features/` -- directory for feature specs

**If hooks-only update (Step 8 only):**
- `.molcajete/hooks/` -- regenerated hook scripts
- List what changed: new tools detected, commands updated, warnings

If there are warnings (missing formatters, linters, etc.), display them prominently.

Explain the structure: "Your specs are organized by domain. All features are registered in `prd/FEATURES.md` under their domain section. Use `/m:feature` to create your first feature."
