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

### Stage 5: Hook Generation

Scans the codebase for project tooling and runtime configuration. Results are baked into executable hook scripts in `.molcajete/hooks/`. Each hook handles one checkpoint — no configuration file needed. This stage is re-runnable — it overwrites existing hooks with freshly detected values (unless `--no-overwrite` is set).

**This stage requires a codebase.** If no codebase exists, skip and tell the user: "Hook generation requires a codebase. Run `/m:setup` again after you have code."

**Detection philosophy:** The Explore agent reads project manifests (docker-compose.yml, package.json, pyproject.toml, Makefile, .env.example, Dockerfile, etc.) to understand what technologies the project uses and how it's composed. From that understanding, it derives the direct tool commands that Molcajete needs. It never stores wrapper commands (make, npm run, pnpm --filter). Makefiles and package.json scripts are read only to discover which underlying tools are in use.

**Security rule:** Never hardcode secrets, passwords, API keys, or environment variable values into hook scripts. If a port, host, or credential comes from a `.env` file or environment section, reference it via `process.env.VAR_NAME` with a sensible default fallback. Example: if a service maps `${POSTGRES_PORT:-5432}:5432`, the health check uses `` `pg_isready -h localhost -p ${process.env.POSTGRES_PORT || 5432}` ``. Hooks call `loadEnv('.env')` to make env vars available for health checks and log commands.

**Technology agnosticism:** All detection rules and examples must present multiple technology paths, not bias toward any single one. Every detection section (5a, 5b, 5c) must show examples for at least two different environments. The reasoning pattern is the same — "I found X, therefore the command is Y" — but the source artifacts and resulting commands differ.

Launch an `Explore` sub-agent to scan for all tooling, then generate hooks. The agent should:

#### 5a: Environment Detection → `health-check`, `start`, `stop`, `logs` Hooks

Read project manifests to understand how the development environment is composed, then derive direct commands for starting, stopping, health-checking, and retrieving logs from services.

**What to scan and why:**
- `docker-compose.yml` / `docker-compose*.yml` — the primary source for understanding services. Extract service names, images, port mappings, and dependencies. From this you know: the start command is `docker compose up -d`, the stop command is `docker compose down`, and each service has a known health-check pattern.
- `Dockerfile` / `Dockerfile.*` — confirms containerized services and reveals exposed ports.
- `.env.example` / `.env.sample` — reveals environment variables and connection strings that confirm service types and ports.
- `Makefile` — read targets only to discover what underlying tools are invoked (e.g., a `db` target that runs `docker compose up -d postgres` tells you postgres is a dependency). Never use the Makefile target itself as the command.
- `package.json` scripts — read only to discover what tool a script wraps (e.g., `"dev": "next dev -p 3000"` tells you the app server is Next.js on port 3000). Never use `npm run dev` as the command — use `npx next dev -p 3000`.

**Reasoning flow — Docker Compose projects:** From Docker Compose, identify each service (postgres, redis, app containers), extract their port mappings, and derive per-service health checks. Use `process.env.VAR_NAME` with fallback defaults for ports (never hardcode values from `.env`):

| Service Type | Health Check |
|-------------|-------------|
| postgres | `` `pg_isready -h localhost -p ${process.env.POSTGRES_PORT \|\| 5432}` `` |
| redis | `` `redis-cli -p ${process.env.REDIS_PORT \|\| 6379} ping` `` |
| HTTP services (with exposed port) | `` `curl -sf http://localhost:${process.env.APP_PORT \|\| 3000}/health` `` |
| Other / unknown | leave blank |

**Reasoning flow — host-native projects:** If no Docker Compose is found, check for other patterns (e.g., a package.json script that starts a dev server, a Go binary with a dev flag). Derive the raw tool command, not the script wrapper. For host-native projects, health checks use direct commands (e.g., `curl -sf http://localhost:3000/api/health`), start/stop manage the process directly, and logs read from file or stdout.

**health-check.mjs:** Read the template at [health-check.mjs.template](./templates/hooks/health-check.mjs.template) and replace the `__SERVICES_PLACEHOLDER__` comment with the detected services array. Each service uses `process.env` references for ports. Write to `.molcajete/hooks/health-check.mjs` and make it executable (`chmod +x`).

**start.mjs:** Read the template at [start.mjs.template](./templates/hooks/start.mjs.template) and replace the `__START_COMMAND__` placeholder with the detected start command (e.g., `docker compose up -d`). Write to `.molcajete/hooks/start.mjs` and make it executable.

**stop.mjs:** Read the template at [stop.mjs.template](./templates/hooks/stop.mjs.template) and replace the `__STOP_COMMAND__` placeholder with the detected stop command (e.g., `docker compose down`). Write to `.molcajete/hooks/stop.mjs` and make it executable.

