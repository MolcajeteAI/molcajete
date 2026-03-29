# Molcajete.ai

A Claude Code plugin that turns product specs into working, tested software — powered by BDD as the done signal.

You write the spec. Molcajete plans the work, implements it, reviews it, and commits it — task by task — until every scenario passes.

## How It Works

Molcajete operates in three phases:

**Spec** reads your intent and produces structured specs — features with EARS requirements, use cases with scenario blocks, and Gherkin feature files with step definition stubs. Everything lands in a `prd/` folder that becomes the permanent source of truth.

**Plan** decomposes use cases into an implementation plan — ordered tasks with dependencies, context budgets, and done signals.

**Build** picks up a plan and dispatches tasks one at a time. Each task runs in its own worktree with a dedicated agent, passes through a 5-gate adversarial review, and merges back automatically. The loop continues until all BDD scenarios pass.

There is also a **reverse** path: point Molcajete at an existing codebase and it will extract specs from the code, then wire BDD tests to what already exists.

## Quick Start

```
# Spec — author the product spec
/m:setup                  # initialize PROJECT.md, TECH-STACK.md, ACTORS.md, GLOSSARY.md, FEATURES.md
/m:feature                # create a feature with EARS requirements
/m:usecase                # create use cases under that feature
/m:scenario               # generate Gherkin files and step stubs from a use case

# Plan — decompose into tasks
/m:plan                   # decompose use cases into an implementation plan

# Build — execute the plan
/m:build {plan-name}      # execute the plan — dispatches tasks until all tests pass
```

Each command runs an interactive interview to gather what it needs. Setup through scenario is spec authoring; plan decomposes work into tasks; build executes them.

## Command Reference

All commands are prefixed with `/m:`.

### Setup

| Command | Description |
|---------|-------------|
| `setup` | Initialize project with PROJECT.md, TECH-STACK.md, ACTORS.md, GLOSSARY.md, FEATURES.md |

### Spec Authoring

| Command | Description |
|---------|-------------|
| `feature` | Create a new feature with EARS requirements via creation interview |
| `usecase` | Create a new use case with flat scenario structure via creation interview |
| `scenario` | Generate Gherkin feature files and step definition stubs from a use case |
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

## The PRD Structure

```
prd/
├── PROJECT.md                      # what the project does, who uses it, what problem it solves
├── FEATURES.md                     # feature registry table (ID, Name, Status, Tag, Link)
├── TECH-STACK.md                   # technology choices (language, frameworks, infra)
├── ACTORS.md                       # system actors (roles, permissions, constraints)
├── GLOSSARY.md                     # domain vocabulary
└── features/
    └── FEAT-XXXX/
        ├── REQUIREMENTS.md         # EARS functional requirements with Fit Criteria
        ├── USE-CASES.md            # use case index table
        ├── ARCHITECTURE.md         # C4 diagrams, data model, component inventory, ADRs
        └── use-cases/
            ├── UC-XXXX.md          # use case with scenario blocks
            └── UC-YYYY.md
```

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

When you run `/m:build {plan-name}`, this is what happens:

### 1. Task Dispatch

The dispatch loop reads `.molcajete/tasks.json` and processes tasks sequentially, respecting dependencies. Each task goes through:

```
pending → in_progress → implemented
                     → failed
```

### 2. Task Execution

Each task runs in an isolated git worktree (`.claude/worktrees/{FEAT-ID}-{TASK-ID}/`) with a dedicated Claude agent. The agent receives the task's spec files, Gherkin scenarios, and architecture context.

For **forward plans** (`implement` intent), the agent produces two atomic commits:
1. Step definitions
2. Production code

For **reverse plans** (`wire-bdd` intent), the agent produces one commit:
1. Step definitions only (no production code changes)

### 3. Five-Gate Review

Every completed task passes through an adversarial review agent that checks:

| Gate | What it checks |
|------|----------------|
| **Formatting** | Project formatter (prettier, black, gofmt, rustfmt) |
| **Linting** | Project linter (eslint, ruff, golangci-lint, clippy) |
| **BDD Tests** | Tagged `@SC-XXXX` scenarios pass using detected framework |
| **Code Review** | Step definitions and production code conform to specs |
| **Completeness** | All requirements traced to code, no stubs or TODOs |

