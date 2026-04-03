# Steps INDEX.md Template

Write this to `bdd/steps/INDEX.md`:

```markdown
# BDD Step Definitions Index

## Common Steps

| Pattern | Description | Parameters | Source |
|---------|-------------|------------|--------|
| `{step pattern}` | {description} | `{name}`: {type} | `common_steps.{ext}` |

## API Steps

| Pattern | Description | Parameters | Source |
|---------|-------------|------------|--------|
| `{step pattern}` | {description} | `{name}`: {type} | `api_steps.{ext}` |

## Database Steps

| Pattern | Description | Parameters | Source |
|---------|-------------|------------|--------|
| `{step pattern}` | {description} | `{name}`: {type} | `db_steps.{ext}` |

## {Domain} Steps

| Pattern | Description | Parameters | Source |
|---------|-------------|------------|--------|
| `{step pattern}` | {description} | `{name}`: {type} | `{domain}_steps.{ext}` |
```

Group step definitions by category: Common, API, Database, then domain-specific sections. Each step entry lists the pattern, description, parameters with types, and the source file. When the scaffold is first created, the INDEX.md will have category headings but no step entries yet.
