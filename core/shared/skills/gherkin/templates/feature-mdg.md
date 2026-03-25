# MDG Feature Template

Use this template for `.feature.md` files (Markdown-Gherkin format). Select this format when the project uses MDG. Never mix formats.

````markdown
# Feature: {Feature Name}

{1-2 sentence description of the feature}

**Tags:** `@FEAT-{tag}` `@{domain}` `@{priority-tag}`

## Background

- **Given** {shared precondition}

## Scenario: {Scenario Name}

**Tags:** `@UC-{tag}` `@SC-{tag}` `@{classification-tag}`

- **Given** {declarative system state}
- **When** {user action}
- **Then** {exact assertion with specific value}

## Scenario Outline: {Parameterized Scenario Name}

**Tags:** `@UC-{tag}` `@SC-{tag}` `@{classification-tag}`

- **Given** {state with `<param>`}
- **When** {action with `<param>`}
- **Then** {assertion with `<expected>`}

### Examples

| param   | expected       |
|---------|----------------|
| value1  | exact-result1  |
| value2  | exact-result2  |
````
