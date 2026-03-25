---
id: FEAT-XXXX
name: {Feature Name}
---

# Architecture: {Feature Name}

## System Context (C4 L1)

> Who uses this feature and what external systems does it touch?

```mermaid
C4Context
    title Feature Name -- System Context
    Person(actor, "{Primary Actor}", "{What they do}")
    System(system, "{This System}", "{What it does}")
    System_Ext(external, "{External System}", "{How it relates}")
    Rel(actor, system, "{Action}", "{Protocol}")
    Rel(system, external, "{Action}", "{Protocol}")
```

## Container View (C4 L2)

> Which major components are involved and how do they communicate?

```mermaid
C4Container
    title Feature Name -- Container View
    Person(actor, "{Actor}")
    Container(api, "{API Layer}", "{Technology}", "{Responsibility}")
    ContainerDb(db, "{Database}", "{Technology}", "{What it stores}")
    Container(queue, "{Queue or Event Bus}", "{Technology}", "{What events it carries}")
    Rel(actor, api, "{action}", "{protocol}")
    Rel(api, db, "reads/writes", "SQL")
    Rel(api, queue, "publishes events")
```

## Data Model

> Entity schemas with field constraints and invariants.

```mermaid
erDiagram
    ENTITY {
        type field PK "constraint"
        type field "constraint"
        type field FK "constraint"
    }
    ENTITY ||--o{ OTHER_ENTITY : "relationship"
```

**Invariants:**
- {Entity}.{field} must always {rule}
- {Entity}.{status} transitions: {state} to {state} (no skipping)
- A {entity} with status = {status} must have no {related entity}

## Event Topology

> All events this feature emits or consumes.
> Agents implementing a publisher use this table to know what to emit and when.

| Event | Publisher | Payload | Condition | Consumers |
|-------|-----------|---------|-----------|-----------|
| `{domain}.{entity}.{verb}` | {Component} | `{field, field}` | {When it fires} | {Component} |

**Non-events (explicit):**
- {Scenario}: no event is published

## State Transitions

> For features where entities have a lifecycle.

```mermaid
stateDiagram-v2
    state "state" as s1
    state "state" as s2
    [*] --> s1 : "trigger"
    s1 --> s2 : "trigger"
    s2 --> [*] : "terminal condition"
```

## Architecture Decisions

> Non-obvious choices that future agents should not reverse.

**ADR-001:** {Decision title}
In the context of {situation}, facing {concern}, we decided {choice} to achieve {quality}, accepting {tradeoff}.
