---
description: Detect project tooling and generate typed TypeScript hook scripts
model: claude-sonnet-4-6
argument-hint: '{"overwrite":false,"all":false,"yes":false}'
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
---

# Hook Setup Command

**Non-interactive session** — invoked headlessly via `claude -p` by the orchestrator. No user is present. Never ask questions, request confirmation, or use AskUserQuestion. All decisions must be autonomous — always behave as if `--yes` was passed.

You are generating typed TypeScript hook scripts for a Molcajete-managed project. Parse `$ARGUMENTS` as JSON to get `{ overwrite, all }` flags.

## Overview

1. Detect project environment, BDD framework, and per-domain tooling
2. Present findings to the user (unless `--yes`)
3. Read hook templates from `${CLAUDE_PLUGIN_ROOT}/setup/templates/hooks/`
4. Generate hooks to `.molcajete/hooks/` with detected values filled in
5. Update `.molcajete/settings.json` with BDD metadata

## Step 1: Parse Arguments

```
const args = JSON.parse('$ARGUMENTS' || '{}');
const overwrite = args.overwrite ?? false;
const all = args.all ?? false;
const yes = args.yes ?? false;
```

## Step 2: Environment Detection

### 2a. Docker Compose

Read `docker-compose.yml` (or `docker-compose.yaml`, `compose.yml`, `compose.yaml`). Extract:

- **Service names** and their images
- **Ports** (host:container mappings)
- **Health check commands** based on service type:

| Docker Compose service pattern | Health check command | Timeout |
|---|---|---|
| `postgres` or `db` (postgres image) | `pg_isready -h localhost -p $PORT` | 5000 |
| `redis` | `redis-cli -p $PORT ping` | 5000 |
| `mysql` or `mariadb` | `mysqladmin -h localhost -P $PORT ping` | 5000 |
| `mongo` or `mongodb` | `mongosh --port $PORT --eval 'db.runCommand("ping")'` | 5000 |
| `rabbitmq` | `rabbitmq-diagnostics -q ping` | 5000 |
| `elasticsearch` or `opensearch` | `curl -sf http://localhost:$PORT/_cluster/health` | 10000 |

- **Start command**: `docker compose up -d` (add `--remove-orphans` if compose file has many services)
- **Stop command**: `docker compose down`
- **Logs command**: `docker compose logs`

### 2b. Port Resolution

Read `.env` and `.env.example` for port variables. In generated hooks, use `process.env.VAR || fallback` pattern for ports:

```typescript
// Example: if .env has POSTGRES_PORT=5433
const port = process.env.POSTGRES_PORT || '5432';
```

### 2c. Host-Native Fallback

If no Docker Compose file exists, set:
- Start: empty string (user fills in)
- Stop: empty string
- Services: empty array

## Step 3: BDD Detection

Check dependency manifests for BDD frameworks:

| Indicator | Framework | Command | Tags flag | Format flags | Tag join |
|---|---|---|---|---|---|
| `behave` in `requirements.txt` or `pyproject.toml` | behave | `behave` | `--tags` | `--format json --no-capture` | ` --tags ` |
| `@cucumber/cucumber` in `package.json` dependencies | cucumber-js | `npx cucumber-js` | `--tags` | `--format json` | ` and ` |
| `godog` in `go.mod` | godog | `godog` | `--tags` | `--format cucumber` | `,` |

Also detect:
- **Language**: infer from step definitions location (`features/steps/*.py` → Python, `features/step_definitions/*.ts` → TypeScript, etc.)
- **Features directory**: look for `features/`, `bdd/features/`, or similar
- **Steps directory**: look for step definitions within the features dir

If using `behave` with a virtual environment, prefix command with `.venv/bin/` if `.venv/` exists.

## Step 4: Per-Domain Tooling Detection

### 4a. Domain Discovery

Read `prd/DOMAINS.md` for the domain list. Parse the domains table to get domain names and directories.

If `prd/DOMAINS.md` doesn't exist, fall back to directory structure detection:
- Check for `apps/*/`, `packages/*/`, `services/*/`, `cmd/*/` patterns
- Each subdirectory with its own build config is a domain

### 4b. Tooling Per Domain

For each domain directory, check:

| Config file | Tool | Format command | Lint command |
|---|---|---|---|
| `biome.json` in module | Biome | `biome format --write {files}` | `biome lint {files}` |
| `.prettierrc*` in module | Prettier | `prettier --write {files}` | (none) |
| `go.mod` in module | Go tools | `gofmt -l {files}` | `golangci-lint run {files}` |
| `ruff.toml` or `[tool.ruff]` in `pyproject.toml` | Ruff | `ruff format --check {files}` | `ruff check {files}` |
| `.eslintrc*` or `eslint.config.*` | ESLint | (none) | `eslint {files}` |

