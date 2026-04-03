# Standard Gherkin Feature Template

Use this template for `.feature` files. Select this format when the project uses standard Gherkin (not MDG). Never mix formats.

```gherkin
@FEAT-{tag} @{domain} @{priority-tag}
Feature: {Feature Name}
  {1-2 sentence description of the feature}

  Background:
    Given {shared precondition}

  @UC-{tag} @SC-{tag} @{classification-tag}
  Scenario: {Scenario Name}
    Given {declarative system state}
    When {user action}
    Then {exact assertion with specific value}

  @UC-{tag} @SC-{tag} @{classification-tag}
  Scenario Outline: {Parameterized Scenario Name}
    Given {state with <param>}
    When {action with <param>}
    Then {assertion with <expected>}

    Examples:
      | param   | expected       |
      | value1  | exact-result1  |
      | value2  | exact-result2  |
```
