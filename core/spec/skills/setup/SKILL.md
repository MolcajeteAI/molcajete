---
name: setup
description: >-
  Rules and templates for the /m:setup command. Defines the interview flow
  for generating PROJECT.md, TECH-STACK.md, ACTORS.md, GLOSSARY.md,
  DOMAINS.md, and master FEATURES.md. Covers codebase inference for
  tech stack, actors, domains, and project tooling detection. Includes
  tooling-only update mode for re-running without regenerating PRD docs.
---

# Project Setup

Rules for initializing a project's foundational documents. The /m:setup command references this skill to interview the user and generate the global documents (PROJECT.md, TECH-STACK.md, ACTORS.md, GLOSSARY.md, DOMAINS.md) and master FEATURES.md that all other commands depend on.

## When to Use

- Setting up a new project with /m:setup
- Re-generating foundational documents for an existing project
- Understanding what foundational documents are required before running /m:plan

## Interview Flow

The setup interview has three stages. Each stage gathers information, presents what was understood, and asks the user to confirm or correct before proceeding.

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in the response. This keeps the agent in control of the flow -- the user answers via the tool, and the agent proceeds to the next question without losing control. Even open-ended questions (like "describe your project") must go through AskUserQuestion so the agent remains the driver of the conversation.

### Stage 1: Project Description

Use AskUserQuestion to ask the user to describe the project. Follow up with qualifying questions as needed, each via AskUserQuestion:

1. "What does this project do?" -- the core functionality
2. "Who uses it?" -- the primary users or audience
3. "What problem does it solve?" -- the motivation

If the user's initial description answers all three, skip the follow-ups. Extract a 1-2 paragraph description for PROJECT.md.

### Stage 2: Tech Stack

The tech stack is organized by **module** -- each application, service, or package gets its own section with the directory path, language, framework, key libraries, and tooling. Shared infrastructure (databases, hosting, CI/CD) and external services go in separate sections.

**If a codebase exists**, scan for tech stack indicators and group findings by module:
1. Identify top-level modules: check `apps/`, `packages/`, `services/`, `cmd/`, or other directory structures that separate distinct applications or services.
2. For each module, detect: directory path, language, framework, build tool, key libraries, styling (if frontend), testing tools, lint/format tools.
3. Detect shared infrastructure: databases, caches, queues, hosting, CI/CD, monitoring, containerization.
4. Detect external services: third-party APIs, LLM providers, payment processors, notification services.
5. Use AskUserQuestion to present the inferred stack organized by module: "I found the following tech stack in your codebase:\n\n{inferred stack grouped by module, then shared infrastructure, then external services}\n\nIs this correct?"

**If no codebase exists**, use AskUserQuestion for each question:
1. "What applications or services make up your project? For each one, what language and framework does it use?" (e.g., "Patient app: React + TypeScript, Backend API: Go + gqlgen")
2. "What database, cache, or queue systems?"
3. "How is the project hosted and what CI/CD do you use?"
4. "Is this a monorepo or multi-repo? What package manager?"

Fill in the TECH-STACK.md template with the confirmed answers, one module section per application/service.

### Stage 3: Actors

**If actors can be inferred** from the project description or codebase (e.g., user roles in auth middleware, admin panels, API consumers), use AskUserQuestion to suggest them: "Based on your project, I identified these actors: ... Do these look correct? Are there others?"

**If actors cannot be inferred**, use AskUserQuestion to ask: "Who interacts with this system? List the roles (human or system) that use it, along with any constraints or permissions."

Fill in the ACTORS.md template with the confirmed actors.

### Stage 4: Domains

Domains are logical boundaries for organizing specs. Every project has at least one domain. A domain can represent a physical app, a backend service, or a logical concern area within a single app.

**If a codebase exists**, infer domains from the project structure:
- Check for `apps/`, `packages/`, or `services/` directories — each subdirectory suggests a domain
- Check for `src/` subdirectories that suggest distinct concern areas
- Check for monorepo workspace configurations (package.json workspaces, pnpm-workspace.yaml)
- Use AskUserQuestion to present the inferred domains: "I found these logical domains in your project:\n\n{domain table}\n\nDomains are logical boundaries for organizing your specs. They can represent physical apps (patient, doctor) or logical concerns (billing, analytics) within a single app. Molcajete treats them all the same way.\n\nDo these look correct?"

**If no codebase exists**, use AskUserQuestion to ask about bounded contexts:
- "What are the logical domains in your project? A domain can be a separate app (patient app, admin console), a service (auth API, billing service), or a concern area within one app (onboarding, analytics).\n\nDomains are logical boundaries for organizing your specs — not deployment boundaries. Molcajete treats all domain types the same way."

