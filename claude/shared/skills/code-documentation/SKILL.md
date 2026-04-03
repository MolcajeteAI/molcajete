---
name: code-documentation
description: >-
  Conventions for generating README.md files as LLM-optimized navigation
  documents. Covers YAML frontmatter, file tables, subdirectory tables, Mermaid
  diagrams, and stack-specific variants (backend, frontend, config). Used by
  /m:doc and the documentation task in build plans.
---

# Code Documentation

Rules for generating and updating README.md files that serve as directory-level navigation documents. These files are optimized for two audiences: humans exploring the codebase and LLMs scanning for relevance (read frontmatter first, then full content if relevant).

## When to Use

- Generating a README.md for a source directory
- Updating an existing README.md after structural changes
- Running the documentation task at the end of a build plan

## README.md Structure

Every README.md follows this structure in order:

### 1. YAML Frontmatter

Three required fields:

```yaml
---
module: {kebab-case directory name}
purpose: {one sentence — what this directory does}
last-updated: {YYYY-MM-DD}
---
```

The `purpose` field is the primary LLM scanning hook. Write it as a single clear sentence that lets an agent decide whether to read further.

### 2. Overview Paragraph

2-4 sentences covering:
- What this directory contains
- How it fits into the larger system
- Key patterns or conventions used here

### 3. Files Table

Every file in the directory with a one-sentence description. Sort order:
1. Entry points (main, index, app)
2. Core modules (business logic, models, services)
3. Utilities and helpers
4. Configuration files
5. Tests (if colocated)

| File | Description |
|------|-------------|
| `index.ts` | Entry point that re-exports the public API |
| `service.ts` | Core service implementing the domain logic |
| `types.ts` | Shared type definitions |
| `utils.ts` | Helper functions for data transformation |

### 4. Subdirectories Table

List child directories with their `purpose` pulled from their own README frontmatter. If a child directory has no README, describe it briefly based on its contents. This creates a navigable hierarchy.

| Directory | Purpose |
|-----------|---------|
| `handlers/` | HTTP request handlers for the REST API |
| `models/` | Database models and schema definitions |
| `utils/` | Shared utility functions |

Omit this section if the directory has no subdirectories.

### 5. Mermaid Diagrams

Include as many diagrams as needed to convey the directory's structure and behavior. Choose from:

- **Flowchart** — request/data flow through the directory's modules
- **Class diagram** — type relationships and interfaces
- **Sequence diagram** — interaction between components over time
- **State diagram** — lifecycle states (good for state machines, status fields)
- **ER diagram** — data model relationships

At minimum, include one flowchart showing how the directory's files relate to each other. Add more diagram types when they clarify something the flowchart doesn't.

### 6. Notes (Optional)

Gotchas, conventions, or non-obvious decisions. Only include if there's something that would surprise a reader or trip up an LLM.

## Stack-Specific Guidance

Detect the directory's stack and adjust the README content accordingly.

### Backend (Go, Python, TypeScript server)

Emphasize:
- API surfaces — endpoints, methods, request/response shapes
- Data models — entities, relationships, migrations
- Service patterns — dependency injection, middleware chains, error handling

### Frontend (React, Vue, Svelte, etc.)

Replace the Files table with a Component table:

| Component | Props | Description |
|-----------|-------|-------------|
| `UserCard` | `user: User, compact?: boolean` | Displays user profile summary |
| `UserList` | `users: User[], onSelect: (id) => void` | Scrollable list with selection |

Also document:
- State management approach (context, stores, signals)
- Routing integration if applicable
- Shared hooks or composables

### Config / Infrastructure

For directories containing configuration, deployment, or infrastructure files:
- What each config file controls
- Which environments it applies to
- How configs relate to each other (e.g., base + override pattern)

### Generic Fallback

When the stack isn't identifiable or the directory is mixed:
- Standard file listing table
- Dependency flowchart showing which files import from which

## Skip List

Do not generate README.md files for these directories:

- `node_modules/`
- `dist/`
- `build/`
- `coverage/`
- `vendor/`
- `.next/`
- `.git/`
- `.molcajete/`
- `__tests__/` (document tests from parent directory)
- `prd/` (PRD has its own documentation structure)
- `bdd/` (BDD has its own documentation structure)
- Asset-only directories (only images, fonts, or static files)

## Update Triggers

Only update a README.md when:
- Files are added, removed, or renamed in the directory
- A file's public interface changes significantly (new exports, renamed functions)
- Subdirectories are added or removed

Do not update for internal implementation changes that don't affect the directory's structure or public surface.

## Templates and Examples

Read before generating:

- Template: `${CLAUDE_PLUGIN_ROOT}/shared/skills/code-documentation/references/readme-template.md`
- Examples: `${CLAUDE_PLUGIN_ROOT}/shared/skills/code-documentation/references/readme-example.md`
