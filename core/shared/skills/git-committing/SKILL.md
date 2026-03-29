---
name: git-committing
description: >-
  Standards for structuring git commits during automated task execution. Covers
  message format, project style detection, atomic commit principles, scope
  assessment, and commit splitting. Read by build agents before committing work.
---

# Git Committing

Standards for how agents create git commits during task execution. This skill defines message format, style detection, atomicity rules, and scope assessment. It does not define a user-facing command — it is reference material for agents that commit as part of their work.

## When to Use

- An agent has completed a task and needs to commit the changes
- An agent needs to decide whether to commit now or continue accumulating changes
- An agent needs to split a large set of changes into multiple commits

## Style Detection

Before writing any commit message, detect the project's existing style:

1. Run `git log --oneline -20` and examine the output
2. **Prefixes**: If the majority of recent commits use conventional prefixes (`feat:`, `fix:`, `chore:`, etc.), use them. If they don't, use the verb-only format.
3. **Verb tense**: Match the existing pattern. Most projects use either "Adds" (third person) or "Add" (imperative). Follow what's already there.
4. **Casing**: Match subject line casing — some projects capitalize after the prefix, some don't.

The detected style applies to all commits in the session. Do not mix styles.

## Message Format

### Structure

```
<Verb> <what changed>

- <why detail 1>
- <why detail 2>
- <why detail 3>
```

The first line is the subject. The body (bullet points) is optional but recommended for non-trivial changes. Separate the subject from the body with a blank line.

### Subject Line Rules

1. **Start with a verb** — capitalize the first letter (or follow prefix convention):
   - **Adds** — new files, features, or functionality
   - **Fixes** — bug fixes or corrections
   - **Updates** — changes to existing features
   - **Removes** — deletion of features, files, or code
   - **Refactors** — code restructuring without behavior change
   - **Improves** — performance or quality enhancements
   - **Moves** — file or code relocation
   - **Renames** — renaming files, variables, or functions
   - **Replaces** — swapping one implementation for another
   - **Simplifies** — reducing complexity

2. **Maximum 50 characters** — if it exceeds 50, move details to the body.

3. **Describe what changed**, not what was wrong:
   - Good: "Fixes login redirect after authentication"
   - Bad: "Fixes bug where users were stuck on login page"

4. **Use simple language** — avoid jargon when plain words work:
   - Good: "Adds user search feature"
   - Bad: "Implements user discovery mechanism"

### Conventional Commit Prefixes

Only use prefixes if the project already does (see Style Detection):

| Prefix | Use When |
|--------|----------|
| `feat:` | New features or functionality |
| `fix:` | Bug fixes |
| `test:` | Adding or updating tests |
| `chore:` | Maintenance, dependencies, config |
| `docs:` | Documentation changes |
| `refactor:` | Code restructuring without behavior change |
| `perf:` | Performance improvements |

### Body Rules

Use bullet points (hyphens, not paragraphs) to explain **why** when:
- The change affects multiple files or areas
- The reasoning is not obvious from the diff
- Multiple steps or trade-offs were involved

For simple, obvious changes, a single subject line is enough.

### Issue References

Place issue references at the end of the subject line in parentheses:

```
Fixes payment processing error (#123)
```

Do not use issue tracker language as the subject — "Resolves #123" says nothing about what changed.

## No AI Attribution

**Mandatory — no exceptions.**

- Never add "Generated with Claude Code" or similar
- Never add "Co-Authored-By: Claude" or any AI co-author line
- Never add AI emoji, "AI-assisted", or tool mentions

Commits must look like normal human development. Focus on what changed, not how it was produced.

## Atomic Commits

Each commit represents one logical change:
- One bug fix per commit
- One feature per commit
- One refactoring per commit

Do not mix unrelated changes:
- Bad: fixing a bug AND adding a feature in one commit
- Bad: updating dependencies AND refactoring code in one commit

Small, frequent commits are better than large, infrequent ones: easier to review, easier to revert, better git history.

## Scope Assessment

After completing work, assess whether the changes should be one commit or multiple.

### Single Commit

Changes are **one logical concern** when they all serve the same intent:
- Multiple files touched by one feature = one commit
- A version bump + changelog + the feature it describes = one commit
- A new command + its skill + plugin registration = one commit

Judge by intent, not by file count.

### Multiple Commits Needed

Changes contain **multiple independent concerns** when:
- A new feature AND an unrelated bug fix
- A refactor AND a dependency update
- Changes to module A's API AND an unrelated config change to module B

### Splitting Strategy

When changes need splitting:

1. Identify the independent concerns and their affected files
2. Group files by concern — each group becomes one commit
3. Order commits by dependency: infrastructure first, then features, then fixes
4. Stage and commit each group separately with its own message

## Pre-Commit Checklist

Before committing, verify the diff:
- No debug code (`console.log`, print statements, debugger)
- No commented-out code
- No temporary test data or hardcoded values
- No unintended file changes
- No secrets (API keys, passwords, tokens, `.env` files)
- Stage specific files, not `git add .`

## References

| Reference | Purpose |
|-----------|---------|
| [references/message-format.md](./references/message-format.md) | Detailed format rules, verb table, body guidelines |
| [references/examples.md](./references/examples.md) | Good and bad commit message examples |
