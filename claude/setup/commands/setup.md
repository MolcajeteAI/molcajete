---
description: Detect project tooling and generate typed TypeScript hook scripts
model: claude-sonnet-4-6
argument-hint: '{"overwrite":false,"hook":null,"guidance":"","allowedFiles":[]}'
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
---

# Hook Setup Command

**Non-interactive session** — invoked headlessly via `claude -p` by the CLI. No user is present. Never ask questions. The CLI already handled any overwrite confirmation before spawning this session — the `allowedFiles` list tells you exactly which files you are permitted to write.

You are generating typed TypeScript hook scripts for a Molcajete-managed project. Parse `$ARGUMENTS` as JSON to get `{ overwrite, hook, guidance, allowedFiles }`.

## Overview

1. Parse arguments.
2. If generating `verify.ts` (i.e. `hook` is null or `hook === "verify"`), detect BDD framework and per-domain tooling.
3. Read hook templates from `${CLAUDE_PLUGIN_ROOT}/setup/templates/hooks/`.
4. Generate only the hook file(s) listed in `allowedFiles` — never write anything else.
5. If `verify.ts` was generated, update `.molcajete/settings.json` with BDD metadata.

## Step 1: Parse Arguments

```
const args = JSON.parse('$ARGUMENTS' || '{}');
const overwrite   = args.overwrite   ?? false;
const hook        = args.hook        ?? null;
const guidance    = args.guidance    ?? '';
const allowedFiles = args.allowedFiles ?? [];
```

- `hook === null` → default flow: generate `verify.ts`.
- `hook === "<name>"` → generate just that one hook.
- `guidance` is free-form user text. When non-empty, it should shape the body of the hook(s) you generate. When `hook` is null, apply `guidance` to decisions made while authoring `verify.ts` (e.g. "skip BDD, only run lint" or "use ruff instead of the detected formatter"). When `hook` is set, tailor that hook's body to the intent.
- `allowedFiles` is the list of absolute paths the CLI has pre-confirmed. Never `Write` a file whose absolute path is not in this list.

## Step 2: BDD Detection (only when generating `verify.ts`)

Check dependency manifests for BDD frameworks:

| Indicator | Framework | Command | Tags flag | Tag join |
|---|---|---|---|---|
| `behave` in `requirements.txt` or `pyproject.toml` | behave | `behave` | `--tags` | ` --tags ` |
| `@cucumber/cucumber` in `package.json` dependencies | cucumber-js | `npx cucumber-js` | `--tags` | ` and ` |
| `godog` in `go.mod` | godog | `godog` | `--tags` | `,` |

Also detect:
- **Language**: infer from step definitions location (`features/steps/*.py` → Python, `features/step_definitions/*.ts` → TypeScript, etc.)
- **Features directory**: look for `features/`, `bdd/features/`, or similar
- **Steps directory**: look for step definitions within the features dir

If using `behave` with a virtual environment, prefix command with `.venv/bin/` if `.venv/` exists.

## Step 3: Per-Domain Tooling Detection (only when generating `verify.ts`)

### 3a. Domain Discovery

Read `prd/DOMAINS.md` for the domain list. Parse the domains table to get domain names and directories.

If `prd/DOMAINS.md` doesn't exist, fall back to directory structure detection:
- Check for `apps/*/`, `packages/*/`, `services/*/`, `cmd/*/` patterns
- Each subdirectory with its own build config is a domain

### 3b. Tooling Per Domain

For each domain directory, check:

| Config file | Tool | Format command | Lint command |
|---|---|---|---|
| `biome.json` in module | Biome | `biome format --write {files}` | `biome lint {files}` |
| `.prettierrc*` in module | Prettier | `prettier --write {files}` | (none) |
| `go.mod` in module | Go tools | `gofmt -l {files}` | `golangci-lint run {files}` |
| `ruff.toml` or `[tool.ruff]` in `pyproject.toml` | Ruff | `ruff format --check {files}` | `ruff check {files}` |
| `.eslintrc*` or `eslint.config.*` | ESLint | (none) | `eslint {files}` |

