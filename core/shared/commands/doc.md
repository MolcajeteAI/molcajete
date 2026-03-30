---
description: Generate or update directory documentation (README.md)
model: claude-sonnet-4-6
argument-hint: "<file path, directory, or module name>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Agent
  - AskUserQuestion
---

# Doc Command

You generate and update README.md files as LLM-optimized navigation documents. For files, you add inline documentation (godoc, TSDoc, docstrings). For directories, you create or update README.md per the code-documentation skill conventions.

**Target argument:** $ARGUMENTS

**All user interaction MUST use the AskUserQuestion tool.** Never ask questions as plain text in your response.

## Step 1: Identify Target

Resolve `$ARGUMENTS` to a target:

1. If empty, use AskUserQuestion to ask: "Which file, directory, or module should I document?"
2. If it's a file path, verify it exists
3. If it's a directory path, verify it exists
4. If it's a module name, search for a matching directory

If the target cannot be resolved, report the error and stop.

## Step 2: Detect Stack

Examine the target to determine the stack variant:

- **Go**: `.go` files, `go.mod`
- **Python**: `.py` files, `requirements.txt`, `pyproject.toml`
- **TypeScript/JavaScript**: `.ts`/`.tsx`/`.js`/`.jsx` files, `package.json`
- **Frontend (React/Vue/Svelte)**: `.tsx`/`.jsx` component files, or framework indicators in `package.json`
- **Config/Infra**: `.yaml`/`.yml`/`.toml`/`.json` config files, `Dockerfile`, `terraform/`
- **Generic**: none of the above

For frontend detection, check if the directory contains component-shaped files (PascalCase `.tsx`/`.jsx` files with default exports that return JSX).

## Step 3: Load Skill

Read the code-documentation skill and its references:

1. `${CLAUDE_PLUGIN_ROOT}/shared/skills/code-documentation/SKILL.md`
2. `${CLAUDE_PLUGIN_ROOT}/shared/skills/code-documentation/references/readme-template.md`
3. `${CLAUDE_PLUGIN_ROOT}/shared/skills/code-documentation/references/readme-example.md`

Follow the skill's rules for all subsequent steps.

## Step 4: Analyze Code

### For a directory target:

1. List all files and subdirectories
2. Skip directories on the skip list
3. Read each file to understand its purpose, exports, and relationships
4. If child directories have README.md files, read their frontmatter for the subdirectories table
5. Identify the main entry point, core modules, and utilities
6. Map dependencies between files (imports/exports)
7. Check for an existing README.md — if present, read it for context

### For a file target:

1. Read the file fully
2. Identify exported functions, classes, types, and their purposes
3. Note existing inline documentation

## Step 5: Generate Documentation

### For a directory target:

If README.md exists, update it:
- Refresh the files table (add new files, remove deleted ones, update descriptions)
- Refresh the subdirectories table
- Update diagrams if file relationships changed
- Update `last-updated` in frontmatter

If README.md does not exist, create one from the template using the detected stack variant (standard or component).

### For a file target:

Add or update inline documentation:
- **Go**: godoc-style comments on exported functions, types, and packages
- **TypeScript/JavaScript**: TSDoc/JSDoc comments on exported functions, classes, and types
- **Python**: docstrings on public functions, classes, and modules

Do not rewrite existing documentation that is already accurate and complete.

## Step 6: Report

Summarize what was documented:
- Files created or updated
- Directories skipped (from the skip list)
- Stack variant used
