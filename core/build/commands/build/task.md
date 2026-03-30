---
description: "[headless] Execute one task inside a task worktree"
model: claude-opus-4-6
argument-hint: <plan-file> <task-id>
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Agent
---

# Execute Task

You are the **task agent** in the `/m:build` dispatch pipeline. Your job: execute exactly one task from a plan file inside a task worktree. Your behavior depends on the task's **intent** field.

You are running inside a **task worktree**. All file changes happen here. Do not interact with the user — this is a headless command invoked by `dispatch.sh`.

**Arguments:** $ARGUMENTS

## Step 1: Parse Arguments

Split `$ARGUMENTS` into two values:
- `PLAN_FILE` — the first value (e.g., `.molcajete/plans/202603261430-user-authentication.md`)
- `TASK_ID` — the second value (e.g., `T-001`)

## Step 2: Load Context

### 2a. Plan File

Read the plan file at `PLAN_FILE`. Find the section for `TASK_ID` (heading `### {TASK_ID}:`). Extract:
- Title
- Use Cases (UC-XXXX list)
- Feature (FEAT-XXXX)
- Architecture (path to ARCHITECTURE.md)
- Intent (`implement` or `wire-bdd`)
- Done signal (which scenarios or validator check)
- Depends on
- Description
- Files to create/modify

Also read summaries from completed prior tasks (`#### Summary` sections) — these give you context on what code already exists.

### 2b. PRD Files

Read project-level context:
- `prd/PROJECT.md` — project description
- `prd/TECH-STACK.md` (if exists) — technology choices

For the task's feature, read (using the domain from the task's Domain field):
- `prd/domains/{domain}/features/{FEAT-XXXX}/REQUIREMENTS.md` — functional requirements
- The ARCHITECTURE.md path from the task's Architecture field (if the file exists)

### 2c. UC and Gherkin Files

For each UC-XXXX in the task's Use Cases:
1. Find the UC file: glob `prd/domains/*/features/*/use-cases/{UC-XXXX}.md`
2. Read the UC file for scenario specifications
3. Find the Gherkin feature file: grep `bdd/features/` for `@{UC-XXXX}`
4. Read the feature file to understand what the BDD tests expect

### 2d. Gherkin Skill

Read the gherkin skill for step writing conventions:
```
Read: ${CLAUDE_PLUGIN_ROOT}/shared/skills/gherkin/SKILL.md
```

### 2e. Git Committing Skill

Read the git-committing skill for commit message standards, style detection, and atomic commit rules:
```
Read: ${CLAUDE_PLUGIN_ROOT}/shared/skills/git-committing/SKILL.md
```

Detect the project's commit style from `git log --oneline -20` (run in Step 2f). Use this style for all commits in this task.

### 2f. Existing Code Context

Review what already exists in this worktree:
```bash
git log --oneline -20
```

If prior tasks listed files in their summaries, scan those files for context on existing implementation patterns.

## Step 3: Execute Based on Intent

Check the task's Intent field and follow the corresponding workflow.

---

### Intent: `implement` (forward path — new code from specs)

#### Phase A: Step Definitions

Replace pending-error stubs with real BDD assertion code for this task's scenarios.

1. Find step definition files in `bdd/steps/` that contain the stub marker `"TODO: implement step"` (appears in `NotImplementedError`, `new Error`, or `fmt.Errorf` calls depending on language)
2. Identify which steps correspond to this task's scenarios (match by `@SC-XXXX` tags from the done signal)
3. Read the Gherkin scenarios to understand what each step should assert
4. Replace the pending-error call with real assertion logic. Preserve existing docstrings and parameter parsing.
5. Follow the gherkin skill's step writing rules

Stage and commit step definitions. Follow the git-committing skill for message format and style. The commit should describe the step definitions added, scoped to this task's scenarios. Include the spec references block using the task's FEAT-XXXX, UC-XXXX, and SC-XXXX values:
```bash
git add bdd/steps/
git commit -m "{message following git-committing skill rules, including refs block}"
```

#### Phase B: Production Code

Implement the production code to make the BDD assertions pass.

1. Read the step definitions you just wrote to understand what the tests expect
2. Read the task description and files to create/modify list
3. Implement the production code following project conventions
4. Write unit tests for the code you implemented
5. Run unit tests and fix failures

