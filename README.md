# Molcajete.ai

A Claude Code plugin that turns product specs into working, tested software — powered by BDD as the done signal.

You write the spec. Molcajete plans the work, implements it, reviews it, and commits it — task by task — until every scenario passes.

## How It Works

Molcajete operates in three phases:

**Spec** reads your intent and produces structured specs — features with EARS requirements, use cases with scenario blocks, and Gherkin feature files. Everything lands in a `prd/` folder that becomes the permanent source of truth.

**Plan** decomposes use cases into an implementation plan — ordered tasks with dependencies, context budgets, and done signals.

**Build** picks up a plan and dispatches tasks one at a time. Each task runs in its own worktree with a dedicated agent, passes through a 5-gate adversarial review, and merges back automatically. The loop continues until all BDD scenarios pass.

There is also a **reverse** path: point Molcajete at an existing codebase and it will extract specs from the code, then wire BDD tests to what already exists.

## Prerequisites

- Node.js >= 20
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Installation

```bash
pnpm add -g molcajete
```

Or install from source:

```bash
git clone <repo-url>
cd molcajete-v3
pnpm install
pnpm build
pnpm link --global
```

## Building from Source

```bash
pnpm install          # install dependencies
pnpm build            # produces dist/molcajete.mjs
pnpm typecheck        # type-check without emitting
pnpm dev              # watch mode (rebuilds on change)
```