**For single-app projects**, suggest one domain using the project name or `app`:
- "This appears to be a single-app project. I'll create one domain: **{project-name-slug}** (type: app). You can add more domains later if your project grows. Does this look correct?"

For each confirmed domain, assign:
- **ID:** Sequential integer (1, 2, 3...)
- **Name:** Short descriptive name (lowercase, kebab-case)
- **Type:** `app`, `service`, or `concern`
- **Description:** One sentence explaining what this domain covers
- **Directory:** `domains/{name}/` (relative path within `prd/`)

After domain confirmation, if more than one domain exists: auto-prepend a `global` domain (ID: 0, Name: global, Type: spec-only, Description: "Cross-cutting concerns that apply to all domains", Directory: domains/global/). For single-domain projects: do NOT add global. The global domain is automatic for multi-domain projects and always listed first.

### Stage 5: Tooling Detection

Scans the codebase for project tooling and runtime configuration. Results are stored in `.molcajete/apps.md` so the build agent knows exactly how to format, lint, test, and run the project. This stage is re-runnable — it overwrites the entire apps.md file with freshly detected values.

**This stage requires a codebase.** If no codebase exists, skip and tell the user: "Tooling detection requires a codebase. Run `/m:setup` again after you have code."

Launch an `Explore` sub-agent to scan for all tooling, then build the settings. The agent should:

#### 5a: Environment Detection

Scan for how the project runs and populate the Runtime, Services, Applications, Modules, Pre-commit Hooks, and Scripts sections of `.molcajete/apps.md` using the [apps-template.md](./templates/apps-template.md) template. All configuration lives in this single human-readable markdown file.

**What to scan:**
- `docker-compose.yml` or `docker-compose*.yml` — extract service names, port mappings, volume mounts
- `Dockerfile` or `Dockerfile.*` — check if containerized
- Pre-commit hooks: husky (`package.json` → `prepare` script, `.husky/`), lefthook (`lefthook.yml`), `.pre-commit-config.yaml`, `.git/hooks/pre-commit`
- Available scripts: `package.json` → `scripts`, Makefile targets, or other task runners
- Project modules: `apps/`, `packages/`, `services/`, `cmd/` directories (reuse module discovery from Stage 2)

For each service found in `docker-compose.yml`, read the port mappings and infer a health check by service type:

| Service Type | Health Check |
|-------------|-------------|
| postgres | `pg_isready -h localhost -p {port}` |
| redis | `redis-cli -p {port} ping` |
| HTTP services (with exposed port) | `curl -sf http://localhost:{port}/health` |
| Other / unknown | leave blank |

Fill in each section of the template with detected values:
- **Runtime:** docker-compose or local, with start/stop commands
- **Services:** infrastructure services (databases, caches, queues) with ports and health checks
- **Applications:** web apps, APIs, and other runnable targets with ports and run commands
- **Modules:** detected project modules with directories and languages
- **Pre-commit Hooks:** detected hook tooling and what it runs
- **Scripts:** available wrapper scripts from package.json, Makefile, etc. (reference only)

If Docker is not detected, check for other patterns (bare `npm run dev`, `go run .`, etc.) and set Runtime type to `local`.

#### 5b: Verification Profile

Detect the BDD framework and unit test runners, then pre-compute exact execution commands for every filtering level the dispatcher needs. Write the results to the **Testing** section of `apps.md`.

**BDD detection:** Identify the BDD framework from step file extensions in `bdd/steps/` and config files (same indicators as 5c BDD tooling detection). Then use knowledge of the framework to fill in command templates.

**Unit test detection:** For each domain with a test runner (detected in 5c), pre-compute commands for each filtering level the framework supports.

Write the **Testing** section of `apps.md` with two subsections:

**BDD subsection** — a metadata list (Framework, Output format, Non-strict flag) followed by a table of scope/command pairs with `{placeholder}` tokens:

| Scope | Command |
|-------|---------|
| Full suite | `behave bdd/ --format json --no-capture` |
| By feature | `behave bdd/features/{feature_id}.feature --format json --no-capture` |
| By scenario | `behave bdd/ --format json --no-capture --tags @{scenario_tag}` |
| By tag expression | `behave bdd/ --format json --no-capture --tags "{tag_expression}"` |

**Unit Tests subsection** — a table per domain with columns: Domain, Framework, Full Suite, By Name, By File/Package.