**logs.mjs:** Read the template at [logs.mjs.template](./templates/hooks/logs.mjs.template). For Docker Compose projects, set `__LOGS_COMMAND__` to `docker compose logs` and populate `__SERVICE_MAP_PLACEHOLDER__` from docker-compose.yml service names, mapping domain aliases to container service names. For host-native projects, set `__LOGS_COMMAND__` to the appropriate log retrieval command (e.g., `tail -n` for file-based logs). Write to `.molcajete/hooks/logs.mjs` and make executable.

If no Docker Compose or service manager is found, still generate `start.mjs` and `stop.mjs` with placeholder commands — the user can fill them in.

#### 5b: Verification Profile → `run-tests` Hook

Understand which BDD framework the project uses by reading dependency manifests, then derive the exact test command with Molcajete-optimal flags.

**Technology-first detection:** Check multiple indicators to identify the BDD framework — don't rely solely on step file extensions:

| Indicator | Framework | Command | Tags Flag | Format Flags |
|-----------|-----------|---------|-----------|-------------|
| Indicator | Framework | Command | Tags Flag | Format Flags | Tag Join |
|-----------|-----------|---------|-----------|-------------|----------|
| `behave` in `requirements.txt` / `pyproject.toml` / `bdd/requirements.txt` | behave | `behave bdd/` | `--tags` | `--format json --no-capture` | `' or '` |
| `@cucumber/cucumber` in `package.json` dependencies | cucumber-js | `npx cucumber-js` | `--tags` | `--format json` | `' or '` |
| `github.com/cucumber/godog` in `go.mod` | godog | `godog` | `--tags` | `--format json` | `' or '` |
| `cucumber` in `Gemfile` | cucumber-ruby | `bundle exec cucumber` | `--tags` | `--format json` | `' or '` |

Also confirm by checking that step files exist (in `bdd/steps/` or framework-conventional directories) and locating the feature files directory (usually `bdd/features/`).

**Example reasoning:** "Found `behave` in `bdd/requirements.txt` → BDD framework is Behave → command: `behave bdd/` → tags flag: `--tags` → format flags: `--format json --no-capture` → tag join: `' or '`."

Read the template at [run-tests.mjs.template](./templates/hooks/run-tests.mjs.template) and replace the `__BDD_COMMAND__`, `__TAGS_FLAG__`, `__FORMAT_FLAGS__`, and `__TAG_JOIN__` placeholders. The `__TAG_JOIN__` value must be a quoted string (e.g., `' or '`) — the hook joins the tags array with this separator before passing to the BDD runner. Write to `.molcajete/hooks/run-tests.mjs` and make it executable.

Also write BDD settings (framework, language, format) to `.molcajete/settings.json` for other commands that need BDD metadata (gherkin skill cache). The same file supports build settings (`useWorktrees`, `allowParallelTasks`, `startTimeout`) — these are read with defaults and do not need to be written by setup.

#### 5c: Per-Domain Tooling → `format` and `lint` Hooks

Detect format and lint tools per domain by reading config files and dependency manifests, then generate `format.mjs` and `lint.mjs` hooks with all domain entries baked in.

**BDD tooling (always detect first):**

Identify the BDD step definition language (from 5b), then detect format/lint tools for that language in the `bdd/` directory:

| Language | Formatter Detection | Linter Detection |
|----------|-------------------|-----------------|
| Python | Check for `ruff` in `bdd/requirements.txt` or installed globally → `ruff format --check bdd/`. Otherwise check for `black` → `black --check bdd/`. If neither found, **warn and suggest installing ruff** (`pip install ruff`). | Check for `ruff` → `ruff check bdd/`. Otherwise `flake8` → `flake8 bdd/`. If neither found, **warn and suggest installing ruff**. |
| TypeScript | Use the same Biome/Prettier/ESLint config as the frontend domains | Same as formatter |
| Go | `gofmt -l bdd/` | `golangci-lint run bdd/` |

**Per-domain tooling:**

For each domain in the project (from `prd/DOMAINS.md` or inferred during setup), detect the format and lint commands available. Map domains to their code directories:
- Frontend app domains → `apps/{name}/` or workspace root for the package
- Backend service domains → `server/` or `services/{name}/`
- Concern domains (like `ui`) → `packages/{name}/` or `components/{name}/`
- `global` domain → skip (spec-only, no tooling)

For each domain, detect:

