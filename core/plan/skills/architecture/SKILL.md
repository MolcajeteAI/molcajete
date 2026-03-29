---
name: architecture
description: >-
  Schema, section definitions, and population rules for ARCHITECTURE.md — the
  feature-level artifact that maps specs to code. Referenced by feature-authoring
  (scaffold creation) and reverse-engineering (code-driven population).
---

# Architecture

Owns all ARCHITECTURE.md knowledge: frontmatter schema, section definitions, population rules, and the template. Both forward authoring and reverse engineering reference this skill when creating or populating ARCHITECTURE.md.

## When to Use

- Understanding the structure and rules for ARCHITECTURE.md
- Creating an ARCHITECTURE.md scaffold for a new feature
- Populating ARCHITECTURE.md sections from code analysis or implementation progress

## Frontmatter Schema

```yaml
---
id: FEAT-XXXX
name: {Feature Name}
use_cases: []
scenarios: []
last_update: YYYY-MM-DD
---
```

All fields are mandatory:
- `id` — the feature's FEAT-XXXX identifier
- `name` — the feature's display name
- `use_cases` — array of UC-XXXX IDs whose implementation is documented in this file. Populated as UCs are created (forward) or extracted (reverse).
- `scenarios` — array of SC-XXXX IDs documented in this file. Populated as scenarios are created or extracted.
- `last_update` — date the sections were last updated (use current date).

## Section Reference

### System Context (C4 L1)

Mermaid C4Context diagram showing who uses this feature and what external systems it touches. Includes actors, the system itself, and external dependencies with labeled relationships.

### Container View (C4 L2)

Mermaid C4Container diagram showing which major components are involved and how they communicate. Includes API layers, databases, queues/event buses, and their interactions.

### Data Model

Mermaid ER diagram with entity schemas, field constraints, and invariants. Includes:
- Entity definitions with field types, primary/foreign keys, and constraints
- Relationships between entities
- **Invariants** — business rules that must always hold (e.g., state transition rules, referential constraints)

### Component Inventory

One row per file that participates in this feature.

| Column | Content |
|--------|---------|
| File | Relative path to the source file |
| Role | Brief category: route handler, business logic, data model, middleware, utility, test |
| Key Exports | Primary functions, classes, routes, or constants exported |

Discover files by tracing call chains from entry points through services to the data layer.

### Event Topology

All events this feature emits or consumes. Agents implementing a publisher use this table to know what to emit and when.

| Column | Content |
|--------|---------|
| Event | Domain event name in `{domain}.{entity}.{verb}` format |
| Publisher | Component that emits the event |
| Payload | Key fields included in the event payload |
| Condition | When the event fires |
| Consumers | Components that subscribe to this event |

Include a **Non-events** list for scenarios where an event is explicitly NOT published.

### API Surface

All routes/endpoints belonging to this feature.

| Column | Content |
|--------|---------|
| Method | HTTP method (GET, POST, PUT, DELETE, etc.) |
| Path | Route path |
| Handler | Handler function or controller |
| Auth | Auth requirements for this route |
| Request Shape | Key fields in the request body/params (abbreviated) |
| Response Shape | Key fields in the response (abbreviated) |
| Error Codes | HTTP status codes or error types returned |

### Integration Points

External services, event streams, and infrastructure dependencies.

| Column | Content |
|--------|---------|
| System | External system name |
| Protocol | Communication protocol (HTTP, gRPC, AMQP, etc.) |
| Direction | inbound, outbound, or bidirectional |
| Purpose | What this integration is used for |

### State Transitions

Mermaid stateDiagram-v2 for features where entities have a lifecycle. Shows states, transitions, triggers, and terminal conditions.

### Code Map

Links spec IDs to implementation files. This table is the primary bridge between specs and code — plan and build use it to locate relevant implementation.

| Column | Content |
|--------|---------|
| Spec ID | UC-XXXX or SC-XXXX identifier |
| Spec Name | Human-readable name of the use case or scenario |
| Implementation Files | Source files using `file:function()` notation for scenario-level specificity |

Every UC and SC gets a Code Map entry.

### Architecture Decisions

Non-obvious choices that future agents should not reverse. Uses the format:

```
**ADR-NNN:** {Decision title}
In the context of {situation}, facing {concern}, we decided {choice} to achieve {quality}, accepting {tradeoff}.
```

## Research Discovery

When generating or updating an ARCHITECTURE.md, scan for relevant research briefs:

1. List `.molcajete/research/*.md` — filenames sort naturally by timestamp (newest first)
2. Read only the YAML frontmatter of each file (not the body)
3. Compare `description` and `query` against the feature's topic
4. If relevant, read the full document and use it as context
5. Stop after the first relevant match to protect context window
6. Also scan `research/*.md` at project root the same way

The brief's "Current Best Practices" and "Key Libraries/APIs" sections directly inform architecture decisions. Cite relevant findings in the Architecture Decisions section when they influenced a choice.

## Population Rules

- Sections are **additive** — append rows, don't replace existing ones
- When adding new UCs or scenarios, add rows to Component Inventory, API Surface, and Code Map without disturbing existing entries
- Update the `use_cases` and `scenarios` frontmatter arrays when adding new IDs
- Always update `last_update` to the current date when modifying sections

## Template Reference

| Template | Purpose |
|----------|---------|
| [ARCHITECTURE-template.md](./templates/ARCHITECTURE-template.md) | ARCHITECTURE.md scaffold for each feature |