| Step Extension | Framework | Command Templates |
|---------------|-----------|-------------------|
| `.py` | behave | `behave bdd/` with `--tags`, `--format json`, `--no-capture` |
| `.ts` / `.js` | cucumber-js | `npx cucumber-js` with `--tags`, `--format json` |
| `.go` | godog | `godog` with `--tags`, `--format json` |
| `.rb` | cucumber-ruby | `bundle exec cucumber` with `--tags`, `--format json` |

#### 5c: Per-Domain Tooling + BDD Tooling

**BDD tooling (always detect first):**

The `bdd` row in the Tooling table is mandatory when BDD is configured. It holds format and lint commands for step definition files in `bdd/`. The build agent uses this entry for all `wire-bdd` tasks and for the step definition phase of `implement` tasks.

Also write the BDD framework, language, and format to the **BDD** section of `apps.md`.

Detect BDD step definition language from the apps.md BDD section (or from step file extensions). Then detect format/lint tools for that language in the `bdd/` directory:

| Language | Formatter Detection | Linter Detection |
|----------|-------------------|-----------------|
| Python | Check for `ruff` in `bdd/requirements.txt` or installed globally → `ruff format bdd/`. Otherwise check for `black` → `black bdd/`. If neither found, **warn and suggest installing ruff** (`pip install ruff`). | Check for `ruff` → `ruff check bdd/`. Otherwise `flake8` → `flake8 bdd/`. If neither found, **warn and suggest installing ruff**. |
| TypeScript | Use the same Biome/Prettier/ESLint config as the frontend domains | Same as formatter |
| Go | `gofmt -w bdd/` | `golangci-lint run bdd/` |

**Per-domain tooling:**

For each domain in the project (from `prd/DOMAINS.md` or inferred during setup), detect the format, lint, and test commands available. Map domains to their code directories:
- Frontend app domains → `apps/{name}/` or workspace root for the package
- Backend service domains → `server/` or `services/{name}/`
- Concern domains (like `ui`) → `packages/{name}/` or `components/{name}/`
- `global` domain → skip (spec-only, no tooling)

For each domain, detect:

**Formatter:**
| Config File | Tool | Command Pattern |
|------------|------|----------------|
| `biome.json` or `biome.jsonc` (root or module) | Biome | `cd {root} && npx biome format --write .` |
| `.prettierrc*` | Prettier | `cd {root} && npx prettier --write .` |
| Go module (`go.mod`) | gofmt | `cd {root} && gofmt -w .` |
| `rustfmt.toml` | rustfmt | `cd {root} && cargo fmt` |

**Linter:**
| Config File | Tool | Command Pattern |
|------------|------|----------------|
| `biome.json` (with linter enabled) | Biome | `cd {root} && npx biome lint .` |
| `.eslintrc*` or `eslint.config.*` | ESLint | `cd {root} && npx eslint .` |
| `.golangci.yml` or `.golangci.yaml` | golangci-lint | `cd {root} && golangci-lint run ./...` |
| `clippy` in Cargo.toml | Clippy | `cd {root} && cargo clippy` |

**Test runner:**
| Config File | Tool | Command Pattern |
|------------|------|----------------|
| `vitest.config.*` or vitest in package.json | Vitest | `cd {root} && npx vitest run` |
| `jest.config.*` or jest in package.json | Jest | `cd {root} && npx jest` |
| `go.mod` (Go module) | go test | `cd {root} && go test ./...` |
| `pytest.ini` or `pyproject.toml` with pytest | pytest | `cd {root} && pytest` |

**Command Resolution — always store direct tool commands, never wrappers:**

1. **Detect the tool** from config files (unchanged — use the tables above)
2. **Inspect wrappers** if a Makefile target or pnpm script exists for that tool:
   - Read the Makefile rule or `package.json` script entry
   - Extract the underlying binary being invoked (e.g., `gofmt`, `golangci-lint`, `biome`, `vitest`)
   - Extract any flags, paths, or environment variables the wrapper adds
3. **Compose a direct command** using the tool binary + extracted flags, scoped with `cd {domain_root} &&` when the tool must run from the domain's directory
4. **Fallback:** If the wrapper is too complex or dynamic to parse (e.g., multi-line shell scripts, conditional logic), fall back to the raw tool command with standard flags based on the tool's documentation

Never store `make`, `make -C`, or `pnpm --filter` commands in the Tooling table. The table must contain the exact tool binary invocation so the build agent is not coupled to wrapper scripts that may change.

Write the results to the **Tooling** section of `apps.md` as a table:

