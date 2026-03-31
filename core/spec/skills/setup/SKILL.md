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

Scans the codebase for project tooling and runtime configuration. Results are stored in `.molcajete/settings.json` so the build agent knows exactly how to format, lint, test, and run the project. This stage is re-runnable -- it merges with existing settings, never overwrites unrelated keys.

**This stage requires a codebase.** If no codebase exists, skip and tell the user: "Tooling detection requires a codebase. Run `/m:setup` again after you have code."

Launch an `Explore` sub-agent to scan for all tooling, then build the settings. The agent should:

#### 5a: Environment Detection

Scan for how the project runs:
- `docker-compose.yml` or `docker-compose*.yml` -- extract service names, ports, volume mounts
- `Dockerfile` or `Dockerfile.*` -- check if containerized
- Check if dev and test environments are separate (e.g., `server-dev` vs `server-test` services)

Produce an `environment` block:

```json
{
  "environment": {
    "runtime": "docker-compose",
    "compose_file": "docker-compose.yml",
    "services": ["nginx", "server-dev", "server-test", "postgres", "redis"],
    "start": "make dev-d",
    "stop": "make dev-down",
    "detected_at": "2026-03-31T10:00:00Z"
  }
}
```

If Docker is not detected, check for other patterns (bare `npm run dev`, `go run .`, etc.) and set `runtime` to `"local"`.

#### 5b: Script and Target Discovery

**Makefiles:** Read all Makefiles (`Makefile`, `*/Makefile`) and extract target names. For each target, record the target name and its containing Makefile path.

**pnpm / npm scripts:** Read root `package.json` and per-workspace `package.json` files. Extract script names from the `scripts` field. Group by workspace.

Produce a `scripts` block:

```json
{
  "scripts": {
    "make_targets": {
      "root": ["dev", "dev-d", "dev-down", "bdd", "bdd-up", "init", "verify-dual-env"],
      "server": ["build", "run", "test", "fmt", "lint", "generate-patient", "generate-doctor", "generate-console", "migrate-up", "migrate-down", "migrate-create"]
    },
    "pnpm_scripts": {
      "root": ["dev", "build", "lint", "lint:fix", "format", "test", "validate", "i18n:extract", "i18n:compile"],
      "patient": ["dev", "build", "lint", "lint:fix", "format", "test", "validate"],
      "doctor": ["dev", "build", "lint", "lint:fix", "format", "test", "validate"],
      "console": ["dev", "build", "lint", "lint:fix", "format", "test", "validate"]
    }
  }
}
```

#### 5c: Per-Domain Tooling + BDD Tooling

**BDD tooling (always detect first):**

The `tooling.bdd` entry is mandatory when BDD is configured. It holds format and lint commands for step definition files in `bdd/`. The build agent uses this entry for all `wire-bdd` tasks and for the step definition phase of `implement` tasks.

Detect BDD step definition language from `.molcajete/settings.json` → `bdd.language` (or from step file extensions). Then detect format/lint tools for that language in the `bdd/` directory:

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
| `biome.json` or `biome.jsonc` (root or module) | Biome | `pnpm biome format --write .` or `npx biome format --write .` |
| `.prettierrc*` | Prettier | `pnpm prettier --write .` or `npx prettier --write .` |
| Go module (`go.mod`) | gofmt | `gofmt -w .` or `make fmt` (if Makefile has `fmt` target) |
| `rustfmt.toml` | rustfmt | `cargo fmt` |

**Linter:**
| Config File | Tool | Command Pattern |
|------------|------|----------------|
| `biome.json` (with linter enabled) | Biome | `pnpm biome check .` or `pnpm biome lint .` |
| `.eslintrc*` or `eslint.config.*` | ESLint | `pnpm eslint .` or `npx eslint .` |
| `.golangci.yml` or `.golangci.yaml` | golangci-lint | `golangci-lint run` or `make lint` |
| `clippy` in Cargo.toml | Clippy | `cargo clippy` |

**Test runner:**
| Config File | Tool | Command Pattern |
|------------|------|----------------|
| `vitest.config.*` or vitest in package.json | Vitest | `pnpm vitest run` or `npx vitest run` |
| `jest.config.*` or jest in package.json | Jest | `pnpm jest` or `npx jest` |
| `go.mod` (Go module) | go test | `go test ./...` or `make test` |
| `pytest.ini` or `pyproject.toml` with pytest | pytest | `pytest` |

