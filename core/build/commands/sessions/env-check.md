---
description: Pre-flight environment check — verify services and BDD tests are green before building
model: claude-sonnet-4-6
argument-hint: "<plan-file-path>"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
---

# Environment Check Session

You verify that the build environment is ready and all BDD tests for the plan's features are passing. **All tests must be green to proceed — any failure is a hard stop.**

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as the absolute path to the plan JSON file.

## Step 1: Load Context

1. Read the plan JSON file
2. Extract `bdd_command`, `scope` (feature IDs), and all unique `done_tags` across tasks
3. Read `.molcajete/apps.md` for environment and verification commands

## Step 2: Check Environment

Check if `.molcajete/apps.md` exists. If not, skip this check.

If apps.md exists:

1. Read `.molcajete/apps.md`
2. Parse the **Runtime** section to determine the environment type (docker-compose, local, etc.)
3. If docker-compose: check if the runtime is available (`docker compose ps`)
4. Parse the **Services** table to extract health check commands. For each row with a non-empty Health Check column, run the health check command. Report which services pass and which fail.
5. Parse the **Applications** table to know what should be running (for reporting purposes)
6. If services are down, report which ones and fail immediately.

## Step 3: Run BDD Tests

Use the pre-computed verification commands from apps.md:

1. If the Testing → BDD subsection exists in apps.md, construct the tag expression with lifecycle exclusions: `({scope_tags}) and not @pending and not @dirty`, where `{scope_tags}` is the OR combination of feature tags from the plan scope (e.g., `@FEAT-XXXX or @FEAT-YYYY`). Substitute this into the `{tag_expression}` placeholder of the "By tag expression" row.

   If no non-pending, non-dirty scenarios exist within scope (all scenarios carry `@pending` or `@dirty`), the pre-flight check passes trivially — report status `ready` with summary noting that all in-scope scenarios are pending.

2. If the Testing → BDD subsection is not present, fall back to `bdd_command` from the plan with `--tags` filtering (apply the same lifecycle exclusions).
3. If `bdd_command` is also null, detect it per the dispatch skill's BDD Command Detection rules.

**Examine the output carefully:**

- **Setup errors** (connection refused, command not found, missing dependencies): report as failures — these are infrastructure problems the user must fix.
- **Test failures** (assertion errors, wrong status codes): report as failures — tests must be green before any work starts.
- **All tests pass**: environment is ready.

## Step 4: Output

Respond with a structured JSON block:

```json
{
  "status": "ready | failed",
  "failures": ["@SC-XXXX: description...", "Connection refused to postgres:5432"],
  "summary": "string"
}
```

- `status`: `"ready"` only if zero failures. `"failed"` otherwise.
- `failures`: array of failure descriptions. Empty array when status is ready.
- `summary`: human-readable summary of the check results.

## Rules

- This is a **read-only check**. Do not fix anything, do not modify code, do not start services.
- Every failure must appear in the `failures` array with enough detail for the user to diagnose.
- If BDD tests cannot run at all (command not found, framework missing), that is a failure.
- Do not proceed optimistically — if anything is wrong, report it.
