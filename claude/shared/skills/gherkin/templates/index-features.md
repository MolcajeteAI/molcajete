# Features INDEX.md Template

Write this to `bdd/features/INDEX.md`:

```markdown
# BDD Features Index

## {Module Name}

### {Primary Domain}

#### {Use Case Name} ({UC-XXXX})
- **File:** `{module}/{domain}/{UC-XXXX}-{uc-slug}.feature`
- **Parent feature:** {FEAT-XXXX} — {Feature Name}
- **Summary:** {UC objective, one sentence}
- **Scenarios:**
  - {SC-XXXX} {Scenario name} — {brief description}
  - {SC-XXXX} {Scenario name} — {brief description}
```

Group entries by module, then by domain, then one entry per UC file. Each entry lists the UC name, UC-ID, parent feature ID and name, a one-sentence summary (the UC objective), and all scenario names with brief descriptions. When the scaffold is first created, the INDEX.md may have module headings but no UC entries yet.

Notes:
- One index entry per `.feature` file, and there is exactly one `.feature` file per use case.
- Scenarios inside a single UC file share the UC-ID via the Feature-level `@UC-XXXX` tag; individual scenarios carry their own `@SC-XXXX` tags (listed above).
- When a UC has been promoted to a subdirectory (see `references/splitting.md`), replace `**File:**` with `**Directory:**` and list sub-files with their scenarios nested underneath.