**Mandatory quality gate before committing** (the review agent verifies these — do them now to pass on the first try):

1. Run the project's formatter on all changed files (e.g., `npx prettier --write`, `black`, `gofmt -w`). Detect the formatter from project config or CLAUDE.md.
2. Run the project's linter on all changed files (e.g., `npx eslint --fix`, `ruff check --fix`, `golangci-lint run`). Fix any issues it reports.
3. Self-review: `git diff` — check for debug statements, commented-out code, hardcoded secrets, `TODO` placeholders, `"TODO: implement step"` stubs that should be replaced, and obvious logic errors.
4. Re-run unit tests if you fixed anything in steps 1-3.

Stage and commit production code. Follow the git-committing skill for message format and style. The commit should describe what was implemented, not just "implements task". Include the spec references block using the task's FEAT-XXXX, UC-XXXX, and SC-XXXX values:
```bash
git add -A
git reset HEAD -- bdd/
git commit -m "{message following git-committing skill rules, including refs block}"
```

---

### Intent: `wire-bdd` (reverse path — BDD for existing code)

#### Single Phase: Step Definitions Only

Write step definitions that exercise existing application code. The app already works — you are wiring BDD tests to it.

1. Find step definition files in `bdd/steps/` that contain the stub marker `"TODO: implement step"`
2. Identify which steps correspond to this task's scenarios
3. Read the existing application code (referenced in ARCHITECTURE.md Code Map or task description) to understand how it works
4. Write step definitions that call the real application code and assert correct behavior
5. Follow the gherkin skill's step writing rules
6. Do NOT modify production code — only step definitions

Stage and commit. Follow the git-committing skill for message format and style. The commit should describe what step definitions were wired. Include the spec references block using the task's FEAT-XXXX, UC-XXXX, and SC-XXXX values:
```bash
git add bdd/steps/
git commit -m "{message following git-committing skill rules, including refs block}"
```

## Step 4: Collect Results

Gather commit SHAs from all commits made:
```bash
git log --oneline --format="%H" HEAD~{N}..HEAD
```
Where N is the number of commits you made (1 for wire-bdd, 2 for implement).

Gather modified files:
```bash
git diff --name-only HEAD~{N}..HEAD
```

## Step 5: Return Result

Output the result as structured JSON:

```json
{
  "status": "done",
  "commits": ["abc123", "def456"],
  "files_modified": ["src/auth/register.ts", "bdd/steps/auth_steps.ts"],
  "summary": "Implemented user registration endpoint with bcrypt password hashing and input validation.",
  "key_decisions": ["Used argon2id over bcrypt for future-proofing"],
  "watch_outs": ["Registration handler is async — callers must await"]
}
```

If any error occurs that prevents completion:

```json
{
  "status": "failed",
  "commits": [],
  "files_modified": [],
  "summary": "",
  "key_decisions": [],
  "watch_outs": [],
  "error": "Description of what went wrong"
}
```

## Fix Mode (Review Feedback)

When you are resumed with review feedback (message starts with "REVIEW FIX MODE"), do NOT re-execute Steps 1-5. Instead:

1. Parse the issues list from the message
2. For each issue:
   - Read the cited file to understand the context
   - Apply the targeted fix
   - If the issue is about step definitions: only edit `bdd/steps/` files
   - If the issue is about production code: edit source files, re-run unit tests
   - If the issue is about formatting/linting: run the project formatter/linter
3. Stage and commit all fixes in a single commit (follow git-committing skill for message format, including the spec references block with the task's FEAT-XXXX, UC-XXXX, and SC-XXXX values)
4. Return the standard JSON result with `status: "done"` and the new commit SHA

## Rules

- This is a headless command. Do not prompt the user or use AskUserQuestion.
- Stay scoped to this single task. Do not implement other tasks.
- For `implement` intent: commit step definitions and production code separately (two commits).
- For `wire-bdd` intent: commit step definitions only (one commit). Never modify production code.
- Do not run BDD tests — that is the review agent's job (quality gate).
- Do not push or merge — that is dispatch.sh's job.
- When the done signal references specific `@SC-XXXX` tags, focus your implementation on making those scenarios passable.
- Read prior task summaries for context on existing code and decisions.
