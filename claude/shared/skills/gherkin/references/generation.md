# Generation Procedure

This procedure generates feature files and step definitions, then updates both INDEX.md files.

**Using spec context for UC-ID arguments:** If the argument was a UC-ID (Step 1b), the extracted context from the feature's `REQUIREMENTS.md`, `USE-CASES.md`, and `ARCHITECTURE.md` must drive the generated scenarios. Scenarios must reflect the actual use case flows, actors, validation rules, and edge cases from the spec — not generic patterns.

**Using exploration context for generic name arguments:** If the argument was a generic name (Step 1d), the synthesized context from the exploration procedure must drive the generated scenarios. Use the exploration results — feature inventory entries, feature spec files, and README documentation (and code analysis if other sources were unavailable) — to generate scenarios that reference actual module behaviors, API endpoints, data models, and validation rules from this project. Do not generate generic placeholder scenarios when exploration context is available.

## 3-pre. Existing Feature: Read and Deduplicate

This section runs **only** when the argument matched an existing feature (Step 1c path). If the argument is a UC-ID (Step 1b) or generic name (Step 1d) creating a new feature, skip to 3a.

**Read existing scenarios:**

1. Read the existing feature file identified in Step 1c.
2. Extract all scenario names from `Scenario:` and `Scenario Outline:` lines (strip leading whitespace and the keyword prefix).
3. Read `bdd/features/INDEX.md` and locate the entry for this feature — cross-reference the scenario list there with the file contents to confirm accuracy.
4. Record the line number of each existing scenario in the file for reference.

**Duplicate check for each proposed new scenario:**

Before generating any new scenario, compare its proposed name against every existing scenario name in the file:

- **Exact match** (case-insensitive, ignoring leading/trailing whitespace): Inform the user — "Scenario '{name}' already exists at `{file}:{line}`. Skipping." Do not generate this scenario.
- **Near-duplicate** (algorithm: 1. lowercase both names, 2. split into words, 3. remove articles "a", "an", "the", 4. compare remaining word sets — if 80% or more of the words in either set appear in the other): Warn the user — "Scenario '{proposed}' may duplicate existing '{existing}' at `{file}:{line}`." Use AskUserQuestion:
  - Question: "This scenario name looks similar to an existing one. Add it anyway?"
  - Header: "Duplicate?"
  - Options:
    - "Skip this scenario" — do not generate it
    - "Add it anyway" — proceed with generation
  - multiSelect: false
- **No match**: Proceed with generation.

**Store context for subsequent steps:**

After the dedup check, carry forward:
- The list of existing scenario names (so 3b only appends genuinely new scenarios)
- The list of step patterns already used in the existing feature file (so 3c maximizes step reuse)
- The file path and line count of the existing feature file (so 3b knows where to append)

