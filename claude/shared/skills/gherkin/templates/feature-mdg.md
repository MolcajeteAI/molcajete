# MDG Feature Template

Use this template for `.feature.md` files (Markdown-Gherkin format). Select this format when the project uses MDG. Never mix formats.

One `.feature.md` file per use case. The `# Feature:` heading names the UC; the description is the UC objective. The file lives at `bdd/features/{module}/{domain}/{UC-XXXX}-{uc-slug}.feature.md`.

**One feature → one domain → one BDD directory.** Every scenario in this file tests the same domain. Outcomes that touch other systems (emails, notifications, downstream events) are recorded as side-effect assertions on the same scenario — never as a second domain tag.

````markdown
# Feature: {Use Case Name}

{UC objective — one sentence from the UC file's Objective field.}

**Tags:** `@FEAT-{feat-tag}` `@UC-{uc-tag}` `@{domain}` `@{module}` `@{priority-tag}`

## Background

- **Given** {shared precondition}

## Scenario: {Scenario Name}

**Tags:** `@SC-{tag}` `@{classification-tag}`

- **Given** {declarative system state}
- **When** {user action}
- **Then** {exact assertion with specific value}
- **And** {side-effect assertion — e.g., a confirmation email is sent}

## Scenario Outline: {Parameterized Scenario Name}

**Tags:** `@SC-{tag}` `@{classification-tag}`

- **Given** {state with `<param>`}
- **When** {action with `<param>`}
- **Then** {assertion with `<expected>`}

### Examples

| param   | expected       |
|---------|----------------|
| value1  | exact-result1  |
| value2  | exact-result2  |
````

Notes:
- `@UC-{uc-tag}` lives at the Feature level (the file represents the UC).
- `@{domain}` appears once at the Feature level. Never add a second domain tag on a scenario.
- Lifecycle tags (`@pending`, `@dirty`) go after `@SC-{tag}` and before classification tags.
- **Side-effect assertions are required, not optional.** When the UC causes a user-observable effect in another feature (welcome email, notification, analytics event), assert it here as an `And` clause. See `gherkin/SKILL.md` → **Test Subject vs. Observation Surface**.
