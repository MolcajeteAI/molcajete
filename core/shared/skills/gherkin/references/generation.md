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

## 3a. Determine Domain Folder

Decide which `bdd/features/{domain}/` folder to place the feature file in:

1. If the argument was resolved from a UC-ID (Step 1b), infer the domain from the spec's subject area (e.g., an authentication UC goes in `authentication/`).
2. If the argument matched an existing feature (Step 1c), use the same domain folder as the existing file.
3. If the argument is a generic name (Step 1d), use the primary domain determined in the exploration procedure.
4. Check existing domain folders in `bdd/features/`. If a suitable domain already exists, use it.
5. If no existing domain fits, create a new `bdd/features/{domain}/` folder with a descriptive kebab-case name.
6. If the feature spans multiple domains, use `cross-domain/`.

## 3b. Generate Feature File

Create the feature file at `bdd/features/{domain}/{feature-name}.feature` (or `.feature.md` if MDG format). Read the matching template: `templates/feature-gherkin.md` for `.feature` files or `templates/feature-mdg.md` for `.feature.md` files.

Follow the file naming rules, tagging rules, step writing rules, and Gherkin construct selection rules from SKILL.md.

**Feature-level structure:**
- Add feature-level tags: `@{domain}` and one priority tag (`@smoke`, `@regression`, or `@critical`)
- Write a 1-2 sentence description immediately after the `Feature:` line
- Use `Background:` only if 2+ scenarios share the same preconditions

**Appending to an existing feature (Step 1c path):**

When the feature file already exists (argument matched in Step 1c, after dedup in 3-pre), do NOT create a new file. Instead:

1. Use the Edit tool to append new scenarios at the end of the existing feature file. Place them after the last existing scenario, maintaining a blank line separator between scenarios.
2. Preserve all existing content — feature-level tags, `Feature:` line, description, `Background:`, and all existing scenarios. Do not modify any existing content.
3. New scenarios must follow the same conventions as existing scenarios in the file:
   - Same format (standard Gherkin or MDG) as the rest of the file.
   - Same tag style. If existing scenarios use `@regression @auth`, follow that pattern.
   - If the file has a `Background:`, new scenarios inherit it — do not duplicate the Background block.
4. Only generate scenarios that passed the dedup check in 3-pre. Skip any that were flagged as duplicates.
5. Update the "Action" field in the summary to "Updated" (not "Created").

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
2. Find the heading for the target domain (e.g., `## Authentication`). If the heading does not exist, add it.
3. **New feature:** Add a new feature entry under the domain heading following the Features INDEX.md template format — file path, 1-sentence summary, and all scenario names with brief descriptions.
4. **Existing feature (Step 1c path):** Find the existing feature entry. Append only the new scenario names to its scenario list — do not re-list existing scenarios. Do not change the file path or summary unless they are inaccurate.
5. Use the Edit tool to insert or update the entry.

**Update `bdd/steps/INDEX.md`:**

1. Read the current `bdd/steps/INDEX.md`.
2. For each new step definition created in 3c (not reused steps):
   - Find the correct category heading (Common, API, Database, or domain-specific).
   - Add a row to the table with: pattern, description, parameters with types, and source file.
3. If the category heading does not exist, add it with a new table.
4. Use the Edit tool to insert the entries.

**After both indexes are updated**, proceed to the splitting check (read `references/splitting.md` if scenario count exceeds 15) before displaying the summary.
