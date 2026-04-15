# Scaffold Procedure

This procedure ensures the `bdd/` directory structure exists and that INDEX.md files are in sync with the file system. It runs on every invocation before scenario generation.

## 2a. Check for Existing Scaffold

Glob for `bdd/features/INDEX.md`. If it exists, the scaffold is already set up — skip to 2g (Validate Index Files).

## 2b. Create Base Directories

If `bdd/` does not exist, create the full scaffold:

```
bdd/
├── features/
│   └── INDEX.md
├── steps/
│   └── INDEX.md
```

Use Bash to create the directories:
```
mkdir -p bdd/features bdd/steps
```

## 2c. Detect Modules

Determine which module subdirectories to create under `bdd/features/`. Follow the module detection priority from SKILL.md — stop at the first source that yields module names:

0. **MODULES.md registry:** Read `prd/MODULES.md`. If it exists and contains module entries, use those module names as `bdd/features/` subdirectories. This is the authoritative source.
1. **User-defined rules:** Glob `bdd/.claude/rules/*.md`. If files exist, read them for explicit module mappings and folder names. Use those modules.
2. **BDD conventions file:** If `bdd/CLAUDE.md` exists, read it for module conventions.
3. **Existing module folders:** Glob `bdd/features/*/`. If module folders already exist, preserve them. Do not remove or rename existing modules.
4. **PRD feature specs:** Glob `prd/modules/*/features/*/`. Use module folder names as module hints (e.g., `prd/modules/app/` → `app`, `prd/modules/api/` → `api`).
5. **Codebase structure:** Glob top-level directories and `server/` or `src/` subdirectories. Infer modules from package names.

If no sources yield modules, create a single `general/` module folder.

For each detected module, create `bdd/features/{module}/` using kebab-case naming.

## 2d. Detect Language

**Check cache first:** Read `.molcajete/settings.json`. If the `bdd` object has `framework` and `language` values, use them and skip to 2e.

**Otherwise**, determine which programming language to use for step definitions. Follow the language detection rules from SKILL.md — scan existing step files, default to Python if none exist.

## 2e. Detect Format

**Check cache first:** Read `.molcajete/settings.json`. If the `bdd` object has a `format` value, use it and skip to 2f.

**Otherwise**, determine the feature file format. Follow the format detection rules from SKILL.md — scan for `.feature.md` vs `.feature` files, default to standard Gherkin.

## 2f. Create Scaffold Files

Do NOT create step definition files during scaffold setup — those are created during scenario generation. During scaffold setup, only create:

1. `bdd/features/INDEX.md` (see `templates/index-features.md`)
2. `bdd/steps/INDEX.md` (see `templates/index-steps.md`)
3. `bdd/steps/world.[ext]` (see `templates/world-{language}.md` for the detected language)
4. `bdd/steps/environment.py` — only if Python is the detected language (included in `templates/world-python.md`)

## 2f-cache. Persist BDD Settings

After scaffold creation, write the detected language, framework, and format to `.molcajete/settings.json`. If the file exists, merge the `bdd` key via read-modify-write. If it does not exist, create it with just the `bdd` object. See the "BDD Settings Cache" section in SKILL.md for the format.

## 2g. Validate Index Files

This section detects drift between INDEX.md entries and actual files on disk. If the scaffold was just created in this invocation (steps 2b–2f ran), skip this section and proceed to Step 3 — newly created indexes are empty and inherently in sync. Otherwise (Step 2a routed here because the scaffold already existed), run the checks below.

**Detect feature index drift:**

1. Glob `bdd/features/**/*.feature` and `bdd/features/**/*.feature.md` to collect all feature files on disk. Each path has the shape `bdd/features/{module}/{domain}/{UC-XXXX}-{uc-slug}.feature`.
2. Read `bdd/features/INDEX.md` and extract every file path from `**File:**` entries. Normalize paths to be relative to `bdd/features/` (e.g., `storefront/identity/UC-0G2a-sign-in-with-password.feature`).
3. Compare the two sets:
   - **Stale entries:** Paths in INDEX.md that do not match any file on disk.
   - **Missing entries:** Feature files on disk that have no corresponding INDEX.md entry.

