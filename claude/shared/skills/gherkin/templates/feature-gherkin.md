# Standard Gherkin Feature Template

Use this template for `.feature` files. Select this format when the project uses standard Gherkin (not MDG). Never mix formats.

One `.feature` file per use case. The `Feature:` line names the UC; the description is the UC objective. The file lives at `bdd/features/{module}/{domain}/{UC-XXXX}-{uc-slug}.feature`.

**One feature → one domain → one BDD directory.** Every scenario in this file tests the same domain. Outcomes that touch other systems (emails, notifications, downstream events) are recorded as side-effect assertions on the same scenario — never as a second domain tag.

```gherkin
@FEAT-{feat-tag} @UC-{uc-tag} @{domain} @{module} @{priority-tag}
Feature: {Use Case Name}
  {UC objective — one sentence from the UC file's Objective field.}

  Background:
    Given {shared precondition}

  @SC-{tag} @{classification-tag}
  Scenario: {Scenario Name}
    Given {declarative system state}
    When {user action}
    Then {exact assertion with specific value}
    And {side-effect assertion — e.g., a confirmation email is sent}

  @SC-{tag} @{classification-tag}
  Scenario Outline: {Parameterized Scenario Name}
    Given {state with <param>}
    When {action with <param>}
    Then {assertion with <expected>}

    Examples:
      | param   | expected       |
      | value1  | exact-result1  |
      | value2  | exact-result2  |
```

Notes:
- `@UC-{uc-tag}` lives at the Feature level (the file represents the UC).
- `@{domain}` appears once at the Feature level. Never add a second domain tag on a scenario.
- Lifecycle tags (`@pending`, `@dirty`) go after `@SC-{tag}` and before classification tags.
- **Side-effect assertions are required, not optional.** When the UC causes a user-observable effect in another feature (welcome email, notification, analytics event), assert it here as an `And` clause. See `gherkin/SKILL.md` → **Test Subject vs. Observation Surface**.
