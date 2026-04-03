# README Examples

Two examples: a backend service directory and a React component directory.

## Example 1: Backend Service Directory

```markdown
---
module: auth-service
purpose: Handles user authentication, session management, and token lifecycle.
last-updated: 2026-03-29
---

# Auth Service

This directory implements the authentication service for the API. It handles login, registration, token refresh, and session invalidation. All endpoints are mounted under `/api/auth` and use JWT tokens with rotating refresh tokens.

The service follows a handler-service-repository pattern. Handlers parse requests and call service methods, which contain the business logic and delegate persistence to the repository layer.

## Files

| File | Description |
|------|-------------|
| `router.ts` | Mounts auth routes onto the Express app |
| `handler.ts` | Request handlers for login, register, refresh, and logout |
| `service.ts` | Business logic for authentication flows and token management |
| `repository.ts` | Database queries for users and sessions |
| `types.ts` | Request/response types and domain interfaces |
| `middleware.ts` | Auth middleware that validates JWT on protected routes |
| `utils.ts` | Token generation, hashing, and expiry helpers |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `strategies/` | Pluggable auth strategies (local, OAuth, SAML) |
| `migrations/` | Database migration files for auth-related tables |

## Diagrams

` ` `mermaid
flowchart TB
    A["router.ts"] --> B["handler.ts"]
    B --> C["service.ts"]
    C --> D["repository.ts"]
    C --> E["utils.ts"]
    B --> F["middleware.ts"]
    F --> C
` ` `

` ` `mermaid
sequenceDiagram
    participant Client
    participant Handler
    participant Service
    participant Repository

    Client->>Handler: POST /api/auth/login
    Handler->>Service: authenticate(email, password)
    Service->>Repository: findByEmail(email)
    Repository-->>Service: User | null
    Service->>Service: verify password hash
    Service-->>Handler: { accessToken, refreshToken }
    Handler-->>Client: 200 OK + tokens
` ` `

## Notes

- Refresh tokens are stored hashed in the database, never in plain text.
- Token rotation: every refresh request invalidates the old token and issues a new pair.
- Rate limiting is applied at the router level, not in middleware.
```

## Example 2: React Component Directory

```markdown
---
module: user-profile
purpose: UI components for displaying and editing user profile information.
last-updated: 2026-03-29
---

# User Profile

Components for the user profile page. Handles display of user info, avatar upload, and profile editing. Uses React Hook Form for form state and Zod for validation. All components are wrapped in the `ProfileProvider` context for shared state.

## Components

| Component | Props | Description |
|-----------|-------|-------------|
| `ProfilePage` | none (route component) | Top-level page that orchestrates profile sections |
| `ProfileHeader` | `user: User` | Displays name, avatar, and status badge |
| `ProfileForm` | `user: User, onSave: (data) => Promise<void>` | Edit form with validation for all profile fields |
| `AvatarUpload` | `currentUrl: string, onUpload: (file: File) => void` | Drag-and-drop avatar upload with preview |
| `ProfileStats` | `stats: UserStats` | Activity statistics cards |

## Hooks

| Hook | Description |
|------|-------------|
| `useProfile` | Reads user profile from ProfileProvider context |
| `useAvatarUpload` | Manages upload state, preview URL, and error handling |

## Files

| File | Description |
|------|-------------|
| `index.ts` | Re-exports all public components |
| `types.ts` | Props interfaces and form schema types |
| `constants.ts` | Validation rules and field constraints |
| `profile-context.tsx` | ProfileProvider context and hook |

## Diagrams

` ` `mermaid
flowchart TB
    A["ProfilePage"] --> B["ProfileHeader"]
    A --> C["ProfileForm"]
    A --> D["ProfileStats"]
    B --> E["AvatarUpload"]
    C -.->|"useProfile"| F["profile-context.tsx"]
    B -.->|"useProfile"| F
` ` `

## Notes

- All form fields use controlled inputs via React Hook Form's `useController`.
- Avatar upload validates file type (PNG/JPG) and size (max 5MB) client-side before uploading.
```