### 4. Retry Logic

If review fails, the issues are sent back to the task agent for a fix. The task agent resumes its session, applies fixes, and the review runs again in a fresh session. Maximum 2 retries per task.

### 5. Architecture Update

After a task passes review, a dedicated agent updates `ARCHITECTURE.md` to reflect what was built. Then the worktree merges back to the base branch.

## Skills Reference

Skills are internal prompt modules that govern how commands behave. They are not user-facing commands.

| Skill | Governs |
|-------|---------|
| `setup` | Interview rules, codebase detection, templates for initial PRD files |
| `feature-authoring` | EARS syntax, Fit Criteria, FEAT-XXXX ID assignment, FEATURES.md management |
| `usecase-authoring` | UC file structure, flat scenario blocks, UC-XXXX IDs, creation interview |
| `gherkin` | BDD conventions, feature file generation, step definitions, framework detection |
| `planning` | Plan file format, task decomposition, context budgets, done signals |
| `architecture` | ARCHITECTURE.md schema (C4, data model, component inventory, ADRs) |
| `reverse-engineering` | Research methodology, extraction patterns, reverse command conventions |
| `dispatch` | Task status lifecycle, retry policy, worktree naming, session management |
| `git-committing` | Commit message format, project style detection, atomic commit rules |
| `id-generation` | Canonical FEAT/UC/SC ID generation via base36 timestamp script |
| `headless-research` | Silent pre-research before spec writing, parallel agents, context briefs |
| `research-methods` | Search strategies, source evaluation, research guide templates |

## Configuration

### `.molcajete/settings.json`

Stores cached detection results:

```json
{
  "bdd": {
    "language": "python",
    "framework": "behave",
    "format": "gherkin",
    "detected_at": "2026-03-29T10:00:00Z"
  }
}
```

Delete the `bdd` key to force re-detection.

### Environment Variables

Override dispatch defaults by setting these before running `/m:build`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MOLCAJETE_MAX_RETRIES` | `2` | Max review retries per task |
| `MOLCAJETE_BACKOFF_BASE` | `30` | Backoff base in seconds between retries |
| `MOLCAJETE_MAX_TURNS_AGENT` | `30` | Max conversation turns for task agent |
| `MOLCAJETE_MAX_TURNS_REVIEW` | `15` | Max conversation turns for review agent |
| `MOLCAJETE_BUDGET_AGENT` | `3.00` | Token budget for task agent |
| `MOLCAJETE_BUDGET_REVIEW` | `1.50` | Token budget for review agent |
| `MOLCAJETE_TASK_TIMEOUT` | `897` | Timeout per task in seconds |

### Plan and Task Files

- **Plans:** `.molcajete/plans/{YYYYMMDDHHmm}-{slug}.md`
- **Tasks:** `.molcajete/tasks.json` (generated by dispatch from the plan)
- **Research:** `.molcajete/research/{YYYYMMDDHHmm}-{slug}.md`

## Reverse Engineering Workflow

For existing codebases that need specs and BDD coverage:

```
/m:reverse-spec               # broadest — extract multiple features from code
/m:reverse-feature             # extract one feature, cascades to UCs + scenarios
/m:reverse-usecase             # extract one use case, cascades to scenarios
/m:reverse-scenario            # extract one scenario from a code path (atomic)
/m:reverse-plan                # generate a plan for wiring BDD to existing code
/m:build {reverse-plan-name}   # execute — writes step definitions, not production code
```

The reverse path produces the same PRD structure as the forward path. The only difference is the build intent: `wire-bdd` instead of `implement`, which means the task agent writes step definitions against existing code rather than building new code.

## Key Conventions

### IDs

- `FEAT-XXXX` — features
- `UC-XXXX` — use cases
- `SC-XXXX` — scenarios
- `T-NNN` — tasks in plan files (sequential: T-001, T-002, ...)

All FEAT/UC/SC IDs are generated via script — never computed manually:
```
node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js [count]
```

### Naming

- Directories: lowercase (`prd/features/`, `bdd/steps/`)
- PRD spec files: UPPERCASE (`PROJECT.md`, `FEATURES.md`, `REQUIREMENTS.md`)
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
