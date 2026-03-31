---
name: setup
description: >-
  Rules and templates for the /m:setup command. Defines the interview flow
  for generating PROJECT.md, TECH-STACK.md, ACTORS.md, GLOSSARY.md,
  DOMAINS.md, and master FEATURES.md. Covers codebase inference for
  tech stack, actors, and domains, confirmation patterns, and document
  generation sequence.
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
1. Ask the user: "Foundational documents already exist. Do you want to regenerate them?"
2. If yes, proceed with the full interview
3. If no, stop without changes

## Template Reference

| Template | Purpose |
|----------|---------|
| [PROJECT-template.md](./templates/PROJECT-template.md) | PROJECT.md structure |
| [TECH-STACK-template.md](./templates/TECH-STACK-template.md) | TECH-STACK.md structure |
| [ACTORS-template.md](./templates/ACTORS-template.md) | ACTORS.md structure |
| [GLOSSARY-template.md](./templates/GLOSSARY-template.md) | GLOSSARY.md structure |
| [DOMAINS-template.md](./templates/DOMAINS-template.md) | DOMAINS.md structure |
| [FEATURES-template.md](./templates/FEATURES-template.md) | Master FEATURES.md structure (sectioned by domain) |
