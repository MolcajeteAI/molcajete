# Commit Message Format

Detailed rules for constructing commit messages. The SKILL.md has the summary — this reference has the full specification.

## Structure

```
<Verb> <what changed>

- <why detail 1>
- <why detail 2>
- <why detail 3>
```

The first line is the subject. The body (bullet points) is optional but recommended for non-trivial changes.

## Subject Line

### Verb Table

| Verb | Use When |
|------|----------|
| **Adds** | New features, files, or functionality |
| **Fixes** | Bug fixes or corrections |
| **Updates** | Changes to existing features |
| **Removes** | Deletion of features, files, or code |
| **Refactors** | Code restructuring without behavior change |
| **Improves** | Performance or quality enhancements |
| **Moves** | File or code relocation |
| **Renames** | Renaming files, variables, or functions |
| **Replaces** | Swapping one implementation for another |
| **Simplifies** | Reducing complexity |

### Maximum 50 Characters

If the subject line exceeds 50 characters, it is too long. Move details to the body.

```
# Good — under 50 chars
Adds user authentication

# Bad — too long
Adds user authentication with JWT tokens and refresh token rotation
```

### Describe What Changed

Focus on the change itself, not the problem:
- Good: "Fixes login redirect after authentication"
- Bad: "Fixes bug where users were stuck on login page"

### Use Simple Language

Aim for clarity, not sophistication:
- Good: "Adds user search feature"
- Bad: "Implements user discovery mechanism"

### Conventional Commit Prefixes — Match Project Convention

Prefixes like `feat:`, `fix:`, `test:`, `chore:`, `docs:` are widely used. Use the appropriate prefix based on the staged changes, but adapt to the project's style — check `git log --oneline -20`. If the project's history does not use prefixes, skip them and use the verb-only format instead.

```
# Project USES prefixes — follow the convention
feat: Add user dashboard
fix: Resolve payment error
chore: Update dependencies

# Project DOES NOT use prefixes — use verb-only style
Adds user dashboard
Fixes payment processing error
Updates dependencies to latest versions
```

Common prefixes and their meaning:

| Prefix | Use When |
|--------|----------|
| `feat:` | New features or functionality |
| `fix:` | Bug fixes |
| `test:` | Adding or updating tests |
| `chore:` | Maintenance, dependencies, config |
| `docs:` | Documentation changes |
| `refactor:` | Code restructuring without behavior change |
| `perf:` | Performance improvements |

When using prefixes, still follow the verb and 50-character rules for the rest of the subject line.

## Body

### When to Include a Body

Add bullet points when:
- The change affects multiple files or areas
- The reasoning is not obvious from the diff
- Multiple steps or trade-offs were involved
- The change has side effects or implications

### Body Format

Use bullet points (hyphens), not paragraphs. Each bullet explains one aspect of **why**.

```
Refactors authentication flow

- Separates login and registration logic
- Makes code easier to test independently
- Removes duplicate token validation
- Prepares for OAuth integration
```

### When NOT to Include a Body

Simple, obvious changes need only the subject:

```
Fixes typo in README
```

```
Updates dependencies to latest versions
```

## What NOT to Include

### Tool or AI Attribution

- Bad: "Generated with AI"
- Bad: "Created by Claude"
- Bad: "AI-assisted commit"
- Bad: Any co-author line mentioning AI tools

### Over-Explanation of Simple Changes

If the diff is clear, keep it short:
- Good: "Fixes typo in README"
- Bad: "Fixes typo in README (changed 'teh' to 'the' on line 42)"

### Paragraphs in the Body

Use bullets, not prose:

```
# Bad
Refactors authentication flow to separate login and registration logic,
making the code easier to test independently while also removing
duplicate token validation that was causing maintenance issues.

# Good
Refactors authentication flow

- Separates login and registration logic
- Makes code easier to test independently
- Removes duplicate token validation
```

## Issue References

Place issue references at the end of the subject line in parentheses:

```
Fixes payment processing error (#123)
```

Do not use issue tracker language as the subject:
- Bad: "Resolves #123"
- Good: "Fixes payment processing error (#123)"
