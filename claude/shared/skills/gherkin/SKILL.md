---
name: gherkin
description: >-
  Conventions and rules for BDD scenario generation. Use this skill when
  creating Gherkin feature files, step definitions, or managing the bdd/
  scaffold. It defines language/format detection, module detection, file naming,
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
│   └── {module}/
│       └── {domain}/
│           └── {UC-XXXX}-{uc-slug}.feature
├── steps/
│   ├── INDEX.md
│   ├── world.[ext]
│   ├── common_steps.[ext]
│   ├── api_steps.[ext]
│   ├── db_steps.[ext]
│   └── {module}_steps.[ext]
```

**One `.feature` file per use case.** The `Feature:` line names the UC; the PRD feature remains traceable via the `@FEAT-XXXX` tag at Feature-level. Multiple UCs under the same PRD feature produce multiple `.feature` files — never group them.

Note: `bdd/.claude/rules/` is user-created when needed for custom domain mappings — it is not part of the auto-generated scaffold.

## BDD Settings Cache

Detection results (language, framework, format) are persisted in `.molcajete/settings.json` so that sniffing only runs once per project:

```json
{
  "bdd": {
    "framework": "behave",
    "language": "python",
    "format": "gherkin"
  }
}
```

| Field | Values |
|-------|--------|
| `framework` | `behave` \| `godog` \| `cucumber-js` |
| `language` | `python` \| `go` \| `typescript` |
| `format` | `gherkin` \| `mdg` |

**Read behavior:** Before running language or format detection, check `.molcajete/settings.json` for the `bdd` object. If `framework`, `language`, and `format` values exist, use them and skip detection entirely.

**Write behavior:** After the first successful detection (during scaffold setup), write the results to `.molcajete/settings.json`. If the file exists, merge the `bdd` key via read-modify-write. If it does not exist, create it with just the `bdd` object.

**Re-detection:** To force re-detection, remove the `bdd` key from `.molcajete/settings.json`. The next command run will re-scan and persist new results.

## Language Detection Rules

**First**, check `.molcajete/settings.json` for a cached `bdd` object with `framework` and `language` values. If present, use them and skip the steps below.

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

**First**, check `.molcajete/settings.json` for a cached `bdd` object with a `format` value. If present, use it and skip the steps below.

**Otherwise**, detect from existing files:

1. Glob `bdd/features/**/*.feature.md`.
2. Glob `bdd/features/**/*.feature` (excluding `.feature.md` matches).
3. If `.feature.md` files exist → use **MDG format** (Markdown-Gherkin).
4. Else if `.feature` files exist → use **standard Gherkin**.
5. Else → default to **standard Gherkin** (`.feature`).
6. **Never** mix formats within `bdd/features/`.

## Module Detection Priority

Determine module subdirectories under `bdd/features/` using this priority — stop at the first source that yields names:

0. **MODULES.md registry:** Read `prd/MODULES.md`. If it exists and contains module entries, use those module names as `bdd/features/` subdirectories. This is the authoritative source. Add `@{module}` to feature-level tags.
1. **User-defined rules:** Glob `bdd/.claude/rules/*.md` for explicit module mappings.
2. **BDD conventions file:** Read `bdd/CLAUDE.md` for module conventions.
3. **Existing module folders:** Glob `bdd/features/*/` — preserve existing modules.
4. **PRD feature specs:** Glob `prd/modules/*/features/*/` and use module folder names as module hints.
5. **Codebase structure:** Glob top-level and `server/`/`src/` subdirectories.

If no sources yield modules, create a single `general/` module folder. Use kebab-case naming.

## File Naming Rules

- Filename is `{UC-XXXX}-{uc-slug}.feature` (e.g., `UC-0G2a-sign-in-with-password.feature`). The UC ID prefix makes files findable by ID alone.
- Slug is the UC's slug from its UC file (`prd/modules/{module}/features/FEAT-XXXX-*/use-cases/UC-XXXX-{uc-slug}.md`), kebab-case.
- One UC per file. Never group multiple UCs into the same `.feature`.

## Domain Resolution

The `{domain}` directory segment of every BDD path is the **single domain** declared in the parent feature's `REQUIREMENTS.md` frontmatter:

```yaml
domain: identity           # the only domain for this feature → bdd/features/{module}/identity/
```

**One feature → one domain → one BDD directory.** A use case tests exactly the domain it lives in. There is no notion of "secondary" or "additional" domains being tested. If a feature genuinely needs to verify behavior in a different domain, that is a separate feature in that other domain — do not mix subjects inside one `.feature` file.

For how cross-boundary side effects (emails, notifications, analytics) are handled when authoring scenarios, see **Test Subject vs. Observation Surface** below.

## Test Subject vs. Observation Surface

A `.feature` file tests exactly one UC. The **subject** of the test is a single feature, in a single domain, authored from one or more modules. The **observation surface** — what the scenario asserts on — is *everything* the user observes as a consequence of performing that UC.

Those two things are not the same. The observation surface routinely spans feature and domain boundaries. When a shopper signs up:

- The sign-up UC is the **subject** (domain: `identity`, feature: `FEAT-sign-up`).
- The **observations** include: the account is created, the user is redirected to the dashboard, a welcome notification appears in the UI, and a confirmation email arrives in the inbox.
- The notification and the email are produced by other features (in other domains) — but the shopper sees them happen as a direct consequence of signing up.

Those cross-boundary observations **must** be asserted in the sign-up UC's scenario. They are part of what the user experiences when they sign up. Omitting them leaves the UC under-validated.

**This is not "testing the notifications feature" or "testing the email feature."** Those features have their own UCs in their own `.feature` files, which test their internal behavior (retries, template rendering, rate limits, failure modes) in isolation. The sign-up scenario only asserts on the user-visible outcome — that the email arrives, that the notification shows up.

**Rules:**

1. **One subject per file.** The `Feature:` line, the `@UC-XXXX` tag, and the `@{domain}` tag at the Feature level all reflect the one UC under test. Never add a second domain tag on a scenario — a scenario is never "partly about" another domain.
2. **Assert on cross-boundary side effects.** If the user observes it as a consequence of the UC, assert it — email sent, notification shown, analytics event fired, downstream record written. This is **required**, not optional.
3. **Describe the observation, not the implementation.** Write `And alice receives a welcome email with subject "Welcome to Acme"` — not `And the email service's sendTransactional method is called with template_id=42`.
4. **Don't reach into the other feature's internals.** Test what the user sees. The email feature's own UC asserts on retry behavior and template rendering; the sign-up UC only asserts that the email arrives. No overlap.
5. **Don't duplicate across UCs.** A cross-boundary assertion belongs on the UC whose subject *produced* it. "A welcome email is sent on sign-up" lives on the sign-up UC, not on the email-delivery UC.

