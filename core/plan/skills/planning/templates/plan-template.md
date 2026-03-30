# Plan: {Plan Title}

**Generated:** {ISO 8601 timestamp}
**Status:** pending
**Scope:** {FEAT-XXXX, UC-XXXX list or "full scan"}

## Overview

**Features:** {count} features, {count} use cases, {count} scenarios
**Estimated tasks:** {count}
**Total estimated context:** ~{N}K tokens

## Tasks

### T-001: {Task title — verb-noun describing what gets built}
**Use Cases:** {UC-XXXX, UC-YYYY}
**Feature:** FEAT-XXXX
**Domain:** {domain}
**Architecture:** {prd/domains/{domain}/features/FEAT-XXXX/ARCHITECTURE.md}
**Intent:** {implement | wire-bdd}
**Status:** pending
**Estimated context:** ~{N}K tokens
**Done signal:** {description — which scenarios pass, or validator check}
**Depends on:** {T-NNN or "none"}

{Description: what to implement, why, constraints}

Files to create/modify:
- {path/to/file}
- {path/to/file}

#### Summary
{Written by m::build dispatcher after task completes — empty in generated plan}

---

### T-002: {Task title}
**Use Cases:** {UC-XXXX}
**Feature:** FEAT-XXXX
**Domain:** {domain}
**Architecture:** {prd/domains/{domain}/features/FEAT-XXXX/ARCHITECTURE.md}
**Intent:** {implement | wire-bdd}
**Status:** pending
**Estimated context:** ~{N}K tokens
**Done signal:** {description}
**Depends on:** {T-NNN or "none"}

{Description}

Files to create/modify:
- {path/to/file}

#### Summary
{Empty in generated plan}

---

### T-{last}: Update directory documentation
**Use Cases:** {all UCs from the plan}
**Feature:** FEAT-XXXX
**Domain:** {domain}
**Architecture:** {prd/domains/{domain}/features/FEAT-XXXX/ARCHITECTURE.md}
**Intent:** {implement | wire-bdd}
**Status:** pending
**Estimated context:** ~50K tokens
**Done signal:** README.md files exist and are current for all directories containing files modified by this plan's tasks
**Depends on:** {all preceding task IDs}

Update or create README.md files for every source directory that was modified by the preceding tasks. Read the code-documentation skill at `${CLAUDE_PLUGIN_ROOT}/shared/skills/code-documentation/SKILL.md` for conventions and templates.

For each directory containing modified files:
1. If README.md exists — update file listing, diagrams, and last-updated date
2. If README.md does not exist — create one from the template
3. Skip directories in the skip list (node_modules, dist, prd, bdd, etc.)

Files to create/modify:
- {directories from preceding tasks}/README.md

#### Summary
{Empty in generated plan}

---
