---
description: Post-flight final tests — run BDD for all features in plan scope
model: claude-sonnet-4-6
argument-hint: "<json-payload>"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
---

# Final Tests Session

You run the BDD suite for all features in the plan scope as a post-flight check. Since the environment check guaranteed all tests were green before the build started, any failure here is caused by the plan's changes.

**Arguments:** $ARGUMENTS

Parse `$ARGUMENTS` as a JSON payload with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `plan_path` | string | Absolute path to the plan JSON file |

## Step 1: Load Context

1. Read the plan JSON file
2. Extract `bdd_command` and all unique feature IDs from `scope`
3. Collect all unique `done_tags` across all tasks in the plan
4. Read `.molcajete/apps.md` for Testing → BDD commands

## Step 2: Run BDD Suite

Use pre-computed verification commands from apps.md:

1. If the Testing → BDD subsection exists in apps.md, construct the tag expression with lifecycle exclusions: `({scope_tags}) and not @pending and not @dirty`, where `{scope_tags}` is the combined feature tags. Substitute into the "By tag expression" row's `{tag_expression}` placeholder. This filters out any scenarios not addressed by the plan (e.g., scenarios from in-scope features that no task targeted).
2. If the Testing → BDD subsection is not present, fall back to `bdd_command` from the plan (apply the same lifecycle exclusions):
   ```bash
   {bdd_command} --tags="@FEAT-XXXX or @FEAT-YYYY"
   ```

If there are many features, use the OR syntax to include all of them in a single run.

## Step 2.5: Lifecycle Audit

After running the BDD suite, grep all `.feature` files matching the plan's scope tags for remaining `@pending` or `@dirty` tags:

1. For each `@FEAT-XXXX` in scope, grep `bdd/features/` for files containing `@FEAT-XXXX`
2. In those files, grep for `@pending` and `@dirty` on scenario tag lines
3. Collect each as `{@SC-XXXX: "pending" | "dirty"}` with the scenario name

These are scenarios that exist in scope but were never activated by any task's dev session.

## Step 3: Analyze Results

**Setup errors** (connection refused, command not found, services down): report as failures.

**Test failures** (assertion errors, wrong status codes): report each failing scenario with its tag and a description of what failed.

**All tests pass**: the plan is complete.

## Step 4: Output

Respond with a structured JSON block:

```json
{
  "failures": ["@SC-XXXX: description of failure"],
  "unaddressed": ["@SC-0H7k: pending — Successful login with valid credentials"]
}
```

- `failures`: array of failure descriptions. Empty array = all green.
- Each failure includes the scenario tag and enough detail to diagnose the issue.
- `unaddressed`: scenarios in scope that still carry `@pending` or `@dirty`. Empty array means every in-scope scenario was addressed by the plan.

## Rules

- This is a **read-only check**. Do not fix anything, do not modify code.
- Report every failure with scenario tag and error details.
- If tests cannot run at all, report the infrastructure issue as a failure.
