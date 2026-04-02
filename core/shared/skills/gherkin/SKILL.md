---
name: gherkin
description: >-
  Conventions and rules for BDD scenario generation. Use this skill when
  creating Gherkin feature files, step definitions, or managing the bdd/
  scaffold. It defines language/format detection, domain detection, file naming,
  tagging, step writing rules, and index maintenance.
---

# Gherkin BDD Conventions

Standards for generating BDD scenarios, step definitions, and maintaining the `bdd/` scaffold.

## Scaffold Structure

The canonical `bdd/` directory tree:

```
bdd/
├── features/
│   ├── INDEX.md
│   ├── cross-domain/
│   └── {domain}/
│       └── {feature-name}.feature
├── steps/
│   ├── INDEX.md
│   ├── world.[ext]
│   ├── common_steps.[ext]
│   ├── api_steps.[ext]
│   ├── db_steps.[ext]
│   └── {domain}_steps.[ext]
```

Note: `bdd/.claude/rules/` is user-created when needed for custom domain mappings — it is not part of the auto-generated scaffold.

## BDD Settings Cache

Detection results (language, framework, format) are persisted in the **BDD** section of `.molcajete/apps.md` so that sniffing only runs once per project:

```markdown
## BDD

- **Framework:** behave
- **Language:** python
- **Format:** gherkin
```

| Field | Values |
|-------|--------|
| `Framework` | `behave` \| `godog` \| `cucumber-js` |
| `Language` | `python` \| `go` \| `typescript` |
| `Format` | `gherkin` \| `mdg` |

**Read behavior:** Before running language or format detection, check `.molcajete/apps.md` for the `## BDD` section. If Framework, Language, and Format values exist, use them and skip detection entirely.

**Write behavior:** After the first successful detection (during scaffold setup), write the results to the BDD section of `.molcajete/apps.md`. If apps.md exists, update just the BDD section via Edit. If apps.md does not exist, create a minimal file with just the BDD section.

**Re-detection:** To force re-detection, remove the `## BDD` section from `.molcajete/apps.md`. The next command run will re-scan and persist new results.

## Language Detection Rules

**First**, check `.molcajete/apps.md` for a cached BDD section with Framework and Language values. If present, use them and skip the steps below.

**Otherwise**, scan existing step files to determine the language:

1. Glob `bdd/steps/*.*` and count file extensions: `.py`, `.go`, `.ts`.
2. If no step files exist → default to **Python** (behave).
3. If one language detected → use that language.
4. If multiple languages detected → use the majority language and warn: "Mixed languages detected in `bdd/steps/`: {list}. Using majority language: {language}."
5. **Never** create step files in a different language than detected.

### Language-to-Framework Mapping

| Extension | Language | Framework | Step syntax |
|-----------|----------|-----------|-------------|
| `.py` | Python | behave | `@given`, `@when`, `@then` decorators |
| `.go` | Go | godog | `ctx.Step` registration in `InitializeScenario` |
| `.ts` | TypeScript | cucumber-js | `Given`, `When`, `Then` from `@cucumber/cucumber` |

## Format Detection Rules

**First**, check `.molcajete/apps.md` for a cached BDD section with a Format value. If present, use it and skip the steps below.

**Otherwise**, detect from existing files:

1. Glob `bdd/features/**/*.feature.md`.
2. Glob `bdd/features/**/*.feature` (excluding `.feature.md` matches).
3. If `.feature.md` files exist → use **MDG format** (Markdown-Gherkin).
4. Else if `.feature` files exist → use **standard Gherkin**.
5. Else → default to **standard Gherkin** (`.feature`).
6. **Never** mix formats within `bdd/features/`.

## Domain Detection Priority

Determine domain subdirectories under `bdd/features/` using this priority — stop at the first source that yields names:

0. **DOMAINS.md registry:** Read `prd/DOMAINS.md`. If it exists and contains domain entries, use those domain names as `bdd/features/` subdirectories. This is the authoritative source. Add `@{domain}` to feature-level tags.
1. **User-defined rules:** Glob `bdd/.claude/rules/*.md` for explicit domain mappings.
2. **BDD conventions file:** Read `bdd/CLAUDE.md` for domain conventions.
3. **Existing domain folders:** Glob `bdd/features/*/` — preserve existing domains.
4. **PRD feature specs:** Glob `prd/domains/*/features/*/` and use domain folder names as domain hints.
5. **Codebase structure:** Glob top-level and `server/`/`src/` subdirectories.

If no sources yield domains, create a single `general/` domain folder. Always ensure `cross-domain/` exists. Use kebab-case naming.

## File Naming Rules

- Use kebab-case: `user-registration.feature`, not `userRegistration.feature` or `user_registration.feature`
- Name must describe the feature, not a scenario: `password-reset.feature`, not `forgot-password-click.feature`

## Tagging Rules

### Spec traceability tags (required)

Every feature file and scenario must be traceable back to the PRD spec via ID tags:

| Level | Tag | Placement | Example |
|-------|-----|-----------|---------|
| Feature | `@FEAT-{tag}` | Feature-level (top of file) | `@FEAT-0F3y` |
| Use case | `@UC-{tag}` | On each scenario | `@UC-0G2a` |
| Scenario | `@SC-{tag}` | On each scenario | `@SC-0H7k` |

Each scenario carries both its use case and scenario IDs. Example:

```gherkin
@FEAT-0F3y @auth
Feature: Email login

  @UC-0G2a @SC-0H7k @pending @smoke
  Scenario: Successful login with valid credentials
    ...

  @UC-0G2a @SC-0H8m @pending @regression
  Scenario: Failed login with wrong password
    ...
```