**Formatter (check mode — hooks must NOT write files):**
| Config File | Tool | Check Command Pattern |
|------------|------|----------------------|
| `biome.json` or `biome.jsonc` | Biome | `cd {root} && npx biome format --check .` |
| `.prettierrc*` | Prettier | `cd {root} && npx prettier --check .` |
| Go module (`go.mod`) | gofmt | `cd {root} && gofmt -l .` |
| `rustfmt.toml` | rustfmt | `cd {root} && cargo fmt --check` |

**Linter (report mode — hooks must NOT use --fix):**
| Config File | Tool | Command Pattern |
|------------|------|----------------|
| `biome.json` (with linter enabled) | Biome | `cd {root} && npx biome lint .` |
| `.eslintrc*` or `eslint.config.*` | ESLint | `cd {root} && npx eslint .` |
| `.golangci.yml` or `.golangci.yaml` | golangci-lint | `cd {root} && golangci-lint run ./...` |
| `clippy` in Cargo.toml | Clippy | `cd {root} && cargo clippy` |

**Command Resolution — understand the technology, then derive direct commands:**

1. **Detect the tool** from config files (use the tables above).
2. **Read Makefiles and package.json scripts only to discover which tools are installed** — e.g., a Makefile target that runs `ruff format` tells you ruff is the formatter; a package.json script `"lint": "biome lint ."` tells you Biome is the linter. Extract the underlying binary and any project-specific flags or paths.
3. **Construct the direct tool command** from the detected binary + extracted flags. The hook stores `ruff format --check bdd/`, never `make format` or `pnpm run lint`.

Never store `make`, `make -C`, `npm run`, or `pnpm --filter` commands. Hooks must contain the exact tool binary invocation.

**File-aware routing:** Each formatter/linter entry includes a `service` name, a `glob` pattern (e.g., `server/**/*.go`), a `command` with `{files}` placeholder (e.g., `cd server && gofmt -l {files}`), and a `fallback` command for when no files are passed (e.g., `cd server && gofmt -l .`). The glob is derived from the service's root directory and the language's file extensions. The template auto-strips the service prefix from file paths when the command starts with `cd {dir} &&` — e.g., input path `bdd/features/steps/foo.py` becomes `features/steps/foo.py` after `cd bdd`.

**Worktree awareness:** Hooks inherit their working directory from the orchestrator. During validation, the orchestrator sets `cwd` to the worktree path so hooks operate on the correct files. Hooks must NOT use `process.chdir()` to override the working directory — doing so breaks worktree builds by pointing at the main repo instead of the worktree where new files exist. However, hooks SHOULD compute `repoRoot` from `__dirname` (since hooks live in the main repo at `.molcajete/hooks/`) to resolve tool binary paths — virtual environments (`.venv/bin/`) and `node_modules/.bin/` only exist in the main repo, not in worktrees. The templates include a `.venv/bin/` resolver that replaces relative tool paths with absolute paths from `repoRoot`.

Read the templates at [format.mjs.template](./templates/hooks/format.mjs.template) and [lint.mjs.template](./templates/hooks/lint.mjs.template). Replace the `__FORMAT_CONFIG_PLACEHOLDER__` / `__LINT_CONFIG_PLACEHOLDER__` comments with the detected entries array using the `{ service, glob, command, fallback }` format. Write to `.molcajete/hooks/format.mjs` and `.molcajete/hooks/lint.mjs` and make them executable.

#### 5d: Warnings

After detection, check for gaps and print warnings to the console:

- Domain has no formatter detected → warn: "No formatter detected for '{domain}'. Consider adding Biome (JS/TS) or gofmt (Go)."
- Domain has no linter detected → warn: "No linter detected for '{domain}'. Consider adding Biome (JS/TS) or golangci-lint (Go)."
- BDD step definitions have no formatter/linter → warn: "No formatter/linter detected for BDD step definitions ({language}). Consider installing ruff (Python), or biome (TypeScript)." **Also offer to install it** via AskUserQuestion.
- No Docker or runtime detected → warn: "No development environment detected. The build agent won't know how to start services."

#### 5e: Confirmation

Present the detected hooks to the user via AskUserQuestion. Every hook must show its exact command in a flat table so the user sees precisely what will execute. Show examples appropriate to the detected project type:

**Example A (Docker Compose project):**

```
I detected the following project tooling. Here's what each hook will run:

| Hook | Command |
|------|---------|
| `start` | `docker compose up -d` |
| `stop` | `docker compose down` |
| `health-check` | postgres: `pg_isready -h localhost -p ${POSTGRES_PORT\|5432}`, redis: `redis-cli -p ${REDIS_PORT\|6379} ping` |
| `logs` | `docker compose logs {service} --tail {lines}` (services: postgres, redis, app) |
| `run-tests` | `behave bdd/ --tags {tags} --format json --no-capture` |
| `format` | bdd: `ruff format --check {files\|bdd/}` (glob: `bdd/**/*.py`), server: `cd server && gofmt -l {files\|.}` (glob: `server/**/*.go`) |
| `lint` | bdd: `ruff check {files\|bdd/}` (glob: `bdd/**/*.py`), server: `cd server && golangci-lint run {files\|./...}` (glob: `server/**/*.go`) |
```

