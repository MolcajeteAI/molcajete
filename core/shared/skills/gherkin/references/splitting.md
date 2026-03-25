# Feature File Splitting Procedure

This procedure runs after generation and indexing. It checks whether the target feature file has grown beyond the scenario limit. This applies to both new and existing features.

## Count Scenarios

1. Read the target feature file (the one just created or appended to).
2. Count the total number of `Scenario:` and `Scenario Outline:` blocks.
3. If the count is **15 or fewer**, skip the rest of this procedure — proceed to the Summary Output.

## Promote to Directory

If the count exceeds 15:

1. **Group scenarios by logical concern.** Read all scenario names, tags, and step patterns. Apply these heuristics to form groups:
   - Scenarios sharing a specific tag (e.g., `@login`, `@password-reset`) → same group
   - Scenarios testing the same user flow (happy path + its error/edge cases) → same group
   - Scenarios sharing identical Given/Background setup → likely same group
   - Aim for 5-10 scenarios per group. Avoid single-scenario groups unless the scenario is truly standalone.

2. **Create the feature directory:** `bdd/features/{domain}/{feature-name}/` (same name as the original file, without extension).

3. **Create sub-files:** For each group, create a `.feature` (or `.feature.md`) file inside the new directory:
   - File name: descriptive kebab-case name reflecting the group's concern (e.g., `login.feature`, `password-reset.feature`, `session-management.feature`).
   - Each file must have its own `Feature:` line (use a descriptive sub-feature name), feature-level tags, and description.
   - If scenarios in the group share preconditions, add a `Background:` block to that file.
   - Preserve all scenario tags, steps, and examples exactly as they were in the original file.
   - **Prohibited names:** `part-1.feature`, `scenarios-1-to-7.feature`, `misc.feature`, or any name based on numeric ranges or ordering.

4. **Delete the original file:** Remove the single feature file that was promoted.

5. **Update `bdd/features/INDEX.md`:** Replace the single-file entry for this feature with a directory entry listing each sub-file and its scenarios:
   ```markdown
   ### {Feature Name}
   - **Directory:** `{domain}/{feature-name}/`
   - **Summary:** {1-sentence description}
   - **Files:**
     - `{sub-file-name}.feature` — {group description}
       - {Scenario name} — {brief description}
       - {Scenario name} — {brief description}
     - `{sub-file-name}.feature` — {group description}
       - {Scenario name} — {brief description}
   ```

6. **Update the summary:** Set the "Action" field to "Split into directory" and list the sub-files created.
