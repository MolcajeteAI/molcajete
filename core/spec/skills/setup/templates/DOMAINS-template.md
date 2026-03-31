# Domains

> Logical boundaries for organizing product specs.
> Domains can represent physical applications (patient app, doctor app), backend services (auth service, billing API), or logical concerns within a single app (analytics, onboarding).
> Molcajete treats all domain types the same way — the distinction is informational only.

## Domain Types

- `app` -- User-facing application (web, mobile, desktop)
- `service` -- Backend service or API
- `concern` -- Logical separation within an app (billing, analytics, admin)
- `spec-only` -- Specification-only domain for cross-cutting concerns (e.g., authentication, shared UI). Never targeted for plan/build — defines requirements that real domains implement.

> When a global domain exists, it is listed first.

## Domains

| ID | Name | Type | Description | Directory |
|----|------|------|-------------|-----------|