**Example B (host-native Node.js project):**

```
I detected the following project tooling. Here's what each hook will run:

| Hook | Command |
|------|---------|
| `start` | `npx next dev -p 3000` (background) |
| `stop` | kill process on port 3000 |
| `health-check` | app: `curl -sf http://localhost:3000/api/health` |
| `logs` | `tail -n {lines} .next/server.log` |
| `run-tests` | `npx cucumber-js --tags {tags} --format json` |
| `format` | app: `npx biome format --check {files\|src/}` (glob: `src/**/*.{ts,tsx}`) |
| `lint` | app: `npx biome lint {files\|src/}` (glob: `src/**/*.{ts,tsx}`) |
```

Always append warnings at the bottom if any:

```
**Warnings:**
- No formatter detected for 'ui'. Consider adding Biome.

Does this look correct? You can adjust any command.
```

Options:
- "Yes, save it" -- write hooks
- "Needs changes" -- user provides corrections via Other

After confirmation, write the hook scripts to `.molcajete/hooks/` and make them executable. Create the `.molcajete/hooks/` directory if it does not exist.

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
   - **"Update hooks only"** -- skip PRD interview, jump directly to Stage 5 (Hook Generation). This re-scans Docker configs, formatter/linter configs, BDD frameworks, and regenerates `.molcajete/hooks/` without touching any PRD documents. Use this after installing new packages, adding new tools, or changing how the project runs.
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
| [hooks/start.mjs.template](./templates/hooks/start.mjs.template) | Start dev environment (generated by setup) |
| [hooks/stop.mjs.template](./templates/hooks/stop.mjs.template) | Stop dev environment (generated by setup) |
| [hooks/health-check.mjs.template](./templates/hooks/health-check.mjs.template) | Health check (generated by setup) |
| [hooks/run-tests.mjs.template](./templates/hooks/run-tests.mjs.template) | BDD test runner (generated by setup) |
| [hooks/format.mjs.template](./templates/hooks/format.mjs.template) | Formatter check (generated by setup) |
| [hooks/lint.mjs.template](./templates/hooks/lint.mjs.template) | Linter report (generated by setup) |
| [hooks/logs.mjs.template](./templates/hooks/logs.mjs.template) | Log retrieval (generated by setup) |
| [hooks/restart.mjs.template](./templates/hooks/restart.mjs.template) | Restart dev environment (optional, user reference) |
| [hooks/create-worktree.mjs.template](./templates/hooks/create-worktree.mjs.template) | Git worktree creation (optional, user reference) |
| [hooks/cleanup.mjs.template](./templates/hooks/cleanup.mjs.template) | Worktree + branch removal (optional, user reference) |
| [hooks/merge.mjs.template](./templates/hooks/merge.mjs.template) | Merge branch to base (optional, user reference) |
| [hooks/before-worktree-created.mjs.template](./templates/hooks/before-worktree-created.mjs.template) | Pre-worktree-creation lifecycle event (optional, user reference) |
| [hooks/after-worktree-created.mjs.template](./templates/hooks/after-worktree-created.mjs.template) | Post-worktree-creation lifecycle event (optional, user reference) |
| [hooks/before-worktree-merged.mjs.template](./templates/hooks/before-worktree-merged.mjs.template) | Pre-merge lifecycle event (optional, user reference) |
| [hooks/after-worktree-merged.mjs.template](./templates/hooks/after-worktree-merged.mjs.template) | Post-merge lifecycle event (optional, user reference) |
| [hooks/before-task.mjs.template](./templates/hooks/before-task.mjs.template) | Pre-task lifecycle event (optional, user reference) |
| [hooks/after-task.mjs.template](./templates/hooks/after-task.mjs.template) | Post-task lifecycle event (optional, user reference) |
| [hooks/before-validate.mjs.template](./templates/hooks/before-validate.mjs.template) | Pre-validation lifecycle event (optional, user reference) |
| [hooks/after-validate.mjs.template](./templates/hooks/after-validate.mjs.template) | Post-validation lifecycle event (optional, user reference) |
| [hooks/before-commit.mjs.template](./templates/hooks/before-commit.mjs.template) | Pre-commit lifecycle event (optional, user reference) |
| [hooks/after-commit.mjs.template](./templates/hooks/after-commit.mjs.template) | Post-commit lifecycle event (optional, user reference) |