Build entries as `{ service, glob, command, fallback }`:
- **service**: tool name (e.g., `biome`, `gofmt`, `ruff`)
- **glob**: file pattern for the domain (e.g., `patient/**/*.{ts,tsx}`)
- **command**: command with `{files}` placeholder for targeted runs
- **fallback**: command without placeholder for full runs (e.g., `biome format --write patient/`)

**Rules:**
- Never store `make`, `npm run`, `pnpm --filter` — only direct tool binaries
- If a tool is in `node_modules/.bin/`, use `npx` prefix
- If a tool is in `.venv/bin/`, use `.venv/bin/` prefix

## Step 5: Log Findings

Log the detected configuration to stdout for the orchestrator's records:

```
Environment: docker-compose
  start: docker compose up -d --remove-orphans
  stop: docker compose down
  services:
    postgres: pg_isready -h localhost -p ${POSTGRES_PORT:-5432}
    redis: redis-cli -p ${REDIS_PORT:-6379} ping

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

Proceed directly to hook generation — no confirmation needed.

## Step 6: Read Templates

Read hook templates from `${CLAUDE_PLUGIN_ROOT}/setup/templates/hooks/`. These show the structure and patterns for each hook. Use them as the base — fill in detected values where you see placeholder comments like `// __SERVICES__`, `// __FORMATTERS__`, `// __LINTERS__`, `// __SERVICE_MAP__`, or placeholder strings like `__START_COMMAND__`, `__STOP_COMMAND__`, `__BDD_COMMAND__`, etc.

Also read `${CLAUDE_PLUGIN_ROOT}/setup/templates/hooks/types.ts` to understand all available types, but do NOT generate this file into the user's project — types come from the `@molcajeteai/cli` package import.

## Step 7: Generate Hooks

Write hooks to `.molcajete/hooks/`. Create the directory if it doesn't exist.

### Default hooks (always generated):
- `health-check.ts` — fill `// __SERVICES__` with detected services array
- `run-tests.ts` — fill BDD command, tags flag, format flags, tag join
- `format.ts` — fill `// __FORMATTERS__` with detected format entries
- `lint.ts` — fill `// __LINTERS__` with detected lint entries
- `start.ts` — fill `__START_COMMAND__`
- `stop.ts` — fill `__STOP_COMMAND__`
- `logs.ts` — fill `__LOGS_COMMAND__` and `// __SERVICE_MAP__`
- `restart.ts` — stub

### Environment hooks (always generated):
- `create-worktree.ts` — stub
- `cleanup.ts` — stub
- `merge.ts` — stub

### Lifecycle hooks (only if `all` flag is true):
- `before-task.ts`, `after-task.ts`
- `before-subtask.ts`, `after-subtask.ts`
- `before-validate.ts`, `after-validate.ts`
- `before-commit.ts`, `after-commit.ts`
- `before-worktree-created.ts`, `after-worktree-created.ts`
- `before-worktree-merged.ts`, `after-worktree-merged.ts`

### Generation rules:
- **Skip existing hooks** unless `overwrite` is true
- All generated hooks import types from `@molcajeteai/cli`, NOT from a local `./types.ts`
- Each hook is a single `export default async function` with typed `HookContext<TInput>`
- Port values use `process.env.VAR || 'fallback'` pattern
- For services array in health-check, generate entries like:
  ```typescript
  { name: 'postgres', command: `pg_isready -h localhost -p ${process.env.POSTGRES_PORT || '5432'}`, timeout: 5000 },
  ```
- For formatters/linters arrays, generate entries like:
  ```typescript
  { service: 'biome', glob: 'patient/**/*.{ts,tsx}', command: 'npx biome format --write {files}', fallback: 'npx biome format --write patient/' },
  ```

## Step 8: Update Settings

Read `.molcajete/settings.json` (create if missing). Add/update BDD metadata while preserving existing keys:

```json
{
  "bdd": {
    "framework": "behave",
    "command": ".venv/bin/behave",
    "tagsFlag": "--tags",
    "formatFlags": "--format json --no-capture",
    "tagJoin": " --tags ",
    "language": "python",
    "featuresDir": "features",
    "stepsDir": "features/steps"
  }
}
```

## Step 9: Summary

Print a summary of what was generated:
- Number of hooks written
- Number of hooks skipped (already existed)
- Path to generated hooks directory