**Key distinction:** Module = first directory segment under `bdd/features/` (from `prd/MODULES.md`). Domain = second directory segment (the single domain from the feature's REQUIREMENTS.md frontmatter). Filename = `{UC-XXXX}-{uc-slug}.feature` — one file per UC. Never use a feature name as the module or filename segment.

**One feature → one domain → one BDD directory.** Every scenario in a UC's file tests the same domain. Side effects (emails, notifications, downstream events) are validations of that UC, not evidence of another domain being tested.

## 3a. Determine Module + Domain Folder

Resolve the `bdd/features/{module}/{domain}/` folder for the target UC's `.feature` file:

1. Identify the owning PRD feature and UC for the argument:
   - UC-ID (Step 1b): use that UC directly.
   - Existing feature (Step 1c): the argument resolves to an existing `.feature` file — it already encodes a single UC. Extract the UC from the filename `{UC-XXXX}-{uc-slug}.feature` or from the `@UC-XXXX` feature-level tag.
   - Generic name (Step 1d): resolve the closest matching UC from exploration context.
2. Read the owning PRD feature's `REQUIREMENTS.md` frontmatter:
   - `module:` → `{module}` path segment.
   - `domain:` → `{domain}` path segment (single value; every feature has exactly one domain).
3. If no spec exists (generic name with no PRD match), fall back to module detection priority from SKILL.md and prompt the user for the domain.
4. Verify `bdd/features/{module}/{domain}/` exists. If not, create it with `mkdir -p`.

## 3b. Generate Feature File

One `.feature` file per UC. Create the file at `bdd/features/{module}/{domain}/{UC-XXXX}-{uc-slug}.feature` (or `.feature.md` if MDG format). Read the matching template: `templates/feature-gherkin.md` for `.feature` files or `templates/feature-mdg.md` for `.feature.md` files.

Follow the file naming rules, tagging rules, step writing rules, and Gherkin construct selection rules from SKILL.md.

**Feature-level structure:**
- The `Feature:` line names the UC (from the UC file's `name`). The 1–2 sentence description is the UC objective.
- Feature-level tags: `@FEAT-XXXX` `@UC-XXXX` `@{domain}` `@{module}` and one priority tag (`@smoke`, `@regression`, or `@critical`).
- Scenario-level tags: `@SC-XXXX`, `@pending` (on first generation, before step definitions are implemented), and any other classification tags. **Never add a second domain tag on a scenario** — one feature, one domain.
- Use `Background:` only if 2+ scenarios share the same preconditions.

**Appending new scenarios to an existing UC file (Step 1c path):**

When the UC's `.feature` file already exists (argument matched in Step 1c, after dedup in 3-pre), do NOT create a new file and do NOT merge scenarios across UCs. Instead:

1. Use the Edit tool to append new scenarios at the end of the existing UC's file. Place them after the last existing scenario, with a blank line separator.
2. Preserve all existing content — feature-level tags, `Feature:` line, description, `Background:`, and all existing scenarios.
3. New scenarios must follow the same conventions as existing scenarios in the file (format, tag style, Background inheritance).
4. Only generate scenarios that passed the dedup check in 3-pre. Skip duplicates.
5. Update the "Action" field in the summary to "Updated" (not "Created").

If the argument resolves to a different UC than the one owning the existing file, do not append — create a new `{UC-XXXX}-{uc-slug}.feature` for that UC.

## 3c. Generate Step Definitions

Before creating any step definitions, follow the step reuse policy from SKILL.md — read `bdd/steps/INDEX.md` to identify existing reusable patterns.

**Reuse check:**

For each Given/When/Then step in the generated feature file:

1. Search `bdd/steps/INDEX.md` for a pattern that matches this step (exact or parameterized match).
2. If a match exists → reuse the existing step. Do not create a duplicate definition. Increment the "steps reused" counter for the summary.
3. If no match exists → create a new step definition. Increment the "steps created" counter.

**Step file placement:** Follow the step file placement table from SKILL.md.

If the target step file already exists, append the new step definitions to the end of the file using the Edit tool. If the file does not exist, create it using the matching template from `templates/steps-{language}.md`.

Follow the step definition rules from SKILL.md (docstrings, parameter descriptions, TODO placeholder body).

**Language consistency:** Use the language detected in the scaffold step. Never create step files in a different language than detected.

## 3d. Update Index Files

After generating the feature file (3b) and step definitions (3c), update both INDEX.md files. Both updates must happen — do not leave partial index state.

**Update `bdd/features/INDEX.md`:**

1. Read the current `bdd/features/INDEX.md`.
2. Find or add the module heading (e.g., `## storefront`), then the domain sub-heading (`### identity`). If either is missing, add it.
3. **New UC file:** Add a new entry under the module → domain sub-heading following the Features INDEX.md template format — UC name, UC-ID, parent feature ID, 1-sentence summary (from UC objective), and all scenario names with brief descriptions.
4. **Existing UC file (Step 1c path):** Find the existing entry (one entry per UC file). Append only new scenario names to its scenario list — do not re-list existing scenarios. Do not change the file path, UC name, or summary unless inaccurate.
5. Use the Edit tool to insert or update the entry.

**Update `bdd/steps/INDEX.md`:**

1. Read the current `bdd/steps/INDEX.md`.
2. For each new step definition created in 3c (not reused steps):
   - Find the correct category heading (Common, API, Database, or domain-specific).
   - Add a row to the table with: pattern, description, parameters with types, and source file.
3. If the category heading does not exist, add it with a new table.
4. Use the Edit tool to insert the entries.

**After both indexes are updated**, proceed to the splitting check (read `references/splitting.md` if scenario count exceeds 15) before displaying the summary.