## Tagging Rules

### Spec traceability tags (required)

Every feature file and scenario must be traceable back to the PRD spec via ID tags. Because each `.feature` represents exactly one UC, `@UC-XXXX` is a Feature-level tag (not scenario-level).

| Level | Tag | Placement | Example |
|-------|-----|-----------|---------|
| Feature | `@FEAT-{tag}` | Feature-level (top of file) | `@FEAT-0F3y` |
| Feature | `@UC-{tag}` | Feature-level (top of file) | `@UC-0G2a` |
| Scenario | `@SC-{tag}` | On each scenario | `@SC-0H7k` |

Example:

```gherkin
@FEAT-0F3y @UC-0G2a @identity @storefront @smoke
Feature: Sign in with password
  A returning shopper enters email and password to access their account.

  @SC-0H7k @pending @smoke
  Scenario: Successful sign-in with valid credentials
    ...

  @SC-0H8m @pending @regression
  Scenario: Failed sign-in with wrong password
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
| `@{domain}` | Domain tag — matches the BDD directory segment (e.g., `@identity`, `@billing`). One per feature. |
| `@{module}` | Module tag matching the BDD directory name — implicit from directory but explicit as a tag for clarity |

Feature-level tags: `@FEAT-{tag}`, `@UC-{tag}`, `@{domain}`, `@{module}`, and one priority tag (`@smoke`, `@regression`, or `@critical`). Scenario-level tags: `@SC-{tag}`, optional lifecycle tag (`@pending` or `@dirty`), and any additional classification tags. **Never add a second domain tag on a scenario** — one feature, one domain.

### Lifecycle tags

These tags track implementation state in `.feature` files. They are managed automatically by spec and build commands — never add or remove them manually.

| Tag | Meaning | Added by | Removed by |
|-----|---------|----------|------------|
| `@pending` | Scenario generated but step definitions are stubs | `/m:scenario`, `/m:spec` | Dev session (before implementing) |
| `@dirty` | Spec changed after scenario was implemented — implementation is stale | `/m:update-scenario`, `/m:update-usecase`, `/m:update-feature` | Dev session (before re-implementing) |

**Placement:** Lifecycle tags go after `@SC-XXXX` and before classification tags:

    @SC-0H7k @pending @smoke

**Exclusion syntax** (all supported frameworks): `not @pending and not @dirty`

## Step Writing Rules

| Rule | Requirement | Good example | Bad example |
|------|-------------|--------------|-------------|
| Declarative Given | Given steps describe state, not procedures | `Given user alice is logged in` | `Given I open the login page and type alice into the username field` |
| Exact Then | Then steps assert exact values — never ranges, approximations, or non-specific quantities | `Then the balance is exactly $94.50` | `Then the balance is more than $90` |
| Reusable patterns | Use parameterized patterns for similar steps | `Given user {name} is logged in` | `Given user alice is logged in` + `Given user bob is logged in` as separate steps |
| User-Observable | When/Then steps describe what actors do and see, not internal system behavior | `When alice submits the registration form` / `Then alice sees the confirmation page` | `When the system inserts a user row` / `Then the JWT contains the correct claims` |

**Exact assertion rule (critical):** Every `Then` step must assert a specific, deterministic value. Prohibited patterns:
- "more than", "less than", "at least", "at most", "greater than", "fewer than"
- "approximately", "around", "roughly", "about"
- "non-zero", "non-empty", "some", "any", "multiple"
- "should exist", "should contain" (without specifying exactly what)

Instead, always use exact values: exact counts, exact amounts, exact strings, exact status codes. If the scenario needs to verify a range, use a `Scenario Outline` with `Examples` that test specific boundary values.

## E2E-First Step Writing

All steps assume end-to-end execution -- describe real state, real actions, real assertions. Never write steps that reference mocks, stubs, or test doubles.

| Step Type | E2E Pattern (correct) | Mock-Dependent Anti-Pattern (wrong) |
|-----------|----------------------|--------------------------------------|
| Given | `Given user alice exists with verified email` | `Given the user service returns a verified user` |
| Given | `Given 3 products exist in the catalog` | `Given the product API is mocked to return 3 items` |
| When | `When alice submits a payment of $25` | `When we call the mocked payment endpoint` |
| When | `When the system processes the nightly batch` | `When the batch processor mock is triggered` |
| Then | `Then the payments table has exactly 1 row for alice` | `Then the mock was called once` |
| Then | `Then alice receives a confirmation email` | `Then the email mock was invoked with the correct template` |

**Rules:**
- Given steps seed real state (database rows, queue messages, file system artifacts)
- When steps perform real actions (HTTP requests, UI interactions, CLI commands)
- Then steps assert real outcomes (database contents, API responses, published events)
- Never reference "mock", "stub", "fake", "spy", or "double" in step text

### User-Perspective Step Writing

When and Then steps narrate the actor's experience. Implementation details (database assertions, event checks, internal state verification) belong in `And` steps mapped from Side Effects, not in the main When/Then narrative.

| Step | User-Perspective (correct) | Implementation-Leaked (wrong) |
|------|---------------------------|------------------------------|
| When | `When alice submits the registration form` | `When the system inserts a row into the users table` |
| Then | `Then alice sees the welcome dashboard` | `Then the session table contains a new row` |
| Then | `Then alice receives a confirmation email` | `Then the email service was called with template "welcome"` |
| And (from Side Effects) | `And a "users" row exists with profile_complete=true` | _(this is correct in And -- Side Effects map here)_ |
| And no (from Non-Side-Effects) | `And no password reset email is sent` | _(this is correct in And no -- Non-Side-Effects map here)_ |

## Gherkin Construct Selection

| Situation | Construct | Example |
|-----------|-----------|---------|
| Unique flow with specific setup and assertion | `Scenario` | Login with valid credentials |
| Same flow tested with different inputs/outputs | `Scenario Outline` + `Examples` | Login with various invalid credentials |
| Multiple scenarios sharing the same preconditions | `Background` | All scenarios need a logged-in user |
| Structured input data in a step | Data table | Creating a user with multiple fields |

Prefer `Scenario Outline` over multiple near-identical `Scenario` blocks. Use `Background` sparingly — only for truly shared preconditions, not convenience.

Scenario descriptions should name the actor's situation or goal, not internal system behavior.

## Step Reuse Policy

Before creating any step definitions, read `bdd/steps/INDEX.md` to identify existing reusable patterns. For each step in the generated feature file:

1. Search INDEX.md for a matching pattern (exact or parameterized).
2. If match exists → reuse. Do not create a duplicate.
3. If no match → create a new step definition.

### Step File Placement

| Category | File | When to use |
|----------|------|-------------|
| Common | `common_steps.[ext]` | Generic steps reusable across modules: login, navigation, time manipulation, basic CRUD |
| API | `api_steps.[ext]` | HTTP request/response steps: sending requests, checking status codes, validating response bodies |
| Database | `db_steps.[ext]` | Database assertion steps: checking row counts, verifying column values, seeding test data |
| Module-specific | `{module}_steps.[ext]` | Steps unique to a business module: billing calculations, notification rules, auth policies |

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
