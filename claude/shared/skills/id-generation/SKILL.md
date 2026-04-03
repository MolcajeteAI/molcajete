---
name: id-generation
description: >-
  Rule enforcing canonical ID generation for FEAT-XXXX, UC-XXXX, and SC-XXXX
  identifiers. All IDs must be generated via the shared script — never compute
  base36 manually.
---

# ID Generation

All entity IDs in the PRD spec use a 4-character timestamp-based code with a type prefix.

## Prefixes

| Prefix | Entity |
|--------|--------|
| `FEAT-` | Feature |
| `UC-` | Use Case |
| `SC-` | Scenario |

## Rule

**Always generate IDs by running the shared script.** Never compute base36 inline or manually.

```
node ${CLAUDE_PLUGIN_ROOT}/shared/skills/id-generation/scripts/generate-id.js [count]
```

- No argument: prints 1 ID code
- Numeric argument: prints N ID codes (one per line), each incrementing the timestamp by 1

The script outputs raw 4-character codes. The caller prepends the appropriate prefix (`FEAT-`, `UC-`, or `SC-`).

## Collision Check

Before using a generated ID, check existing IDs in the relevant index file (`FEATURES.md`, `USE-CASES.md`, or the UC file's scenario headings). If a collision is detected, re-run the script — the timestamp will have advanced, producing a new code.