| Domain | Root | Language | Format | Lint |
|--------|------|----------|--------|------|
| bdd | `bdd/` | python | `ruff format bdd/` | `ruff check bdd/` |
| server | `server/` | go | `cd server && gofmt -w .` | `cd server && golangci-lint run ./...` |
| patient | `apps/patient/` | typescript | `cd apps/patient && npx biome format --write .` | `cd apps/patient && npx biome lint .` |

#### 5d: Warnings

After detection, check for gaps and produce warnings:

- Domain has no formatter detected → warn: "No formatter detected for '{domain}'. Consider adding Biome (JS/TS) or gofmt (Go)."
- Domain has no linter detected → warn: "No linter detected for '{domain}'. Consider adding Biome (JS/TS) or golangci-lint (Go)."
- Domain has no test runner detected → warn: "No test runner detected for '{domain}'."
- BDD step definitions have no formatter/linter → warn: "No formatter/linter detected for BDD step definitions ({language}). Consider installing ruff (Python), or biome (TypeScript)." **Also offer to install it** via AskUserQuestion: "Would you like me to install ruff for Python step definitions? I can add it to bdd/requirements.txt and install it."
- No Docker or runtime detected → warn: "No development environment detected. The build agent won't know how to start services."
- BDD framework detected but no BDD make target or run command → warn: "BDD framework detected but no `bdd` or `test:e2e` script found for running tests."

Write warnings to the **Warnings** section of `apps.md` as a bulleted list:

```markdown
## Warnings

- No test runner detected for 'ui' domain.
```

#### 5e: Confirmation and Write

Present the detected tooling to the user via AskUserQuestion:

```
I detected the following project tooling:

**Environment** (will be saved to `.molcajete/apps.md`):
| Service | Port | Health Check |
|---------|------|-------------|
| postgres | 5432 | pg_isready -h localhost -p 5432 |
| redis | 6379 | redis-cli -p 6379 ping |
| server-dev | 8080 | curl -sf http://localhost:8080/health |
| nginx | 80 | — |

  Runtime: docker-compose | Start: docker compose up -d | Stop: docker compose down

**Tooling:**
| Domain | Format | Lint |
|--------|--------|------|
| bdd (step defs) | ruff format bdd/ | ruff check bdd/ |
| server | cd server && gofmt -w . | cd server && golangci-lint run ./... |
| patient | cd apps/patient && npx biome format --write . | cd apps/patient && npx biome lint . |
| ... | ... | ... |

**Verification:**
- BDD: behave (Python) — filter by feature, scenario tag, or tag expression; JSON output
- Unit (server): go test — filter by name or package; JSON output
- Unit (patient): vitest — filter by name or file; JSON output

**Warnings:**
- No test runner detected for 'ui' domain.

Does this look correct? You can adjust specific commands.
```

Options:
- "Yes, save it" -- write apps.md
- "Needs changes" -- user provides corrections via Other

After confirmation, write `.molcajete/apps.md` with all detected configuration — Runtime, Services, Applications, Modules, BDD, Tooling, Testing, Pre-commit Hooks, Scripts, Warnings, and Notes sections. Create the `.molcajete/` directory if it does not exist.

## Codebase Detection

### Module Discovery

When a codebase exists, first identify the project's modules -- each application, service, or package that has its own tech stack:

| Structure Pattern | Module Source |
|------------------|--------------|
| `apps/*/` | Each subdirectory is a module (monorepo apps) |
| `packages/*/` | Each subdirectory is a module (monorepo packages) |
| `services/*/` | Each subdirectory is a module (microservices) |
| `cmd/*/` | Each subdirectory is a module (Go services) |
| Single root `package.json` + `src/` | One module at root |
| Single root `go.mod` + `main.go` | One module at root |

For each identified module, run the tech stack indicators below scoped to that module's directory. Also run them at the project root for shared config.

### Tech Stack Indicators

| Indicator File | Infers |
|---------------|--------|
| `package.json` | Node.js; check `dependencies` for framework (next, express, fastify, etc.) |
| `tsconfig.json` | TypeScript |
| `go.mod` | Go; check module path for framework indicators |
| `Cargo.toml` | Rust |
| `Gemfile` | Ruby; check for `rails` |
| `requirements.txt` or `pyproject.toml` | Python; check for `django`, `fastapi`, `flask` |
| `pom.xml` or `build.gradle` | Java/Kotlin |
| `docker-compose.yml` | Infrastructure services (databases, caches, queues) |
| `prisma/schema.prisma` | Prisma ORM + database type from `provider` |
| `drizzle.config.ts` | Drizzle ORM |
| `.github/workflows/*.yml` | GitHub Actions CI/CD |
| `vercel.json` or `netlify.toml` | Hosting platform |
| `tailwind.config.*` | Tailwind CSS |
| `biome.json` | Biome formatter/linter |