**Detect step index drift:**

1. Glob `bdd/steps/*_steps.*` to collect all step definition files on disk.
2. Read `bdd/steps/INDEX.md` and extract all unique file names from the `Source` column of each table.
3. Compare the two sets:
   - **Stale entries:** Source files referenced in INDEX.md that do not exist on disk.
   - **Missing entries:** Step files on disk that have no entries in INDEX.md.

**Act on results:**

- If **no drift** detected in either index → proceed to Step 3.
- If **drift detected** → report the discrepancies: "Index drift detected. Stale entries: {list}. Missing entries: {list}." Then proceed to 2h (rebuild indexes from file system).

## 2h. Rebuild Indexes from File System

This section runs only when 2g detected drift in either index. It rebuilds **both** INDEX.md files from scratch using actual file contents — rebuilding one without the other could introduce new drift. After rebuilding, report what was fixed and proceed to Step 3.

**Rebuild `bdd/features/INDEX.md`:**

1. Glob `bdd/features/**/*.feature` and `bdd/features/**/*.feature.md` to collect all feature files on disk.
2. Each file path is `bdd/features/{module}/{domain}/{UC-XXXX}-{uc-slug}.feature`. The module is the first segment, the domain is the second segment, and the filename carries the UC-ID + slug.
3. For each feature file, read it and extract:
   - The `Feature:` name (text after the `Feature:` keyword on the first matching line — this is the UC name).
   - The feature description (the line(s) immediately following the `Feature:` line, before the first `Background:`, `Scenario:`, or `Scenario Outline:` — this is the UC objective).
   - The feature-level `@FEAT-XXXX` and `@UC-XXXX` tags (for cross-referencing the parent PRD feature and UC).
   - All scenario names: lines matching `Scenario:` or `Scenario Outline:`.
4. Group by module, then by domain. Within each domain, sort files alphabetically (UC-ID prefix makes ordering deterministic).
5. Write `bdd/features/INDEX.md` from scratch using the template from `templates/index-features.md`:
   - `## {Module Name}` heading per module (title-case the module name).
   - `### {Domain}` sub-heading per domain.
   - Per UC file: `#### {UC Name} ({UC-XXXX})` with `**File:**`, `**Parent feature:**` (FEAT-XXXX and feature name), `**Summary:**` (UC objective), and `**Scenarios:**` (bulleted list of scenario names with descriptions).
   - If no description exists, use the UC name.

**Rebuild `bdd/steps/INDEX.md`:**

1. Glob `bdd/steps/*_steps.*` to collect all step definition files on disk.
2. For each step file, read it and extract step definitions using language-aware parsing:
   - **Python:** Find `@given(`, `@when(`, `@then(` decorators — extract the string pattern (e.g., `user {name} is logged in`). Read the docstring below the function for description and parameter info.
   - **Go:** Find `ctx.Step(` calls in `InitializeScenario` methods — extract the regex pattern string. Match each regex to its corresponding step function (named in the second argument). Read the doc comment above that step function for description and parameters.
   - **TypeScript:** Find `Given(`, `When(`, `Then(` calls — extract the string pattern. Read the JSDoc comment above for description and parameters.
3. Determine each step file's category from its filename:
   - `common_steps.*` → Common Steps
   - `api_steps.*` → API Steps
   - `db_steps.*` → Database Steps
   - `{name}_steps.*` → {Name} Steps (domain-specific, title-case the name)
4. Group steps by category. Within each category, sort by pattern alphabetically.
5. Write `bdd/steps/INDEX.md` from scratch using the template from `templates/index-steps.md`:
   - One `## {Category} Steps` heading per category.
   - A table under each heading with columns: Pattern, Description, Parameters, Source.
   - If a step has no extractable description, use the pattern text as the description.

**Report changes:**

After both indexes are rebuilt, report a per-index summary: "Features INDEX rebuilt: {count} stale entries removed, {count} missing entries added. Steps INDEX rebuilt: {count} stale entries removed, {count} missing entries added." Then proceed to Step 3.
