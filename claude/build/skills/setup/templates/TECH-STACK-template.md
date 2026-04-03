# Tech Stack

## Modules

### {module-name}
- **Directory:** `{path/to/module}`
- **Language:** {e.g., TypeScript 5}
- **Framework:** {e.g., React 19 + React Router 7}
- **Build:** {e.g., Vite 7}
- **Key libraries:** {e.g., urql 5 (GraphQL), Zustand 5 (state), Zod (validation)}
- **Styling:** {e.g., Tailwind CSS 4, Radix UI + shadcn/ui}
- **Testing:** {e.g., Vitest 4 + Testing Library}
- **Lint/Format:** {e.g., Biome 2.3}

{Repeat for each module/application. Omit fields that don't apply (e.g., no Styling for a backend service). For single-app projects, use one module section.}

## Runtime
- **Type:** {e.g., Docker Compose | host-native | hybrid}
- **Compose file:** {e.g., `docker-compose.yml` | N/A}
- **Start command:** {e.g., `docker compose up -d` | `npx next dev -p 3000`}
- **Stop command:** {e.g., `docker compose down` | kill process on port 3000}

## Services

| Service | Type | Port | Health Check | Notes |
|---------|------|------|--------------|-------|
| {e.g., postgres} | {database} | {5432} | {`pg_isready -h localhost -p 5432`} | {e.g., primary data store} |
| {e.g., redis} | {cache} | {6379} | {`redis-cli -p 6379 ping`} | {e.g., session store + queue backend} |

{List all infrastructure services the project depends on. Omit this table for projects with no services.}

## Applications

| Application | Type | Port/Target | Run Command | Notes |
|-------------|------|-------------|-------------|-------|
| {e.g., web} | {frontend} | {3000} | {`npx next dev -p 3000`} | {e.g., patient-facing SPA} |
| {e.g., api} | {backend} | {8080} | {`go run cmd/api/main.go`} | {e.g., GraphQL API} |

{List all runnable applications. Omit this table for library-only projects.}

## External Services
- {e.g., OpenRouter (LLM triage), Google Places API, WebPush notifications}

## Repository Structure
- **Type:** {monorepo | multi-repo}
- **Package manager:** {e.g., pnpm}

## BDD
- **Framework:** {e.g., Behave | Cucumber.js | godog}
- **Language:** {e.g., Python | TypeScript | Go}
- **Format:** {e.g., Gherkin `.feature` files in `bdd/features/`}

## Tooling

| Domain | Root | Language | Format Command | Lint Command |
|--------|------|----------|----------------|--------------|
| {e.g., bdd} | {`bdd/`} | {Python} | {`ruff format --check bdd/`} | {`ruff check bdd/`} |
| {e.g., server} | {`server/`} | {Go} | {`cd server && gofmt -l .`} | {`cd server && golangci-lint run ./...`} |
| {e.g., web} | {`apps/web/`} | {TypeScript} | {`cd apps/web && npx biome format --check .`} | {`cd apps/web && npx biome lint .`} |

{One row per domain/module with its own tooling. Omit for projects with no format/lint tools.}

## Environment
- **Env file:** {e.g., `.env` | `.env.local`}
- **Key variables:** {e.g., `DATABASE_URL`, `REDIS_URL`, `API_PORT`}
- **Seed data:** {e.g., `make seed` | `npx prisma db seed` | N/A}

## Conventions
- {Any project-wide conventions: naming, error handling patterns, testing approach}