Read `package.json` dependencies to detect frontend frameworks (React, Next.js, Vue, Svelte) and state management libraries (Zustand, Redux, urql, Apollo).

### Actor Indicators

Scan the codebase for actor evidence:

| Pattern | Suggests Actor |
|---------|---------------|
| Auth middleware with role checks | Role-based actors (admin, user, guest) |
| Admin panel routes or components | Admin actor |
| API key validation | External system / API consumer actor |
| Public vs. authenticated routes | Guest vs. authenticated user actors |
| Webhook handlers | External system actor |
| Multi-tenant patterns | Tenant/organization actor |

These are suggestions only -- always confirm with the user.

## Confirmation Rules

1. Never write documents without user confirmation
2. Use AskUserQuestion for every confirmation -- never ask as plain text
3. Present inferred values section-by-section, not all at once
4. For each section: show what was extracted, use AskUserQuestion to ask "Does this look correct?"
5. If the user corrects a value, update it and move to the next section
6. After all sections are confirmed, generate all documents at once

## Document Generation

After the interview, generate these documents in order. **All global files go directly in `prd/`.** Per-domain files go in `prd/domains/{domain}/`.

| Order | Document | Template | Location |
|-------|----------|----------|----------|
| 1 | PROJECT.md | [PROJECT-template.md](./templates/PROJECT-template.md) | `prd/PROJECT.md` |
| 2 | TECH-STACK.md | [TECH-STACK-template.md](./templates/TECH-STACK-template.md) | `prd/TECH-STACK.md` |
| 3 | ACTORS.md | [ACTORS-template.md](./templates/ACTORS-template.md) | `prd/ACTORS.md` |
| 4 | GLOSSARY.md | [GLOSSARY-template.md](./templates/GLOSSARY-template.md) | `prd/GLOSSARY.md` |
| 5 | DOMAINS.md | [DOMAINS-template.md](./templates/DOMAINS-template.md) | `prd/DOMAINS.md` |
| 6 | FEATURES.md | [FEATURES-template.md](./templates/FEATURES-template.md) | `prd/FEATURES.md` |

After generating all documents, create `prd/domains/{domain}/features/` for each domain (including global).

### GLOSSARY.md Starter Terms

When generating GLOSSARY.md, include these starter terms (adapted to the project's domain):

- **Command** -- the project's primary interaction unit (if applicable)
- **Domain** -- a logical bounded context for organizing specs (app, service, or concern area)
- **Feature** -- a permanent, named capability of the system
- **Use Case** -- a specific interaction between an actor and the system
- **Actor** -- a role (human or system) that participates in use cases

Add 3-5 additional terms extracted from the project description and tech stack (e.g., the database name, the primary framework, domain-specific terms the user mentioned).

### FEATURES.md Initial State

Generate one master FEATURES.md at `prd/FEATURES.md` with `## global` section first (if global domain exists), then one `## {domain}` section per real domain. All tables start empty. No features are populated at setup time -- they are added by /m:feature or /m:spec.

## Regeneration

If `prd/PROJECT.md` already exists when /m:setup is run:
1. Ask the user what they want to do. Options:
   - **"Regenerate all"** -- full interview, regenerate PRD documents + tooling detection
   - **"Update tooling only"** -- skip PRD interview, jump directly to Stage 5 (Tooling Detection). This re-scans Makefiles, package.json scripts, Docker configs, formatter/linter configs, and updates `.molcajete/apps.md` without touching any PRD documents. Use this after installing new packages, adding new tools, or changing how the project runs.
   - **"No changes"** -- stop without changes
2. If "Regenerate all", proceed with the full interview (Stages 1-5)
3. If "Update tooling only", read `prd/DOMAINS.md` to get the domain list, then jump to Stage 5
4. If "No changes", stop

## Template Reference

| Template | Purpose |
|----------|---------|
| [PROJECT-template.md](./templates/PROJECT-template.md) | PROJECT.md structure |
| [TECH-STACK-template.md](./templates/TECH-STACK-template.md) | TECH-STACK.md structure |
| [ACTORS-template.md](./templates/ACTORS-template.md) | ACTORS.md structure |
| [GLOSSARY-template.md](./templates/GLOSSARY-template.md) | GLOSSARY.md structure |
| [DOMAINS-template.md](./templates/DOMAINS-template.md) | DOMAINS.md structure |
| [FEATURES-template.md](./templates/FEATURES-template.md) | Master FEATURES.md structure (sectioned by domain) |
