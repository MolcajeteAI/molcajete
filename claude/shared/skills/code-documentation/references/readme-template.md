# README Template

Two variants: standard (backend/generic) and component (frontend).

## Standard Variant

```markdown
---
module: {kebab-case-dir-name}
purpose: {One sentence describing what this directory does}
last-updated: {YYYY-MM-DD}
---

# {Directory Name}

{2-4 sentence overview: what this directory contains, how it fits into the larger system, key patterns.}

## Files

| File | Description |
|------|-------------|
| `{file}` | {One sentence} |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `{dir}/` | {One sentence from child README purpose field, or brief description} |

## Diagrams

{One or more Mermaid diagrams. At minimum a flowchart showing file relationships.}

## Notes

{Optional: gotchas, conventions, non-obvious decisions. Omit section if nothing to note.}
```

## Component Variant (Frontend)

```markdown
---
module: {kebab-case-dir-name}
purpose: {One sentence describing what this directory does}
last-updated: {YYYY-MM-DD}
---

# {Directory Name}

{2-4 sentence overview: what these components do, which feature/page they belong to, shared patterns.}

## Components

| Component | Props | Description |
|-----------|-------|-------------|
| `{ComponentName}` | `{prop: Type, prop?: Type}` | {One sentence} |

## Hooks / Composables

| Hook | Description |
|------|-------------|
| `{useSomething}` | {One sentence} |

## Files

| File | Description |
|------|-------------|
| `{file}` | {One sentence — for non-component files like utils, constants, types} |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `{dir}/` | {One sentence} |

## Diagrams

{Component relationship diagram, state flow, or data flow.}

## Notes

{Optional: state management approach, routing integration, styling conventions.}
```
