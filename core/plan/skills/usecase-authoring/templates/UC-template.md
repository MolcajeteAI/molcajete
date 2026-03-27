---
id: UC-XXXX
name: {Verb-noun goal name}
feature: FEAT-XXXX
status: pending
version: 1
actor: {Primary actor role}
tag: @UC-XXXX
---

# UC-XXXX: {Use Case Name}

> {One sentence: what the actor achieves by completing this use case.}

## Preconditions

- {Shared state that must exist before ANY scenario can start}
- {Actor state: authenticated, has permission, etc.}

## Trigger

{One sentence: what the actor does or what event occurs.}

## Gherkin Tags

`@FEAT-XXXX @UC-XXXX`

---

### SC-XXXX: {Scenario Name}

**Given:**
- {State specific to THIS scenario, beyond UC-level Preconditions}

**Steps:**
1. {Actor} {action}
2. System {validates/processes/stores/returns} {what}

   **UI:**
   ```
   +----------------------------------+
   | {Screen title}                   |
   |----------------------------------|
   | {Key UI elements at this step}   |
   |                                  |
   | [ {Action button} ]              |
   +----------------------------------+
   ```

**Outcomes:**
- {Entity/state that now exists or has changed}

**Side Effects:**
- `{event.name}` event published with payload `{fields}`
- No {notification/email/webhook} sent

---

### SC-XXXX: {Scenario Name}

**Given:**
- {Scenario-specific state}

**Steps:**
1. {Actor} {action}
2. System {response}

**Outcomes:**
- {What is true after this scenario}

**Side Effects:**
- {Side effects for this scenario}
- No {thing that does NOT happen}