**Prefer Makefile targets** when they exist. If `server/Makefile` has `fmt` and `lint` targets, use `make -C server fmt` and `make -C server lint` rather than the raw tool commands. Makefiles are the project's chosen orchestration layer and may include flags, paths, or setup that raw commands miss.

**Prefer pnpm filter commands** for monorepo workspaces when the script exists in the workspace's package.json. Use `pnpm --filter {package-name} {script}` rather than `cd apps/foo && npx biome ...`.

Produce a `tooling` block:

```json
{
  "tooling": {
    "bdd": {
      "root": "bdd/",
      "language": "python",
      "format": { "command": "ruff format bdd/", "tool": "ruff" },
      "lint": { "command": "ruff check bdd/", "tool": "ruff" }
    },
    "server": {
      "root": "server/",
      "language": "go",
      "format": { "command": "make -C server fmt", "tool": "gofmt" },
      "lint": { "command": "make -C server lint", "tool": "golangci-lint" },
      "test": { "command": "make -C server test", "tool": "go test" }
    },
    "patient": {
      "root": "apps/patient/",
      "language": "typescript",
      "format": { "command": "pnpm --filter patient format", "tool": "biome" },
      "lint": { "command": "pnpm --filter patient lint", "tool": "biome" },
      "test": { "command": "pnpm --filter patient test", "tool": "vitest" }
    }
  }
}
```

#### 5d: Warnings

After detection, check for gaps and produce warnings:

- Domain has no formatter detected → warn: "No formatter detected for '{domain}'. Consider adding Biome (JS/TS) or gofmt (Go)."
- Domain has no linter detected → warn: "No linter detected for '{domain}'. Consider adding Biome (JS/TS) or golangci-lint (Go)."
- Domain has no test runner detected → warn: "No test runner detected for '{domain}'."
- BDD step definitions have no formatter/linter → warn: "No formatter/linter detected for BDD step definitions ({language}). Consider installing ruff (Python), or biome (TypeScript)." **Also offer to install it** via AskUserQuestion: "Would you like me to install ruff for Python step definitions? I can add it to bdd/requirements.txt and install it."
- No Docker or runtime detected → warn: "No development environment detected. The build agent won't know how to start services."
- BDD framework detected but no BDD make target or run command → warn: "BDD framework detected but no `bdd` or `test:e2e` script found for running tests."

Store warnings in settings:

```json
{
  "warnings": [
    "No test runner detected for 'ui' domain."
  ]
}
```

#### 5e: Confirmation and Write

Present the detected tooling to the user via AskUserQuestion:

```
I detected the following project tooling:

**Environment:** docker-compose (services: nginx, server-dev, postgres, redis)
  Start: make dev-d | Stop: make dev-down

**Tooling:**
| Scope | Format | Lint | Test |
|-------|--------|------|------|
| bdd (step defs) | ruff format bdd/ | ruff check bdd/ | — |
| server | make -C server fmt (gofmt) | make -C server lint (golangci-lint) | make -C server test (go test) |
| patient | pnpm --filter patient format (biome) | pnpm --filter patient lint (biome) | pnpm --filter patient test (vitest) |
| ... | ... | ... | ... |

**Warnings:**
- No test runner detected for 'ui' domain.

**Available scripts:** {count} Make targets, {count} pnpm scripts

Does this look correct? You can adjust specific commands.
```

Options:
- "Yes, save it" -- write to `.molcajete/settings.json`
- "Needs changes" -- user provides corrections via Other

After confirmation, merge the detected settings into `.molcajete/settings.json`. Create the file if it does not exist. Merge keys -- never overwrite the entire file. Include `detected_at` timestamps on each section.

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
   - **"Update tooling only"** -- skip PRD interview, jump directly to Stage 5 (Tooling Detection). This re-scans Makefiles, package.json scripts, Docker configs, formatter/linter configs, and updates `.molcajete/settings.json` without touching any PRD documents. Use this after installing new packages, adding new tools, or changing how the project runs.
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