### Classification tags

In addition to spec traceability tags, choose from:

| Tag | When to use |
|-----|-------------|
| `@smoke` | Core happy-path scenarios that must always pass |
| `@regression` | Standard coverage scenarios |
| `@critical` | Scenarios testing security, data integrity, or financial correctness |
| `@backend` | Scenarios that test server-side behavior only |
| `@fullstack` | Scenarios requiring UI + backend interaction |
| `@{domain}` | Domain-specific tag matching the folder name (e.g., `@auth`, `@billing`) |

Feature-level tags: `@FEAT-{tag}`, `@{domain}` (from DOMAINS.md or BDD domain folder), and one priority tag (`@smoke`, `@regression`, or `@critical`). Scenario-level tags: `@UC-{tag}`, `@SC-{tag}`, optional lifecycle tag (`@pending` or `@dirty`), and any additional classification tags.

### Lifecycle tags

These tags track implementation state in `.feature` files. They are managed automatically by spec and build commands — never add or remove them manually.

| Tag | Meaning | Added by | Removed by |
|-----|---------|----------|------------|
| `@pending` | Scenario generated but step definitions are stubs | `/m:scenario`, `/m:spec` | Dev session (before implementing) |
| `@dirty` | Spec changed after scenario was implemented — implementation is stale | `/m:update-scenario`, `/m:update-usecase`, `/m:update-feature` | Dev session (before re-implementing) |

**Placement:** Lifecycle tags go after `@SC-XXXX` and before classification tags:

    @UC-0G2a @SC-0H7k @pending @smoke

**Exclusion syntax** (all supported frameworks): `not @pending and not @dirty`

## Step Writing Rules

| Rule | Requirement | Good example | Bad example |
|------|-------------|--------------|-------------|
| Declarative Given | Given steps describe state, not procedures | `Given user alice is logged in` | `Given I open the login page and type alice into the username field` |
| Exact Then | Then steps assert exact values — never ranges, approximations, or non-specific quantities | `Then the balance is exactly $94.50` | `Then the balance is more than $90` |
| Reusable patterns | Use parameterized patterns for similar steps | `Given user {name} is logged in` | `Given user alice is logged in` + `Given user bob is logged in` as separate steps |

**Exact assertion rule (critical):** Every `Then` step must assert a specific, deterministic value. Prohibited patterns:
- "more than", "less than", "at least", "at most", "greater than", "fewer than"
- "approximately", "around", "roughly", "about"
- "non-zero", "non-empty", "some", "any", "multiple"
- "should exist", "should contain" (without specifying exactly what)

Instead, always use exact values: exact counts, exact amounts, exact strings, exact status codes. If the scenario needs to verify a range, use a `Scenario Outline` with `Examples` that test specific boundary values.

## Gherkin Construct Selection

| Situation | Construct | Example |
|-----------|-----------|---------|
| Unique flow with specific setup and assertion | `Scenario` | Login with valid credentials |
| Same flow tested with different inputs/outputs | `Scenario Outline` + `Examples` | Login with various invalid credentials |
| Multiple scenarios sharing the same preconditions | `Background` | All scenarios need a logged-in user |
| Structured input data in a step | Data table | Creating a user with multiple fields |

Prefer `Scenario Outline` over multiple near-identical `Scenario` blocks. Use `Background` sparingly — only for truly shared preconditions, not convenience.

## Step Reuse Policy

Before creating any step definitions, read `bdd/steps/INDEX.md` to identify existing reusable patterns. For each step in the generated feature file:

1. Search INDEX.md for a matching pattern (exact or parameterized).
2. If match exists → reuse. Do not create a duplicate.
3. If no match → create a new step definition.

### Step File Placement

| Category | File | When to use |
|----------|------|-------------|
| Common | `common_steps.[ext]` | Generic steps reusable across domains: login, navigation, time manipulation, basic CRUD |
| API | `api_steps.[ext]` | HTTP request/response steps: sending requests, checking status codes, validating response bodies |
| Database | `db_steps.[ext]` | Database assertion steps: checking row counts, verifying column values, seeding test data |
| Domain-specific | `{domain}_steps.[ext]` | Steps unique to a business domain: billing calculations, notification rules, auth policies |

If the target step file exists, append new definitions. If not, create it using the matching template from `templates/`.

## Step Definition Rules

Every new step definition must include:
- A docstring (Python) or doc comment (Go, TypeScript) describing what the step does
- Parameter descriptions with types in the docstring
- A pending-error stub body (never empty). The error message must be the literal string `"TODO: implement step"` so the build dispatcher can detect unimplemented steps with a single grep. Use the language-appropriate pattern:
  - **Python:** `raise NotImplementedError("TODO: implement step")`
  - **TypeScript:** `throw new Error("TODO: implement step")`
  - **Go:** `return fmt.Errorf("TODO: implement step")`

## Index Maintenance Rules

Both `bdd/features/INDEX.md` and `bdd/steps/INDEX.md` must be updated together after any generation. Never leave partial index state — updating one without the other could introduce drift.

## Reference Files

| File | Description |
|------|-------------|
| [references/scaffold.md](./references/scaffold.md) | Scaffold creation and index validation procedure (Steps 2a-2h) |
| [references/exploration.md](./references/exploration.md) | Codebase exploration for generic feature names (Steps 2-exp-a to 2-exp-e) |
| [references/generation.md](./references/generation.md) | Feature file and step definition generation (Steps 3-pre to 3d) |
| [templates/](./templates/) | Individual file templates (INDEX.md, world modules, features, steps) |
| [references/splitting.md](./references/splitting.md) | Feature file splitting when scenario count exceeds 15 (Step 3e) |
