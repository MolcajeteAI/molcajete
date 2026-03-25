---
paths:
  - "**/*.md"
---

# Mermaid Diagram Node Labels

Always wrap Mermaid node labels in double quotes when they contain any character
beyond plain alphanumeric text and spaces. This includes em dashes, hyphens,
periods, slashes, `@` symbols, single quotes, question marks, parentheses,
and any other punctuation or Unicode character.

The safest default: **quote every node label** to avoid guessing which characters
will break the parser.

This applies to all node shapes: `[]`, `{}`, `()`, `(())`, `[[]]`, `[()]`, etc.

## Correct

```mermaid
flowchart TB
    A["Read GLOSSARY.md"] --> B["Read FEATURES.md and USE-CASES.md"]
    B --> C{"All passing?"}
    C -->|Yes| D["Nothing to do -- UC is already implemented"]
    C -->|No| E["Generate implementation plan"]
```

## Incorrect

```mermaid
flowchart TB
    A[Read GLOSSARY.md] --> B[Read FEATURES.md and USE-CASES.md]
    B --> C{All passing?}
    C -->|Yes| D[Nothing to do — UC is already implemented]
    C -->|No| E[Generate implementation plan]
```

The unquoted em dash, periods, and special characters in `[]` and `{}`
cause Mermaid parser failures, resulting in diagrams that do not render.