Build entries as `{ service, glob, command, fallback }`:
- **service**: tool name (e.g. `biome`, `gofmt`, `ruff`)
- **glob**: file pattern for the domain (e.g. `patient/**/*.{ts,tsx}`)
- **command**: command with `{files}` placeholder for targeted runs
- **fallback**: command without placeholder for full runs (e.g. `biome format --write patient/`)

**Rules:**
- Never store `make`, `npm run`, `pnpm --filter` — only direct tool binaries
- If a tool is in `node_modules/.bin/`, use `npx` prefix
- If a tool is in `.venv/bin/`, use `.venv/bin/` prefix

## Step 4: Log Findings

Log the detected configuration to stdout for the CLI's records. Example:

```
BDD: behave (python)
  command: .venv/bin/behave
  features: features/
  steps: features/steps/

Domains:
  server (server/)
    format: gofmt, biome
    lint: golangci-lint, biome
  patient (patient/)
    format: biome
    lint: biome
```

When `guidance` is non-empty, also log what you interpreted from it.

## Step 5: Read Templates

Read the template for whichever hook(s) you are generating from `${CLAUDE_PLUGIN_ROOT}/setup/templates/hooks/`:

- Default flow (`hook === null`): read `verify.ts`.
- `hook === "<name>"`: read `<name>.ts` (one of `verify`, `start`, `stop`, `before-task`, `after-task`, `before-subtask`, `after-subtask`, `before-review`, `after-review`, `before-documentation`, `after-documentation`).

Use the template as the base — fill in detected values where you see placeholder comments (`// __FORMATTERS__`, `// __LINTERS__`) or placeholder strings (`__BDD_COMMAND__`, `__TAGS_FLAG__`, `__TAG_JOIN__`, `__START_COMMAND__`, `__STOP_COMMAND__`).

All generated hooks import types from `@molcajeteai/cli`. Never emit a local `types.ts`.

## Step 6: Generate Hook(s)

Only write files whose absolute path is in `allowedFiles`. If `allowedFiles` is empty, skip this step and print a warning.

### Default flow (`hook === null`)

Generate only `.molcajete/hooks/verify.ts` — fill `// __FORMATTERS__` with detected format entries, `// __LINTERS__` with detected lint entries, and the BDD placeholders with the detected framework command, tags flag, and tag join string.

When `guidance` is non-empty, let it shape what goes into those blocks (e.g. "skip BDD" → leave `__BDD_COMMAND__` empty so the body short-circuits; "use ruff instead of biome" → replace the detected formatter list).

### Specific hook flow (`hook !== null`)

Generate only the single requested hook file. When `guidance` is non-empty, tailor the body to the user's intent while staying within the typed signature of the hook (signature comes from the template — do not invent new exports).

For `start` / `stop` hooks, detect the environment's start/stop command (`docker compose up -d` etc.) from the project if possible, and use `guidance` to override.

For lifecycle hooks (`before-*`, `after-*`), if `guidance` describes concrete steps, translate them into shell commands or Node code inside the hook body. If `guidance` is empty, emit a minimal stub that preserves the typed signature.

## Step 7: Update Settings (only when `verify.ts` was written)

Read `.molcajete/settings.json` (create if missing). Add/update BDD metadata while preserving existing keys:

```json
{
  "bdd": {
    "framework": "behave",
    "command": ".venv/bin/behave",
    "tagsFlag": "--tags",
    "tagJoin": " --tags ",
    "language": "python",
    "featuresDir": "features",
    "stepsDir": "features/steps"
  }
}
```

If `verify.ts` was NOT in `allowedFiles` (user skipped overwrite), leave settings alone.

## Step 8: Summary

Print a summary of what was generated:
- Each file written (absolute path)
- BDD framework detected (if verify was generated)
- Whether guidance was applied