The build uses [tsup](https://tsup.egoist.dev/) to bundle `src/cli.ts` into a single ESM file at `dist/molcajete.mjs` with a Node shebang.

## CLI Reference

```
molcajete [--debug] <command>
```

The `--debug` flag prints spawned Claude commands to stderr.

### `molcajete build`

Execute all pending tasks in a plan.

```
molcajete build 202604021530-login    # by plan directory name
molcajete build --resume 202604021530-login   # skip already-implemented tasks
```

| Flag | Description |
|------|-------------|
| `--resume` | Resume from where a previous build left off |

## Plugin Commands

Inside a Claude Code session, all commands are prefixed with `/m:`.

### Setup

| Command | Description |
|---------|-------------|
| `setup` | Initialize project with PROJECT.md, TECH-STACK.md, ACTORS.md, GLOSSARY.md, DOMAINS.md, FEATURES.md |

### Spec Authoring

| Command | Description |
|---------|-------------|
| `feature` | Create a new feature with EARS requirements via creation interview |
| `usecase` | Create a new use case with flat scenario structure via creation interview |
| `scenario` | Generate Gherkin feature files from a use case |
| `spec` | Create or update features, use cases, and scenarios from free-form natural language |

### Updates

| Command | Description |
|---------|-------------|
| `update-feature` | Update an existing feature's requirements or architecture |
| `update-usecase` | Update an existing use case and propagate changes to Gherkin |
| `update-scenario` | Update an existing scenario within a use case and propagate changes to Gherkin |

### Reverse Engineering

| Command | Description |
|---------|-------------|
| `reverse-spec` | Reverse-engineer specs from existing code (broadest scope, multi-feature) |
| `reverse-feature` | Reverse-engineer a single feature from existing code (cascades to UCs + scenarios) |
| `reverse-usecase` | Reverse-engineer a use case from existing code (cascades to scenarios) |
| `reverse-scenario` | Reverse-engineer a single scenario from a code path (atomic, with Gherkin generation) |

### Planning

| Command | Description |
|---------|-------------|
| `plan` | Generate an implementation plan from specified use cases |
| `reverse-plan` | Generate a plan for wiring BDD to existing code (reverse path) |

### Building

| Command | Description |
|---------|-------------|
| `build` | Execute an implementation plan — dispatches tasks until all BDD tests pass |
| `build review` | Adversarial quality gate for a completed task (headless) |
| `build task` | Execute one task inside a task worktree (headless) |
| `build update-architecture` | Update ARCHITECTURE.md after task completion (headless) |

### Research

| Command | Description |
|---------|-------------|
| `research` | Deep research with tech stack context, parallel agents, and long-form output |

Headless commands are invoked automatically by the build dispatch loop — you don't call them directly.

## Hooks

Setup generates executable hook scripts in `.molcajete/hooks/`. Each hook handles one checkpoint.

### Mandatory Hooks

These four are required for builds to run:

| Hook | Purpose |
|------|---------|
| `health-check.mjs` | Verify services are running (DB, cache, app servers) |
| `run-tests.mjs` | Run BDD tests with tag filtering |
| `format.mjs` | Check formatting per domain (check mode only, no writes) |
| `lint.mjs` | Run linters per domain (report mode only, no fixes) |

### Optional Hooks

Generated with `--all` or `--hooks <name>`:

| Hook | Purpose |
|------|---------|
| `start.mjs` | Start the dev environment |
| `stop.mjs` | Stop the dev environment |
| `logs.mjs` | Retrieve service logs |
| `restart.mjs` | Restart services |
| `cleanup.mjs` | Remove worktree + branch after merge |
| `merge.mjs` | Merge a task branch to base |
| `before-worktree-created.mjs` | Pre-worktree-creation lifecycle event |
| `after-worktree-created.mjs` | Post-worktree-creation lifecycle event |
| `before-worktree-merged.mjs` | Pre-merge lifecycle event |
| `after-worktree-merged.mjs` | Post-merge lifecycle event |
| `before-task.mjs` | Pre-task lifecycle event |
| `after-task.mjs` | Post-task lifecycle event |
| `before-validate.mjs` | Pre-validation lifecycle event |
| `after-validate.mjs` | Post-validation lifecycle event |
| `before-commit.mjs` | Pre-commit lifecycle event |
| `after-commit.mjs` | Post-commit lifecycle event |

Hooks derive direct tool commands (never `make`, `npm run`, or wrapper scripts). Setup reads `prd/TECH-STACK.md` as primary source for hook configuration and falls back to codebase scanning for missing fields.

## The PRD Structure

Every project is organized by **domains** — bounded contexts of concern. A domain can be a separate application, a backend service, or a logical area within one app. Even single-app projects have one domain. The `global` domain holds cross-cutting concerns (authentication, shared UI) that apply to every module.

```
prd/
├── PROJECT.md                      # what the project does, who uses it, what problem it solves
├── FEATURES.md                     # master feature index (global section first, then per-domain)
├── TECH-STACK.md                   # technology choices, organized by module
├── ACTORS.md                       # system actors (roles, permissions, constraints)
├── GLOSSARY.md                     # domain vocabulary
├── DOMAINS.md                      # domain registry (name, type, description)
└── domains/
    ├── global/                     # spec-only — baseline requirements only, no use cases
    │   └── features/
    │       └── FEAT-0S9A-shared-auth/  # cross-cutting feature (same ID used in domains)
    │           ├── REQUIREMENTS.md     # baseline requirements (all domains inherit)
    │           └── ARCHITECTURE.md     # shared architectural decisions
    ├── patient/                    # real domain (app, service, concern)
    │   └── features/
    │       └── FEAT-0S9A-patient-auth/ # same ID — domain implementation of global feature
    │           ├── REQUIREMENTS.md     # refs: [FEAT-0S9A] links to global baseline
    │           ├── ARCHITECTURE.md
    │           ├── USE-CASES.md
    │           └── use-cases/
    │               └── UC-1T4B-login-flow.md
    ├── {domain}/
    │   └── features/
    │       └── FEAT-YYYY-{slug}/       # domain-only feature (no global counterpart)
    │           ├── REQUIREMENTS.md
    │           ├── ARCHITECTURE.md
    │           ├── USE-CASES.md
    │           └── use-cases/
    │               ├── UC-XXXX-{slug}.md
    │               └── UC-YYYY-{slug}.md
    └── ...
```

### TECH-STACK.md

Setup populates `prd/TECH-STACK.md` with the following sections:

| Section | Contents |
|---------|----------|
| **Modules** | Per-app/service: directory, language, framework, build, libraries, styling, testing, lint/format |
| **Runtime** | Docker Compose vs host-native, compose file, start/stop commands |
| **Services** | Infrastructure services: type, port, health check, notes |
| **Applications** | Runnable apps: type, port, run command, notes |
| **External Services** | Third-party APIs and integrations |
| **Repository Structure** | Monorepo vs multi-repo, package manager |
| **BDD** | Framework, language, format |
| **Tooling** | Per-domain format and lint commands |
| **Environment** | Env file, key variables, seed data |
| **Conventions** | Project-wide patterns |

### Domains

`DOMAINS.md` declares the project's bounded contexts:

| Type | Meaning |
|------|---------|
| `spec-only` | Global domain — defines baseline requirements, never targeted for plan/build |
| `app` | A deployable application (patient app, admin console) |
| `service` | A backend or infrastructure service (API server, smart contracts) |
| `concern` | A logical separation within one app (billing module, analytics) |

`FEATURES.md` is a single master index with the global section first (cross-cutting baseline), then one section per domain. Cross-cutting features use the **same FEAT-XXXX ID** across global and all implementing domains — the shared ID makes the relationship explicit. Global holds only baseline REQUIREMENTS.md + ARCHITECTURE.md (no use cases). Each domain that implements the feature gets its own `features/FEAT-XXXX-{slug}/` directory with domain-specific requirements, use cases, and architecture. Domain features declare `refs: [FEAT-XXXX]` in their REQUIREMENTS.md frontmatter to link back to the global baseline (plus any other features they depend on).

When a command receives a global feature ID (e.g., `molcajete plan FEAT-XXXX`), it globs `prd/domains/*/features/FEAT-XXXX-*/` to find all domain implementations, then generates a cross-domain plan. Pass specific use case IDs for narrower scope.

### Documents

**REQUIREMENTS.md** uses EARS syntax for every functional requirement:

```
**FR-001** When {trigger}, the system shall {response}.
Fit Criterion: Given {precondition}, {measurable outcome that proves this is satisfied}.
Linked to: UC-XXXX
```

Section order is deliberate: objective, then Non-Goals (second — so the LLM sees scope limits early), then Actors, UI, Functional Requirements, Non-Functional Requirements, Acceptance.

**Use case files** contain flat scenario blocks:

```
### SC-XXXX: Scenario Name
- **Given:** preconditions
- **Steps:** what the actor does
- **Outcomes:** what happens
- **Side Effects:** what changes elsewhere (mandatory field)
```

## The BDD Structure

```
bdd/
├── features/
│   ├── INDEX.md
│   ├── cross-domain/
│   └── {domain}/
│       └── {feature-name}.feature
└── steps/
    ├── INDEX.md
    ├── world.[ext]
    ├── common_steps.[ext]
    ├── api_steps.[ext]
    ├── db_steps.[ext]
    └── {domain}_steps.[ext]
```

Molcajete auto-detects the BDD framework from your codebase:

| Step file extension | Framework | Language |
|---------------------|-----------|----------|
| `.py` | behave | Python |
| `.go` | godog | Go |
| `.ts` / `.js` | cucumber-js | TypeScript/JavaScript |

Detection results are cached in `.molcajete/settings.json` so sniffing only runs once.

## The Build Pipeline

When you run `molcajete build {plan-name}`, this is what happens:

### 1. Task Dispatch

The dispatch loop reads the plan's `plan.json` and processes tasks sequentially, respecting dependencies. Each task goes through:

```
pending → in_progress → implemented
                     → failed
```

### 2. Task Execution

Each task runs in an isolated git worktree (configurable via `useWorktrees` in settings) with a dedicated Claude agent. The agent receives the task's spec files, Gherkin scenarios, and architecture context.

For **forward plans** (`implement` intent), the agent produces two atomic commits:
1. Production code (guided by Gherkin assertions)
2. Step definitions (created from scratch, referencing real code)

For **reverse plans** (`wire-bdd` intent), the agent produces one commit:
1. Step definitions created from scratch against existing code (no production code changes)

### 3. Five-Gate Review

Every completed task passes through an adversarial review agent that checks:

| Gate | What it checks |
|------|----------------|
| **Formatting** | Project formatter (biome, prettier, gofmt, rustfmt) |
| **Linting** | Project linter (biome, eslint, ruff, golangci-lint, clippy) |
| **BDD Tests** | Tagged `@SC-XXXX` scenarios pass using detected framework |
| **Code Review** | Step definitions and production code conform to specs |
| **Completeness** | All requirements traced to code, no stubs or TODOs |

### 4. Retry Logic

If review fails, the issues are sent back to the task agent for a fix. The task agent resumes its session, applies fixes, and the review runs again in a fresh session. Maximum retries are configurable via `MAX_DEV_VALIDATE_CYCLES` (default: 7).

### 5. Architecture Update

After a task passes review, a dedicated agent updates `ARCHITECTURE.md` to reflect what was built. Then the worktree merges back to the base branch. Architecture updates are skipped for the global domain (spec-only — no implementation to document).

## Configuration

### `.molcajete/settings.json`

Stores cached detection results and build settings:

```json
{
  "bdd": {
    "language": "python",
    "framework": "behave",
    "format": "gherkin",
    "detected_at": "2026-03-29T10:00:00Z"
  },
  "useWorktrees": true,
  "allowParallelTasks": false,
  "startTimeout": 60000
}
```

Delete the `bdd` key to force re-detection.

### Environment Variables

Override defaults by setting these before running `molcajete build`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MOLCAJETE_BACKOFF_BASE` | `30` | Backoff base in seconds between retries |
| `MOLCAJETE_MAX_TURNS_AGENT` | `50` | Max conversation turns for task agent |
| `MOLCAJETE_BUDGET_AGENT` | `5.00` | Token budget for task agent |
| `MOLCAJETE_TASK_TIMEOUT` | `897` | Timeout per task in seconds |
| `MOLCAJETE_HOOK_TIMEOUT` | `30000` | Timeout per hook in milliseconds |

### Plan Files

Plans live in `.molcajete/plans/{YYYYMMDDHHmm}-{slug}/` with a `plan.json` inside.

## Reverse Engineering Workflow

For existing codebases that need specs and BDD coverage:

```
/m:reverse-spec               # broadest — extract multiple features from code
/m:reverse-feature             # extract one feature, cascades to UCs + scenarios
/m:reverse-usecase             # extract one use case, cascades to scenarios
/m:reverse-scenario            # extract one scenario from a code path (atomic)
/m:reverse-plan                # generate a plan for wiring BDD to existing code
molcajete build {reverse-plan} # execute — writes step definitions, not production code
```

The reverse path produces the same PRD structure as the forward path. The only difference is the build intent: `wire-bdd` instead of `implement`, which means the task agent writes step definitions against existing code rather than building new code.

## Key Conventions

### IDs

- `FEAT-XXXX` — features
- `UC-XXXX` — use cases
- `SC-XXXX` — scenarios
- `TASK-XXXX` — tasks in plan files

All FEAT/UC/SC IDs are generated via base62 timestamp (4-char uppercase codes).

### Naming

- Directories: lowercase (`prd/domains/patient/`, `bdd/steps/`)
- PRD spec files: UPPERCASE (`PROJECT.md`, `FEATURES.md`, `REQUIREMENTS.md`)
- Domain directories: lowercase, directly under `prd/domains/` (`global/`, `patient/`, `server/`)
- Everything else: lowercase

### Task Statuses

```
pending → in_progress → implemented | failed
```

### Commit Style

Commits use a detected-or-default verb prefix:

```
Adds user authentication endpoint

- Implements login flow with JWT tokens
- Adds rate limiting to auth routes
- Wires behave steps for SC-A1B2 and SC-C3D4
```

Verbs: Adds, Fixes, Updates, Removes, Refactors, Improves, Moves, Renames, Replaces, Simplifies.

### Context Budgets

Each task is decomposed to fit within ~200K tokens, covering source files, spec files, Gherkin files, and implementation work. Plans break larger work into multiple tasks to stay within this limit.

## Skills Reference

Skills are internal prompt modules that govern how commands behave. They are not user-facing commands.

| Skill | Governs |
|-------|---------|
| `setup` | Interview rules, codebase detection, domain scaffolding, templates for initial PRD files |
| `feature-authoring` | EARS syntax, Fit Criteria, FEAT-XXXX ID assignment, domain resolution, global vs domain decision |
| `usecase-authoring` | UC file structure, flat scenario blocks, UC-XXXX IDs, creation interview |
| `gherkin` | BDD conventions, feature file generation, step definitions, framework detection |
| `planning` | Plan file format, task decomposition, context budgets, global feature planning, refs loading |
| `architecture` | ARCHITECTURE.md schema (C4, data model, component inventory, ADRs) |
| `reverse-engineering` | Research methodology, extraction patterns, reverse command conventions |
| `dispatch` | Task status lifecycle, retry policy, worktree naming, session management |
| `git-committing` | Commit message format, project style detection, atomic commit rules |
| `id-generation` | Canonical FEAT/UC/SC ID generation via base36 timestamp script |
| `headless-research` | Silent pre-research before spec writing, parallel agents, context briefs |
| `research-methods` | Search strategies, source evaluation, research guide templates |
